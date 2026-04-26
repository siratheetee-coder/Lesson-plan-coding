import express from 'express';
import { db, now } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { PACKAGES } from '../config/packages.js';

const router = express.Router();

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
      const promptpayId = process.env.SUPPORT_PROMPTPAY || '';
      let qrImage = null;
      if (promptpayId) {
        qrImage = await generatePromptPayQR(promptpayId, pkg.price_thb);
      }
      return res.json({
        mode: 'manual',
        package: pkg,
        contact: process.env.SUPPORT_LINE || process.env.SUPPORT_EMAIL || '',
        promptpay: promptpayId,
        promptpay_name: process.env.SUPPORT_PROMPTPAY_NAME || '',
        qr_image: qrImage, // base64 data URL with embedded amount
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
