// ─── Credit Packages ─────────────────────────────────────
// 1 credit = 1 lesson plan export  (AI generation is always free)
// price_thb     = ราคาขายจริง (charged amount)
// price_original = ราคาก่อนลด (shown crossed-out for "launch promo" framing)
//                  ปล่อย null ถ้าไม่อยากแสดงราคาขีดฆ่า
export const PACKAGES = [
  { id: 'pack_10',  credits: 10,  price_thb: 49,  price_original: 89,  label: '10 แผน',  badge: '🎉 เปิดตัว' },
  { id: 'pack_40',  credits: 40,  price_thb: 129, price_original: 249, label: '40 แผน',  badge: 'ยอดนิยม' },
  { id: 'pack_60',  credits: 60,  price_thb: 169, price_original: 329, label: '60 แผน',  badge: null },
  { id: 'pack_100', credits: 100, price_thb: 259, price_original: 539, label: '100 แผน', badge: 'คุ้มที่สุด' },
];

// ─── AI Feature Costs ─────────────────────────────────────
// All AI generation calls are FREE (0 credits).
// Credits are deducted only when the teacher exports a finished lesson plan.
export const AI_COSTS = {
  generate_objectives:    0,
  generate_concept:       0,
  generate_media:         0,
  generate_task:          0,
  generate_activities:    0,
  generate_passing_criteria: 0,
};

// ─── Free credits given on first registration ─────────────
// 5 free exports so new teachers can finish 5 complete lesson plans before buying.
export const FREE_CREDITS_ON_REGISTER = 5;
