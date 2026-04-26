import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

// Used as a constant-time dummy comparison when user not found (prevents timing-based user enumeration)
const DUMMY_HASH = '$2b$12$abcdefghijklmnopqrstuuJ4r5T/o4gZxqU1Hk8pZpW8Y1J0pPf86';

export async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain, hash) {
  if (!hash) {
    // Burn the same CPU as a real compare to prevent timing leaks
    await bcrypt.compare(plain, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(plain, hash);
}

// Minimum policy (NIST SP 800-63B): length ≥ 8, no composition rules
export function validatePasswordPolicy(password) {
  if (typeof password !== 'string') return 'รหัสผ่านไม่ถูกต้อง';
  if (password.length < 8) return 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร';
  if (password.length > 128) return 'รหัสผ่านยาวเกินไป (สูงสุด 128 ตัว)';
  return null;
}

export function validateEmail(email) {
  if (typeof email !== 'string') return false;
  // Simple but practical RFC 5321-ish check
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}
