/**
 * admin-auth.ts — Admin authentication guards.
 *
 * Two guards exist because the admin surface has two very different failure
 * modes: the JSON API must fail with a machine-readable 401, while the HTML
 * pages should bounce an anonymous visitor to the login form instead of
 * dumping JSON into the browser. Both share the same token lookup so a token
 * can never be accepted by one and rejected by the other.
 *
 * The session token itself lives in `src/auth/session.ts`; this file only
 * decides what to do when the token is missing or invalid.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getSessionToken, verifySession } from '../auth/session.ts';

/**
 * Resolve the admin username for a request, or null when unauthenticated.
 * Exported so routes that need to check the caller outside a guard (e.g. the
 * password-change endpoint, which is public-but-session-sensitive) can reuse
 * exactly the same logic.
 */
export function resolveAdminUser(req: Request): string | null {
  return verifySession(getSessionToken(req));
}

/**
 * API guard: respond 401 JSON when the session is missing/invalid.
 * The body matches every other admin API failure (`{errno:-1,errmsg}`), so the
 * frontend can treat "not logged in" like any other error and redirect.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = resolveAdminUser(req);
  if (!user) {
    res.status(401).json({ errno: -1, errmsg: 'Unauthorized' });
    return;
  }
  // `res.locals` is the only request-scoped store the templates can see, so the
  // username is attached there as well for the admin layout (e.g. the sidebar).
  res.locals.adminUser = user;
  next();
}

/**
 * Page guard: redirect anonymous visitors to the login form.
 *
 * A 302 (not 401) keeps normal browser navigation working; the login page
 * itself is mounted outside this guard so the redirect cannot loop.
 */
export function requireAdminPage(req: Request, res: Response, next: NextFunction): void {
  const user = resolveAdminUser(req);
  if (!user) {
    res.redirect(302, '/admin/login/');
    return;
  }
  res.locals.adminUser = user;
  next();
}

/**
 * Wrap a route handler so any thrown/rejected error becomes a 500 JSON body
 * instead of Express' default HTML error page. Handlers may be async: the
 * wrapper awaits them and funnels rejections into the same path.
 */
export function adminApiHandler(
  fn: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res, next);
    } catch (err) {
      // A handler may already have streamed a response (export/import); never
      // append a second body once headers are out.
      if (res.headersSent) return;
      const message = err instanceof Error ? err.message : 'Internal error';
      console.error(`[admin] ${req.method} ${req.originalUrl} failed:`, message);
      res.status(500).json({ errno: -1, errmsg: message });
    }
  };
}
