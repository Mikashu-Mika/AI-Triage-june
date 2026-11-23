/**
 * Password hashing shared with the Back Office (same bcrypt format and rounds as
 * siftai-bo/src/lib/password.ts), so either app can verify what the other wrote.
 */
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export function isBcryptHash(value) {
  return typeof value === 'string' && BCRYPT_RE.test(value);
}

export async function hashPassword(plainText) {
  return bcrypt.hash(plainText, SALT_ROUNDS);
}

/**
 * Check a password against the stored value (bcrypt hash, or legacy plaintext).
 * needsRehash is true when a legacy plaintext password matched and should be hashed now.
 */
export async function verifyPassword(plainText, storedValue) {
  if (!plainText || !storedValue) return { valid: false, needsRehash: false };
  const plain = String(plainText).trim();
  const stored = String(storedValue).trim();
  if (isBcryptHash(stored)) {
    return { valid: await bcrypt.compare(plain, stored), needsRehash: false };
  }
  const valid = plain === stored;
  return { valid, needsRehash: valid };
}
