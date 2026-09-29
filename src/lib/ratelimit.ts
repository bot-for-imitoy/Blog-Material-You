/**
 * ratelimit.ts — Tiny in-memory rate limiter.
 *
 * nginx used to provide `limit_req` zones for the login, setup and posts
 * endpoints. The Node rewrite has to enforce that itself, so this implements a
 * fixed-window counter keyed by client IP + route.
 *
 * Note: state is per process. A multi-instance deployment should put a reverse
 * proxy in front (the README documents this).
 */
import type { NextFunction, Request, Response } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum requests allowed per window. */
  max: number;
  /** Bucket key prefix. */
  name: string;
  /** Message returned when the limit is exceeded. */
  message?: string;
}

const buckets = new Map<string, Bucket>();

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/** Periodically drop expired buckets so the map cannot grow without bound. */
const janitor = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.resetAt < now) buckets.delete(key);
}, 60_000);
janitor.unref?.();

/**
 * Build an Express middleware enforcing a fixed-window limit.
 * Responds 429 with a JSON body (the original relied on nginx's HTML 503; JSON
 * is more useful for an API and is what the admin frontend expects).
 */
export function rateLimit(options: RateLimitOptions) {
  const message = options.message ?? '请求过于频繁，请稍后再试';
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${options.name}:${clientIp(req)}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({ errno: -1, errmsg: message });
      return;
    }
    next();
  };
}

/** Counter helper used by one-off limits (e.g. avatar uploads). */
export function hitCounter(name: string, identity: string, windowMs: number): number {
  const key = `${name}:${identity}`;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  bucket.count += 1;
  return bucket.count;
}
