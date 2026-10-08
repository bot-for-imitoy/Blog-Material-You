/**
 * profile-page.ts — Render the standalone personal card (`/profile/`).
 *
 * Extracted from the public pages router when the card moved to its own port:
 * the profile app (profile-app.ts) serves it now, and the code is shared
 * through this module so the blog and the profile server can never drift.
 *
 * The page renders through the `blank` layout: it owns the whole viewport
 * (blurred night background + glass card) and deliberately does not inherit
 * the site shell. Fully static — the expandable panels are `<details>`, so the
 * page needs no JavaScript at all.
 */
import type express from 'express';
import { getSiteSettings } from './site-config.ts';
import { renderPage } from './render/engine.ts';
import { seoForRoute } from './render/seo.ts';
import { buildColorScheme, hexToRgbTriple, normaliseHex } from './lib/color-scheme.ts';
import { getVisits, recordVisit } from './store/visits.ts';

/** Stylesheets of the profile view (same list the public router used). */
const PROFILE_STYLES = ['/css/profile.css'];

export async function sendProfilePage(
  res: express.Response,
  options: { countVisit?: boolean; currentPath?: string } = {},
): Promise<boolean> {
  const { countVisit = true, currentPath = '/profile/' } = options;
  const settings = getSiteSettings();
  // Single switch: `profile.enabled` in _config.yml.
  if (!settings.profile.enabled) return false;

  if (countVisit) {
    // A counter failure must never take the page down with it.
    try {
      recordVisit('profile');
    } catch (err) {
      console.warn('[visits] could not record the profile visit:', (err as Error).message);
    }
  }

  const accent =
    normaliseHex(settings.profile.accent) ?? buildColorScheme(settings.themeColor).seed;
  const html = await renderPage(
    'pages/profile',
    {
      seo: seoForRoute(currentPath),
      currentPath,
      styles: PROFILE_STYLES,
      profile: settings.profile,
      bodyClass: 'pf-body',
      visits: getVisits(),
      // The card's accent, handed to the stylesheet as custom properties.
      // `profile.accent` pins the colour; empty follows the site theme, so
      // changing `theme.color` re-themes this page too. An inline <style> is
      // fine here — `style-src` allows 'unsafe-inline' (mdui needs it for
      // runtime style attributes) while scripts stay locked down.
      headExtra:
        `<style>:root{--pf-accent:${accent};--pf-accent-rgb:${hexToRgbTriple(accent)};}</style>`,
    },
    'layouts/blank',
  );
  res.type('html').send(html);
  return true;
}
