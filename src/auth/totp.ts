/**
 * totp.ts — RFC 6238 TOTP (two-factor authentication).
 *
 * HMAC-SHA1, 30-second steps, 6 digits, ±1 step of clock skew — byte-compatible
 * with the previous implementation and with Google Authenticator / Authy /
 * 1Password.
 */
import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

/** Decode an RFC 4648 base32 string (padding optional, case-insensitive). */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) throw new Error(`invalid base32 character: ${char}`);
    buffer = buffer * 32 + value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push(Math.floor(buffer / 2 ** bits) % 256);
      buffer %= 2 ** bits;
    }
  }
  return Buffer.from(bytes);
}

/** Encode bytes as RFC 4648 base32 without padding. */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/** Generate a new random base32 secret (160 bits, the RFC 4226 recommendation). */
export function generateSecret(bytes = 20): string {
  return base32Encode(crypto.randomBytes(bytes));
}

function hotp(key: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', key).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** Compute the TOTP code for a moment in time (defaults to now). */
export function generateTotp(secretB32: string, atSeconds = Math.floor(Date.now() / 1000)): string {
  const counter = Math.floor(atSeconds / STEP_SECONDS);
  return hotp(base32Decode(secretB32), counter);
}

/**
 * Verify a 6-digit code with ±1 step of skew.
 * Returns a result object so callers can distinguish "not configured" from
 * "wrong code" without exceptions.
 */
export function verifyTotp(
  secretB32: string,
  code: string | null | undefined,
  atSeconds = Math.floor(Date.now() / 1000),
): { ok: boolean; reason?: string } {
  if (!secretB32) return { ok: false, reason: 'No TOTP secret configured' };
  const cleaned = String(code ?? '').replace(/\s/g, '');
  if (!cleaned) return { ok: false, reason: 'No TOTP code provided' };
  if (!/^\d{6}$/.test(cleaned)) return { ok: false, reason: 'TOTP code must be 6 digits' };

  let key: Buffer;
  try {
    key = base32Decode(secretB32);
  } catch (err) {
    return { ok: false, reason: `Invalid TOTP secret: ${(err as Error).message}` };
  }

  const base = Math.floor(atSeconds / STEP_SECONDS);
  for (let offset = -1; offset <= 1; offset += 1) {
    if (hotp(key, base + offset) === cleaned) return { ok: true };
  }
  return { ok: false, reason: 'Invalid TOTP code' };
}

/** Build an otpauth:// provisioning URI for authenticator apps. */
export function provisioningUri(secretB32: string, user: string, issuer = 'BlogMaterialYou'): string {
  const label = encodeURIComponent(`${issuer}:${user}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
