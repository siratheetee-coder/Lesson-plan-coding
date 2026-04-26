import express from 'express';
import multer from 'multer';
import { db, now } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { PACKAGES } from '../config/packages.js';

const router = express.Router();

// In-memory upload (max 5MB) — slips are forwarded straight to SlipOK, not stored on disk
const slipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('not_an_image'));
    cb(null, true);
  },
});

// ─── PromptPay QR generator (lazy-loaded) ────────────────
async function generatePromptPayQR(promptpayId, amountTHB) {
  try {
    const { default: generatePayload } = await import('promptpay-qr');
    const { default: QRCode } = await import('qrcode');
    const payload = generatePayload(promptpayId, { amount: amountTHB });
    // Returns a base64 data URL (PNG)
    const dataUrl = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
      color: { dark: '#1a1f3a', light: '#ffffff' },
    });
    return dataUrl;
  } catch (e) {
    console.error('QR generation error', e);
    return null;
  }
}

// All credits routes require auth
router.use(requireAuth);

// ─── GET /api/credits/balance ────────────────────────────
router.get('/balance', async (req, res) => {
  try {
    const credits = await db.getCredits(req.user.id);
    res.json({ credits });
  } catch (e) {
    console.error('balance error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── GET /api/credits/history ────────────────────────────
router.get('/history', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const [credits, history] = await Promise.all([
      db.getCredits(req.user.id),
      db.getCreditTransactions(req.user.id, limit, offset),
    ]);
    res.json({ credits, history, limit, offset });
  } catch (e) {
    console.error('history error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── GET /api/credits/packages ───────────────────────────
// Public-ish (still requires auth for consistency)
router.get('/packages', (_req, res) => {
  res.json({ packages: PACKAGES });
});

// ─── POST /api/credits/topup/init ────────────────────────
// Initiate a top-up request.
// Mode: 'manual' if OMISE_SECRET_KEY not set (shows contact info).
// Mode: 'omise'  if OMISE_SECRET_KEY is set (creates PromptPay QR charge).
router.post('/topup/init', async (req, res) => {
  try {
    const { package_id } = req.body || {};
    const pkg = PACKAGES.find(p => p.id === package_id);
    if (!pkg) return res.status(400).json({ error: 'invalid_package' });

    if (!process.env.OMISE_SECRET_KEY) {
      // ── Manual / contact mode (no payment gateway configured) ──
      // Priority: 1) Static QR image URL (e.g. merchant QR)  2) Dynamic generation from PromptPay number
      const staticQrUrl = process.env.SUPPORT_QR_IMAGE_URL || '';
      const promptpayId = process.env.SUPPORT_PROMPTPAY || '';
      let qrImage = staticQrUrl || null;
      let qrType = staticQrUrl ? 'static' : 'dynamic';
      if (!qrImage && promptpayId) {
        qrImage = await generatePromptPayQR(promptpayId, pkg.price_thb);
      }
      return res.json({
        mode: 'manual',
        package: pkg,
        contact: process.env.SUPPORT_FB || process.env.SUPPORT_LINE || process.env.SUPPORT_EMAIL || '',
        promptpay: promptpayId,
        promptpay_name: process.env.SUPPORT_PROMPTPAY_NAME || '',
        qr_image: qrImage,
        qr_type: qrType, // 'static' = user types amount; 'dynamic' = amount embedded
        note: process.env.TOPUP_NOTE || 'กรุณาโอนเงินแล้วส่งสลิปมาที่ผู้ดูแลระบบ ระบุ email และจำนวนแผนที่ต้องการ',
      });
    }

    // ── Omise PromptPay mode ────────────────────────────────────
    // Lazy-import omise only when OMISE_SECRET_KEY is set
    const Omise = (await import('omise')).default;
    const omise = Omise({ secretKey: process.env.OMISE_SECRET_KEY });

    const chargeRes = await omise.charges.create({
      amount: pkg.price_thb * 100, // satangs
      currency: 'thb',
      source: { type: 'promptpay' },
      metadata: {
        user_id: req.user.id,
        package_id: pkg.id,
        credits: pkg.credits,
      },
    });

    res.json({
      mode: 'omise',
      charge_id: chargeRes.id,
      package: pkg,
      qr_image: chargeRes.source?.scannable_code?.image?.download_uri || null,
      expires_at: chargeRes.expires_at,
    });
  } catch (e) {
    console.error('topup init error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── GET /api/credits/topup/status/:chargeId ─────────────
// Poll payment status (Omise mode only)
router.get('/topup/status/:chargeId', async (req, res) => {
  try {
    if (!process.env.OMISE_SECRET_KEY) {
      return res.json({ status: 'manual' });
    }
    const Omise = (await import('omise')).default;
    const omise = Omise({ secretKey: process.env.OMISE_SECRET_KEY });
    const charge = await omise.charges.retrieve(req.params.chargeId);

    if (charge.status === 'successful') {
      // Add credits if not already added (idempotent via ref_id check)
      const already = await db.getCreditTransactions(req.user.id, 500, 0);
      const exists = already.find(t => t.ref_id === charge.id);
      if (!exists) {
        const credits = charge.metadata?.credits;
        if (credits) {
          await db.addCredits(
            req.user.id, credits, 'topup',
            `ซื้อ ${credits} แผน (${charge.metadata?.package_id})`,
            charge.id
          );
        }
      }
      const balance = await db.getCredits(req.user.id);
      return res.json({ status: 'paid', credits: balance });
    }

    res.json({ status: charge.status });
  } catch (e) {
    console.error('topup status error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── POST /api/credits/charge-export ─────────────────────
// Charges 1 credit per unique lesson export (Pattern A: deduct first).
// Idempotent: same lesson_hash → no double charge (so PDF + DOCX of the
// same lesson costs 1 credit total, not 2). Editing the lesson changes
// the hash and triggers a fresh charge.
router.post('/charge-export', async (req, res) => {
  try {
    const { lesson_hash, format } = req.body || {};
    if (!lesson_hash || typeof lesson_hash !== 'string' || lesson_hash.length < 8) {
      return res.status(400).json({ error: 'invalid_lesson_hash' });
    }
    const cost = 1;
    const refId = `export:${req.user.id}:${lesson_hash}`;

    // Idempotency: if this lesson was already charged for this user → free re-export
    const existing = await db.findCreditTransactionByRefId(refId);
    if (existing) {
      const balance = await db.getCredits(req.user.id);
      return res.json({ ok: true, already_charged: true, credits: balance });
    }

    // Atomic deduct (rejects if balance < cost)
    const result = await db.deductCredits(
      req.user.id, cost, 'usage',
      `Export แผน (${format || 'unknown'})`,
      refId
    );
    if (!result.ok) {
      return res.status(402).json({
        error: 'insufficient_credits',
        message: 'เครดิตไม่เพียงพอ กรุณาเติมเครดิต',
      });
    }
    res.json({
      ok: true,
      already_charged: false,
      credits: result.balance_after,
      deducted: cost,
    });
  } catch (e) {
    console.error('charge-export error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── POST /api/credits/topup/verify-slip ─────────────────
// User uploads slip image → forward to SlipOK → if valid, credit user
// Body (multipart/form-data): slip (image file), package_id (string)
router.post('/topup/verify-slip', slipUpload.single('slip'), async (req, res) => {
  try {
    const packageId = req.body?.package_id;
    const pkg = PACKAGES.find(p => p.id === packageId);
    if (!pkg) return res.status(400).json({ error: 'invalid_package' });
    if (!req.file) return res.status(400).json({ error: 'no_slip_file', message: 'กรุณาอัพโหลดรูปสลิป' });

    const apiKey = process.env.SLIPOK_API_KEY;
    const branchId = process.env.SLIPOK_BRANCH_ID;
    if (!apiKey || !branchId) {
      return res.status(500).json({ error: 'slipok_not_configured', message: 'ระบบยังไม่ได้ตั้งค่า SlipOK' });
    }

    // ── Forward slip image to SlipOK ─────────────────────────
    const fd = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
    fd.append('files', blob, req.file.originalname || 'slip.jpg');
    fd.append('amount', String(pkg.price_thb));
    fd.append('log', 'true');

    const slipokRes = await fetch(`https://api.slipok.com/api/line/apikey/${branchId}`, {
      method: 'POST',
      headers: { 'x-authorization': apiKey },
      body: fd,
    });
    const result = await slipokRes.json().catch(() => ({}));

    if (!slipokRes.ok || !result?.success) {
      const code = result?.code;
      const msg = result?.message || 'ตรวจสอบสลิปไม่สำเร็จ';
      // Map common SlipOK codes to friendly messages
      const friendly = {
        1010: 'สลิปนี้เคยถูกใช้แล้ว',
        1011: 'รูปสลิปไม่ชัด หรือไม่ใช่สลิปโอนเงิน',
        1012: 'ยอดเงินในสลิปไม่ตรงกับแพ็กเกจ',
      }[code] || msg;
      return res.status(400).json({ error: 'slipok_failed', code, message: friendly });
    }

    const data = result.data || {};

    // ── Validate amount ─────────────────────────────────────
    if (Number(data.amount) !== Number(pkg.price_thb)) {
      return res.status(400).json({
        error: 'amount_mismatch',
        message: `ยอดในสลิป ฿${data.amount} ไม่ตรงกับแพ็กเกจ ฿${pkg.price_thb}`,
      });
    }

    // ── Validate receiver account (last-4-digit suffix match) ─
    const expected = (process.env.SLIPOK_RECEIVER_ACCOUNT || '').replace(/\D/g, '');
    if (expected) {
      const receiverDigits = (
        data.receiver?.account?.value ||
        data.receiver?.account?.bank?.account ||
        data.receiver?.proxy?.value ||
        ''
      ).replace(/\D/g, '');
      const tail = expected.slice(-4);
      if (tail && !receiverDigits.includes(tail)) {
        return res.status(400).json({
          error: 'receiver_mismatch',
          message: 'บัญชีผู้รับในสลิปไม่ตรงกับระบบ',
        });
      }
    }

    // ── Idempotency: reject if transRef already credited (any user) ─
    if (!data.transRef) {
      return res.status(400).json({ error: 'no_transref', message: 'ไม่พบเลขอ้างอิงในสลิป' });
    }
    const refId = `slipok:${data.transRef}`;
    const existing = await db.findCreditTransactionByRefId(refId);
    if (existing) {
      return res.status(409).json({
        error: 'slip_already_used',
        message: 'สลิปนี้ถูกใช้เติมเครดิตไปแล้ว',
      });
    }

    // ── Credit the user ─────────────────────────────────────
    await db.addCredits(
      req.user.id, pkg.credits, 'topup',
      `ซื้อ ${pkg.credits} แผน (${pkg.id}) — สลิป ${data.transRef}`,
      refId
    );
    const balance = await db.getCredits(req.user.id);

    return res.json({
      success: true,
      credits: balance,
      added: pkg.credits,
      transRef: data.transRef,
      amount: data.amount,
    });
  } catch (e) {
    if (e?.message === 'not_an_image') {
      return res.status(400).json({ error: 'not_an_image', message: 'กรุณาอัพโหลดเฉพาะไฟล์รูปภาพ' });
    }
    if (e?.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'file_too_large', message: 'ไฟล์ใหญ่เกินไป (สูงสุด 5MB)' });
    }
    console.error('verify-slip error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── POST /api/credits/topup/webhook ─────────────────────
// Omise webhook — called automatically when payment succeeds
// IMPORTANT: verify Omise-Signature header in production
router.post('/topup/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    if (!process.env.OMISE_SECRET_KEY) return res.json({ ok: true });

    const event = JSON.parse(req.body.toString());
    if (event.key !== 'charge.complete') return res.json({ ok: true });

    const charge = event.data;
    if (charge.status !== 'successful') return res.json({ ok: true });

    const userId = charge.metadata?.user_id;
    const credits = Number(charge.metadata?.credits);
    const packageId = charge.metadata?.package_id;

    if (!userId || !credits) return res.status(400).json({ error: 'missing_metadata' });

    // Idempotent — skip if already credited
    const history = await db.getCreditTransactions(userId, 500, 0);
    if (history.find(t => t.ref_id === charge.id)) {
      return res.json({ ok: true, skipped: true });
    }

    await db.addCredits(
      userId, credits, 'topup',
      `ซื้อ ${credits} แผน (${packageId || charge.id})`,
      charge.id
    );

    console.log(`✓ Credits +${credits} → user ${userId} (charge ${charge.id})`);
    res.json({ ok: true });
  } catch (e) {
    console.error('webhook error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;
