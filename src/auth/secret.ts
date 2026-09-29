/**
 * secret.ts — The application-wide HMAC secret.
 *
 * Resolution order:
 *   1. `BMY_SESSION_SECRET` when set (recommended in production);
 *   2. a random 32-byte secret generated once and stored in
 *      `blog/data/secret.json` (mode 0600).
 *
 * The previous implementation fell back to a hard-coded, publicly known default
 * (`bmy-default-dev-secret-2024`), which let anyone forge an admin token. A
 * generated-and-persisted secret keeps zero-config deployments safe while
 * keeping sessions valid across restarts.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, SESSION_SECRET } from '../paths.ts';

let cached: Buffer | null = null;

function loadSecret(): Buffer {
  if (SESSION_SECRET) return Buffer.from(SESSION_SECRET, 'utf8');

  const file = path.join(DATA_DIR, 'secret.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { sessionSecret?: string };
    if (parsed.sessionSecret) return Buffer.from(parsed.sessionSecret, 'base64');
  } catch {
    /* first run — generate below */
  }

  const generated = crypto.randomBytes(32);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ sessionSecret: generated.toString('base64') }, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    console.log('[secret] generated a new session secret at blog/data/secret.json');
  } catch (err) {
    console.warn('[secret] could not persist the session secret:', (err as Error).message);
  }
  return generated;
}

/** The shared HMAC secret. */
export function getSecret(): Buffer {
  cached ??= loadSecret();
  return cached;
}

/** Base64url-encode without padding. */
export function b64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode a base64url string. */
export function fromB64url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** HMAC-SHA256 signature of a string, base64url-encoded. */
export function sign(value: string): string {
  return b64url(crypto.createHmac('sha256', getSecret()).update(value).digest());
}

/** Constant-time comparison of two strings. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Reset the cached secret (test/maintenance helper). */
export function resetSecretCache(): void {
  cached = null;
}
