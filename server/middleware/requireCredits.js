import { db } from '../db.js';

/**
 * Middleware factory — checks that the authenticated user has at least `cost` credits.
 * Must be used AFTER requireAuth so req.user is populated.
 *
 * Usage:
 *   router.post('/generate-rubric', requireAuth, requireCredits(1), async (req, res) => { ... })
 *
 * On success: adds req.creditCost so the route handler can call db.deductCredits.
 * On failure: returns 402 with { error: 'insufficient_credits', credits_required, credits_have }
 */
export function requireCredits(cost) {
  return async (req, res, next) => {
    try {
      const balance = await db.getCredits(req.user.id);
      if (balance < cost) {
        return res.status(402).json({
          error: 'insufficient_credits',
          message: 'เครดิตไม่เพียงพอ กรุณาเติมเครดิต',
          credits_required: cost,
          credits_have: balance,
        });
      }
      req.creditCost = cost;
      next();
    } catch (e) {
      next(e);
    }
  };
}
