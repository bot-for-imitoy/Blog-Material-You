/**
 * session.ts — Admin session tokens.
 *
 * A token is `base64url(payload) . base64url(HMAC-SHA256(secret, payload))`
 * where the payload carries the username, issue time and a random nonce. The
 * signature makes the token verifiable without server state; the in-process
 * registry adds real revocation (logout, password change) and expiry.
 *
 * Differences from the original implementation, all deliberate:
 *  - the default secret is generated and persisted instead of hard-coded;
 *  - logout genuinely revokes (the original only dropped the cookie, so the
 *    token stayed valid until it expired);
 *  - changing the password invalidates every outstanding session;
 *  - a nonce makes tokens unique even when two logins happen in one second.
 */
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { SESSION_TTL } from '../paths.ts';
import { b64url, fromB64url, safeEqual, sign } from './secret.ts';

export const ADMIN_COOKIE = 'admin_token';

interface Payload {
  /** username */
  u: string;
  /** issued at (unix seconds) */
  t: number;
  /** random nonce */
  n: string;
  /** revocation epoch the token was minted in (absent in pre-epoch tokens) */
  e?: number;
}

interface Entry {
  username: string;
  expiresAt: number;
  /** Epoch this token belongs to; a stale entry must not authenticate. */
  epoch: number;
}

/**
 * Revocation epoch — the fix for "log out everywhere".
 *
 * Deleting an entry from the in-process registry is not enough: `verifySession`
 * falls back to stateless signature verification (so a token keeps working
 * after a restart or in a second worker), and that fallback used to re-register
 * the token, silently resurrecting a logged-out session. Embedding the epoch in
 * the payload makes revocation verifiable without the registry: bumping the
 * epoch invalidates every token minted earlier, in every process that shares
 * the bump. Pre-epoch tokens count as epoch 0, so deploying this change does
 * not log everyone out.
 */
let epoch = 0;

/**
 * Individually revoked tokens (logout) → expiry, in unix seconds.
 *
 * The registry delete alone never stuck: `verifySession` re-registers any token
 * whose signature is valid, so a logged-out token kept working. The original
 * OpenResty implementation blacklisted the token in a shared dict for exactly
 * this reason; this is the in-process equivalent. Entries are pruned once the
 * token would have expired anyway.
 */
const revoked = new Map<string, number>();

/** In-process session registry: enables logout and forced invalidation. */
const registry = new Map<string, Entry>();
const tempTokens = new Map<string, { username: string; expiresAt: number }>();

const TEMP_TTL = 300;

/** Create a signed session token for a username. */
export function createSession(username: string): string {
  const payload: Payload = {
    u: username,
    t: Math.floor(Date.now() / 1000),
    n: crypto.randomBytes(12).toString('hex'),
    e: epoch,
  };
  const payloadPart = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const token = `${payloadPart}.${sign(payloadPart)}`;
  registry.set(token, { username, expiresAt: payload.t + SESSION_TTL, epoch });
  return token;
}

/** Validate a token, returning the username or null. */
export function verifySession(token: string | null | undefined): string | null {
  if (!token) return null;
  // Revoked before anything else: a logged-out token must never authenticate.
  if (revoked.has(token)) return null;

  const entry = registry.get(token);
  if (entry) {
    if (entry.expiresAt * 1000 < Date.now() || entry.epoch !== epoch) {
      registry.delete(token);
      return null;
    }
    return entry.username;
  }

  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payloadPart = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(sign(payloadPart), signature)) return null;

  let payload: Payload;
  try {
    payload = JSON.parse(fromB64url(payloadPart).toString('utf8')) as Payload;
  } catch {
    return null;
  }
  if (!payload?.u || !payload?.t) return null;
  if (payload.t + SESSION_TTL < Math.floor(Date.now() / 1000)) return null;
  // A token minted before the last "log out everywhere" must not be accepted
  // just because the registry has no entry for it (restart / other worker).
  if ((payload.e ?? 0) !== epoch) return null;

  registry.set(token, { username: payload.u, expiresAt: payload.t + SESSION_TTL, epoch });
  return payload.u;
}

/** Revoke a single session (logout). */
export function destroySession(token: string | null | undefined): void {
  if (!token) return;
  registry.delete(token);
  revoked.set(token, Math.floor(Date.now() / 1000) + SESSION_TTL);
}

/**
 * Revoke every session. Called after a password or username change so a stolen
 * token cannot outlive the credential it was minted for.
 *
 * Clearing the registry alone was not enough: a signed token is still accepted
 * statelessly after the entry disappears, so the epoch is bumped as well. That
 * makes the revocation hold for tokens the registry no longer remembers.
 */
export function destroyAllSessions(): void {
  epoch += 1;
  registry.clear();
  tempTokens.clear();
  // Every existing token is already epoch-rejected, so the blacklist is moot.
  revoked.clear();
}

/** Extract the token from the Authorization header or the admin cookie. */
export function getSessionToken(req: Request): string | null {
  const header = req.get('authorization');
  if (header) {
    const match = header.match(/^\s*Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }
  const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.[ADMIN_COOKIE];
  return cookie && cookie !== '' ? cookie : null;
}

export function setSessionCookie(res: Response, token: string, maxAge = SESSION_TTL): void {
  res.cookie(ADMIN_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: false,
    maxAge: maxAge * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(ADMIN_COOKIE, { path: '/', httpOnly: true, sameSite: 'strict' });
}

// ===================== Two-step login handshake =====================

/** Issue a short-lived, one-time token after the password step. */
export function createTempToken(username: string): string {
  const token = crypto.randomBytes(24).toString('base64url');
  tempTokens.set(token, { username, expiresAt: Date.now() + TEMP_TTL * 1000 });
  return token;
}

/** Consume a temp token (strictly one-time: a failed TOTP attempt burns it). */
export function consumeTempToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const entry = tempTokens.get(token);
  if (!entry) return null;
  tempTokens.delete(token);
  if (entry.expiresAt < Date.now()) return null;
  return entry.username;
}

/** Periodically drop expired registry entries. */
export function startSessionJanitor(): void {
  const timer = setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const [token, entry] of registry) if (entry.expiresAt < now) registry.delete(token);
    // Revoked tokens are pruned once they would have expired on their own.
    for (const [token, expiresAt] of revoked) if (expiresAt < now) revoked.delete(token);
    const nowMs = Date.now();
    for (const [token, entry] of tempTokens) if (entry.expiresAt < nowMs) tempTokens.delete(token);
  }, 60_000);
  timer.unref?.();
}
