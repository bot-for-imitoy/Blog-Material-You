/**
 * engine.ts — EJS rendering for the server-rendered site.
 *
 * The original implementation shipped an empty SPA shell for every URL and
 * filled it with a client-side `fetch` of an HTML fragment, which meant
 * crawlers (and no-JS readers) saw nothing. Every route now returns a complete
 * document: a page view rendered into a layout.
 *
 * Templates receive a consistent set of globals and helpers so the views stay
 * declarative and no template has to re-implement escaping or date handling.
 */
import path from 'node:path';
import ejs from 'ejs';
import { VIEWS_DIR } from '../paths.ts';
import { escapeHtml, formatDate, formatDateTime, truncate } from '../lib/text.ts';
import { templateGlobals } from '../site-config.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import { type MediaOptions, mediaSrcset, mediaUrl } from '../media/resize.ts';

/** Helpers injected into every template. */
export interface TemplateHelpers {
  /** HTML-escape a value. */
  h: (value: unknown) => string;
  /** Normalise a date to YYYY-MM-DD. */
  formatDate: (value: unknown) => string;
  /** Format a unix timestamp as YYYY-MM-DD HH:mm. */
  formatDateTime: (value: number) => string;
  /** UTF-8-safe truncation. */
  truncate: (value: unknown, max: number) => string;
  /** Percent-encode a path segment. */
  urlEncode: (value: unknown) => string;
  /** Render Markdown to HTML (trusted, admin-authored content). */
  md: (source: unknown) => string;
  /** Resolve a UI string key. */
  t: (key: string) => string;
  /** Whether a menu route should be highlighted for the current path. */
  isActiveNav: (route: string, currentPath: string) => boolean;
  /**
   * Rewrite an image URL to a server-side resize of the requested size. Remote
   * URLs and `data:` URIs pass through untouched, so any image can be handed to
   * it without checking first.
   */
  mediaUrl: (src: unknown, options?: MediaOptions) => string;
  /** The `srcset` counterpart of `mediaUrl`; empty for non-local images. */
  mediaSrcset: (src: unknown, widths?: readonly number[], options?: MediaOptions) => string;
}

export interface PageSeo {
  title: string;
  desc: string;
  canonical: string;
  /** Absolute canonical URL when the site URL is configured. */
  canonicalUrl: string;
}

export interface RenderData {
  [key: string]: unknown;
  seo?: PageSeo;
  currentPath?: string;
  /** Extra stylesheet hrefs for this page. An object form allows a `media` query. */
  styles?: Array<string | { href: string; media?: string }>;
  /** Extra page-level ES module hrefs for this page. */
  pageScripts?: string[];
  /** Extra <head> markup (e.g. RSS autodiscovery). */
  headExtra?: string;
  bodyClass?: string;
}

/**
 * Sidebar highlighting. A few menu entries own more than one URL prefix — for
 * example `/posts/` also covers individual `/post/<slug>` pages, and `/about/`
 * also covers `/pages/about/`.
 */
function isActiveNav(route: string, currentPath: string): boolean {
  const current = currentPath || '/';
  switch (route) {
    case '/':
      return current === '/' || current === '';
    case '/posts/':
      return current.startsWith('/posts') || current.startsWith('/post/');
    case '/tags/':
      return current.startsWith('/tags');
    case '/categories/':
      return current.startsWith('/categories');
    case '/archives/':
      return current.startsWith('/archives');
    case '/talks/':
      return current.startsWith('/talks');
    case '/friends/':
      return current.startsWith('/friends');
    case '/about/':
      return current.startsWith('/about') || current.startsWith('/pages/about');
    default:
      return current === route;
  }
}

const helpers: TemplateHelpers = {
  h: escapeHtml,
  formatDate,
  formatDateTime,
  truncate,
  urlEncode: (value) => encodeURIComponent(String(value ?? '')),
  md: (source) => renderMarkdown(source, true).html,
  t: (key) => templateGlobals().t(key),
  isActiveNav,
  mediaUrl,
  mediaSrcset,
};

let cachedOptions: ejs.Options | null = null;

function options(): ejs.Options {
  cachedOptions ??= {
    root: VIEWS_DIR,
    views: [VIEWS_DIR],
    cache: process.env.NODE_ENV === 'production',
  };
  return cachedOptions;
}

/** Render a single template file to a string. */
export async function renderView(view: string, data: RenderData = {}): Promise<string> {
  const file = path.join(VIEWS_DIR, `${view}.ejs`);
  const globals = templateGlobals();
  return ejs.renderFile(
    file,
    {
      ...globals,
      ...helpers,
      currentPath: '/',
      styles: [],
      pageScripts: [],
      headExtra: '',
      bodyClass: '',
      ...data,
    },
    options(),
  );
}

/**
 * Render a page view and wrap it in a layout.
 * The layout receives the rendered page as `body` (inserted unescaped).
 */
export async function renderPage(
  view: string,
  data: RenderData = {},
  layout = 'layouts/public',
): Promise<string> {
  const body = await renderView(view, data);
  const globals = templateGlobals();
  return ejs.renderFile(
    path.join(VIEWS_DIR, `${layout}.ejs`),
    {
      ...globals,
      ...helpers,
      currentPath: '/',
      styles: [],
      pageScripts: [],
      headExtra: '',
      bodyClass: '',
      ...data,
      body,
    },
    options(),
  );
}

/** Build the SEO block for a route, filling in the canonical URL. */
export function buildSeo(partial: Omit<PageSeo, 'canonicalUrl'>): PageSeo {
  const { site } = templateGlobals();
  const base = site.url.replace(/\/+$/, '');
  return {
    ...partial,
    canonicalUrl: base ? `${base}${partial.canonical}` : partial.canonical,
  };
}
