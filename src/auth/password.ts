/**
 * password.ts — Admin password hashing.
 *
 * New credentials use scrypt (N=16384, r=8, p=1, 64-byte key) with a random
 * 16-byte salt — a memory-hard KDF with no external dependency.
 *
 * The previous implementation encrypted a fixed verification token with
 * AES-256-CBC using `EVP_BytesToKey(password, salt, SHA-256, 600000)`. Existing
 * `blog/data/admin.json` files are therefore still verifiable through
 * `verifyLegacy`, so upgrading does not lock anyone out; a successful legacy
 * check is immediately followed by a re-hash in the new format.
 */
import crypto from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export interface PasswordRecord {
  algo: 'scrypt';
  salt: string;
  hash: string;
}

function scrypt(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
}

/** Hash a password for storage. */
export function hashPassword(password: string): PasswordRecord {
  const salt = crypto.randomBytes(SALT_LEN);
  const hash = scrypt(password, salt);
  return { algo: 'scrypt', salt: salt.toString('base64'), hash: hash.toString('base64') };
}

/** Verify a password against a stored scrypt record (constant-time). */
export function verifyPassword(record: PasswordRecord, password: string): boolean {
  if (!record || record.algo !== 'scrypt' || !record.salt || !record.hash) return false;
  try {
    const expected = Buffer.from(record.hash, 'base64');
    const actual = scrypt(password, Buffer.from(record.salt, 'base64'));
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ===================== Legacy (OpenSSL EVP_BytesToKey + AES-256-CBC) =====================

const LEGACY_VERIFY_TEXT = 'BLOG-ADMIN-VERIFIED';
const LEGACY_ITERATIONS = 600000;

/**
 * OpenSSL `EVP_BytesToKey` with SHA-256 — the KDF `lua-resty-aes` uses when a
 * salt is supplied.
 *
 *   D₁ = SHA256(password ‖ salt); then (count-1)× Dᵢ = SHA256(Dᵢ₋₁)
 *   key = D₁ (32 bytes for AES-256)
 *   D₂ = SHA256(key ‖ password ‖ salt); then (count-1)× Dᵢ = SHA256(Dᵢ₋₁)
 *   iv  = D₂[0..15]
 *
 * Note the inner rounds hash the digest *alone* — only the first round of each
 * output block mixes in the password and salt. Getting this wrong makes every
 * pre-existing credential unverifiable.
 *
 * The chain is inherently sequential, so we yield to the event loop
 * periodically to keep the server responsive during a legacy login.
 */
async function evpBytesToKey(
  password: Buffer,
  salt: Buffer,
  keyLen: number,
  ivLen: number,
  count: number,
): Promise<{ key: Buffer; iv: Buffer }> {
  const blocks: Buffer[] = [];
  let total = 0;
  let previous: Buffer | null = null;

  while (total < keyLen + ivLen) {
    // First round of the block mixes the previous digest (when any) with the
    // password and salt.
    let digest: Buffer = previous
      ? crypto.createHash('sha256').update(previous).update(password).update(salt).digest()
      : crypto.createHash('sha256').update(password).update(salt).digest();

    // Remaining rounds hash the digest on its own.
    for (let i = 1; i < count; i += 1) {
      digest = crypto.createHash('sha256').update(digest).digest();
      if (i % 20000 === 0) await new Promise((resolve) => setImmediate(resolve));
    }

    blocks.push(digest);
    previous = digest;
    total += digest.length;
  }

  const material = Buffer.concat(blocks);
  return { key: material.subarray(0, keyLen), iv: material.subarray(keyLen, keyLen + ivLen) };
}

/** The stored shape of a pre-rewrite credential file. */
export interface LegacyPasswordRecord {
  salt: string;
  /** base64 of the AES-256-CBC ciphertext of "BLOG-ADMIN-VERIFIED". */
  data: string;
}

/**
 * Verify a password against the legacy AES record.
 * This is intentionally slow (600k SHA-256 rounds × 2 blocks ≈ 1.2M hashes);
 * it only runs while a credential file is still in the old format.
 */
export async function verifyLegacy(record: LegacyPasswordRecord, password: string): Promise<boolean> {
  if (!record?.salt || !record?.data) return false;
  try {
    const salt = Buffer.from(record.salt, 'utf8');
    const encrypted = Buffer.from(record.data, 'base64');
    const { key, iv } = await evpBytesToKey(Buffer.from(password, 'utf8'), salt, 32, 16, LEGACY_ITERATIONS);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const text = decrypted.toString('utf8').replace(/\0+$/, '');
    return text === LEGACY_VERIFY_TEXT;
  } catch {
    return false;
  }
}

/** Generate a random human-transferable password (used by the setup helper). */
export function randomPassword(length = 16): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

// ===================== Password / username policy =====================

/** Minimum accepted password length. */
export const MIN_PASSWORD_LENGTH = 6;

/**
 * Passwords rejected outright at setup and by `npm run passwd-reset`.
 * These are the values a fresh install is likely to be given (and the ones the
 * previous implementation shipped as documented defaults), so they must never
 * work.
 */
export const WEAK_PASSWORDS = [
  'bmy2025',
  'admin',
  'password',
  '123456',
  'admin123',
  '12345678',
  'qwerty',
];

/**
 * Admin usernames are embedded in session tokens
 * (`username:timestamp:signature`), so `:` is excluded and the charset is kept
 * narrow. Without this a username containing `:` silently breaks every token.
 */
export const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

/** Returns a problem description, or null when the password is acceptable. */
export function passwordProblem(password: string): string | null {
  if (!password) return '密码不能为空';
  if (password.length < MIN_PASSWORD_LENGTH) return `密码长度不少于${MIN_PASSWORD_LENGTH}位`;
  if (WEAK_PASSWORDS.includes(password.toLowerCase())) return '密码过于简单，请使用更安全的密码';
  return null;
}

/** Returns a problem description, or null when the username is acceptable. */
export function usernameProblem(user: string): string | null {
  if (!user) return '用户名不能为空';
  if (!USERNAME_PATTERN.test(user)) {
    return '用户名只能包含字母、数字、下划线、点或短横线（1-64 位）';
  }
  return null;
}
