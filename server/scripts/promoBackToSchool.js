// One-time promo: ฉลองเปิดเทอม — top every user up to 40 credits
// (won't reduce anyone who already has ≥40). Logs a credit_transaction
// row per top-up with type='promo' so it shows in user history.
//
// Idempotent: each user gets a refId based on PROMO_ID, so running this
// script twice will NOT double-credit (db.addCredits checks ref_id later
// — for safety we also check ourselves before adding).
//
// Run on Render Shell:
//     node scripts/promoBackToSchool.js
// Run locally:
//     node server/scripts/promoBackToSchool.js

import { db } from '../db.js';

const PROMO_ID    = 'back-to-school-2026';
const TARGET      = 40;                       // top up TO this amount
const PROMO_NOTE  = '🎉 ฉลองเปิดเทอม แจกฟรี! เติมเครดิตให้ถึง 40';
const BATCH_SIZE  = 100;

async function run() {
  console.log(`\n=== Promo: ${PROMO_ID} — top up to ${TARGET} credits ===\n`);

  let offset = 0;
  let toppedUp = 0;
  let skippedHasEnough = 0;
  let skippedAlreadyApplied = 0;
  let totalGranted = 0;

  for (;;) {
    const users = await db.listUsers({ limit: BATCH_SIZE, offset });
    if (!users.length) break;

    for (const u of users) {
      const balance = Number(u.credits || 0);
      if (balance >= TARGET) {
        skippedHasEnough++;
        continue;
      }
      const refId  = `promo:${PROMO_ID}:${u.id}`;
      const exists = await db.findCreditTransactionByRefId(refId);
      if (exists) {
        skippedAlreadyApplied++;
        continue;
      }
      const amount = TARGET - balance;
      try {
        await db.addCredits(u.id, amount, 'promo', PROMO_NOTE, refId);
        toppedUp++;
        totalGranted += amount;
        console.log(`  ✓ ${u.email} : ${balance} → ${TARGET}  (+${amount})`);
      } catch (e) {
        console.error(`  ✗ ${u.email} : ${e.message}`);
      }
    }
    offset += users.length;
    if (users.length < BATCH_SIZE) break;
  }

  console.log(`
=== Done ===
  topped up         : ${toppedUp} users
  already ≥${TARGET}        : ${skippedHasEnough} users
  already received  : ${skippedAlreadyApplied} users
  total credits granted: ${totalGranted}
`);
  process.exit(0);
}

run().catch(err => {
  console.error('Promo script failed:', err);
  process.exit(1);
});
