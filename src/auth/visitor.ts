/**
 * visitor.ts — Signed session for non-admin visitors.
 *
 * The original implementation identified visitors by a plain `X-User-Email`
 * header, so anyone could impersonate a registered address and read the
 * calendar. Visitors now receive an HMAC-signed cookie bound to their email,
 * which the calendar endpoint verifies.
 *
 * Note: without an SMTP provider there is no way to prove ownership of an email
 * address, so `/api/auth/check` still grants a session to a known address on
 * request. This is documented in the README; the mail-verification gap is
 * inherent to a mail-less deployment.
 */
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { sign, safeEqual } from './secret.ts';

export const VISITOR_COOKIE = 'visitor_token';
const VISITOR_TTL = 7 * 24 * 3600;

interface Payload {
  e: string;
  t: number;
  n: string;
}

/** Issue a signed visitor token for an email address. */
export function createVisitorToken(email: string): string {
  const payload: Payload = {
    e: email.toLowerCase(),
    t: Math.floor(Date.now() / 1000),
    n: crypto.randomBytes(8).toString('hex'),
  };
  const part = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${part}.${sign(part)}`;
}

/** Validate a visitor token, returning the email or null. */
export function verifyVisitorToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const part = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(sign(part), signature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Payload;
    if (!payload?.e || !payload?.t) return null;
    if (payload.t + VISITOR_TTL < Math.floor(Date.now() / 1000)) return null;
    return payload.e;
  } catch {
    return null;
  }
}

/** Read the visitor email from the signed cookie, or null. */
export function getVisitorEmail(req: Request): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return verifyVisitorToken(cookies?.[VISITOR_COOKIE] ?? null);
}

export function setVisitorCookie(res: Response, token: string): void {
  res.cookie(VISITOR_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: VISITOR_TTL * 1000,
  });
}

export function clearVisitorCookie(res: Response): void {
  res.clearCookie(VISITOR_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax' });
}
