// ─── Credit Packages ─────────────────────────────────────
// price_thb is in Thai Baht (integer)
export const PACKAGES = [
  { id: 'pack_10',  credits: 10,  price_thb: 49,  label: '10 แผน',  badge: null },
  { id: 'pack_40',  credits: 40,  price_thb: 129, label: '40 แผน',  badge: 'ยอดนิยม' },
  { id: 'pack_60',  credits: 60,  price_thb: 169, label: '60 แผน',  badge: null },
  { id: 'pack_100', credits: 100, price_thb: 259, label: '100 แผน', badge: 'คุ้มที่สุด' },
];

// ─── AI Feature Costs (credits per call) ─────────────────
export const AI_COSTS = {
  generate_rubric:  1,
  generate_outline: 1,
};

// ─── Free credits given on first registration ─────────────
export const FREE_CREDITS_ON_REGISTER = 3;
