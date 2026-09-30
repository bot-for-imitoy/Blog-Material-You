/**
 * pjax.js — seamless navigation, as progressive enhancement.
 *
 * The site is server-rendered and stays that way: every URL still returns a
 * complete document, so crawlers, `curl` and browsers without JavaScript get
 * exactly what they got before. This module only changes what happens *after*
 * the first page has loaded — it intercepts internal link clicks, fetches the
 * next document, and replaces the parts that actually differ:
 *
 *   - the content region (`#content-container`),
 *   - the page's own stylesheets,
 *   - `<title>`, the description / Open Graph / canonical tags,
 *   - the sidebar's active highlight,
 *   - `<body class>`, and the page's own scripts.
 *
 * Everything else — the top app bar, the navigation drawer with its scroll
 * position and open state, mdui's already-upgraded custom elements, the
 * inline Material You palette — is left untouched, which is what makes the
 * transition feel instant instead of like a reload.
 *
 * A previous version of this site was a client-rendered shell that fetched
 * page fragments; that was replaced precisely because the initial HTML was an
 * empty container. Doing this as an enhancement layer over full SSR avoids
 * that failure mode entirely, and any error here falls back to a normal
 * navigation.
 */

/** The region that is swapped on navigation. */
const CONTAINER_SELECTOR = '#content-container';

/** Links inside these path prefixes are left to the browser. */
const EXCLUDED_PREFIXES = ['/admin', '/profile'];

/** File extensions that are never HTML documents. */
const NON_HTML = /\.(xml|json|txt|csv|pdf|zip|gz|png|jpe?g|gif|svg|webp|avif|ico|mp3|mp4|webm|woff2?|ttf|eot)$/i;

/** Head elements kept in sync, as [selector, attribute]. */
const HEAD_SYNC = [
  ['meta[name="description"]', 'content'],
  ['meta[property="og:title"]', 'content'],
  ['meta[property="og:description"]', 'content'],
  ['link[rel="canonical"]', 'href'],
];

/** Link hints that differ per page and should not pile up. */
const LINK_GROUPS = ['stylesheet', 'modulepreload'];

/** Parsed documents kept for instant back/forward. */
const CACHE_MAX = 15;
const CACHE_TTL_MS = 60_000;

const cache = new Map();

/** [url, module] pairs for the scripts currently initialised. */
let activeScripts = [];

/** In-flight navigation, so a second click can cancel the first. */
let pending = null;

/** Where a popstate restore wants the viewport put back. */
let restoreScrollY = null;

// =====================================================================
// Helpers
// =====================================================================

/** Same-origin check that also tolerates the page being served on a port. */
function isSameOrigin(url) {
  return url.origin === window.location.origin;
}

/** The page scripts a document declares, via the container's data attribute. */
function scriptsOf(element) {
  if (!element) return [];
  try {
    const parsed = JSON.parse(element.dataset.pjaxScripts || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Whether a URL may be handled by pjax at all.
 *
 * Exported so the rule is testable in isolation and so the intent is explicit:
 * anything that is not a same-origin HTML document inside the public site is
 * left to the browser. `/admin` has its own shell, `/profile/` is a standalone
 * document with no content container, and feeds/images/archives must download
 * normally.
 */
export function isEligibleUrl(url) {
  if (!isSameOrigin(url)) return false;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (NON_HTML.test(url.pathname)) return false;
  if (EXCLUDED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return false;
  return true;
}

/**
 * Turn a click into a navigable URL, or null when the browser should handle it.
 *
 * Custom elements matter here: `<mdui-list-item href>` and `<mdui-button-icon
 * href>` render their anchor inside a shadow root, so `event.target` is
 * retargeted to the host and `closest('a')` finds nothing. Those hosts are
 * matched explicitly, and their `href` attribute is read directly.
 */
function resolveLink(event) {
  if (event.defaultPrevented) return null;
  if (event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;

  const target = event.target instanceof Element ? event.target : null;
  if (!target) return null;

  let element = target.closest('a[href]');
  if (!element) {
    const host = target.closest('[href]');
    if (host && host.tagName.startsWith('MDUI-')) element = host;
  }
  if (!element) return null;

  // An explicit opt-out, for links that must do a real navigation.
  if (element.closest('[data-pjax-ignore]')) return null;

  const raw = element.getAttribute('href');
  if (!raw || raw.startsWith('#')) return null;
  if (/^(mailto:|tel:|javascript:|data:)/i.test(raw)) return null;
  if (element.hasAttribute('download')) return null;
  const targetAttr = element.getAttribute('target');
  if (targetAttr && targetAttr !== '_self') return null;

  let url;
  try {
    url = new URL(raw, window.location.href);
  } catch {
    return null;
  }

  if (!isEligibleUrl(url)) return null;

  // Same document + only a fragment: let the browser scroll.
  if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) {
    return null;
  }

  return url;
}

// =====================================================================
// Fetching
// =====================================================================

function readCache(url) {
  const hit = cache.get(url);
  if (!hit) return null;
  if (Date.now() - hit.time > CACHE_TTL_MS) {
    cache.delete(url);
    return null;
  }
  return hit.doc;
}

function writeCache(url, doc) {
  cache.set(url, { time: Date.now(), doc });
  // Drop the oldest entries; Map preserves insertion order.
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

async function fetchDocument(url, { signal, allowCache = false } = {}) {
  if (allowCache) {
    const cached = readCache(url);
    if (cached) return cached;
  }

  const response = await fetch(url, {
    signal,
    credentials: 'same-origin',
    headers: { Accept: 'text/html' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) throw new Error(`unexpected content-type: ${type}`);

  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  // A response without the container is not something we can swap into; treat
  // it as a failure so the caller falls back to a normal navigation. This is
  // what keeps `/profile/` (a standalone document) working.
  if (!doc.querySelector(CONTAINER_SELECTOR)) throw new Error('response has no pjax container');

  writeCache(url, doc);
  return doc;
}

// =====================================================================
// Patching the current document
// =====================================================================

/** `<title>` and the head tags whose values are page-specific. */
function syncHead(doc) {
  document.title = doc.title;

  for (const [selector, attribute] of HEAD_SYNC) {
    const next = doc.querySelector(selector);
    const current = document.head.querySelector(selector);
    if (!next) {
      // Not present on the new page: remove ours so it cannot describe the
      // wrong content (e.g. a stale canonical URL).
      if (current) current.remove();
      continue;
    }
    if (!current) {
      document.head.append(next.cloneNode(true));
      continue;
    }
    const value = next.getAttribute(attribute);
    if (value !== null && current.getAttribute(attribute) !== value) {
      current.setAttribute(attribute, value);
    }
  }
}

/**
 * Reconcile `<link>` tags by href, so a page's own stylesheet is added on the
 * way in and removed on the way out, while the shared base never churns.
 */
function syncLinks(doc, rel) {
  const selector = `link[rel="${rel}"]`;
  const hrefs = (root) =>
    Array.from(root.querySelectorAll(selector))
      .map((link) => link.getAttribute('href'))
      .filter((href) => href);

  const next = new Set(hrefs(doc));
  const current = hrefs(document);

  for (const href of current) {
    if (!next.has(href)) {
      document.head.querySelector(`${selector}[href="${CSS.escape(href)}"]`)?.remove();
    }
  }
  for (const href of next) {
    if (!current.includes(href)) {
      const source = doc.querySelector(`${selector}[href="${CSS.escape(href)}"]`);
      if (source) document.head.append(source.cloneNode(true));
    }
  }
}

/**
 * Copy the sidebar's active marker from the freshly rendered document rather
 * than recomputing it, so the rule for "which menu entry is current" lives in
 * exactly one place (the server's `isActiveNav`).
 */
function syncNavigation(doc) {
  for (const item of document.querySelectorAll('[data-route]')) {
    const route = item.getAttribute('data-route');
    if (!route) continue;
    const next = doc.querySelector(`[data-route="${CSS.escape(route)}"]`);
    if (!next) continue;
    if (next.hasAttribute('active')) item.setAttribute('active', '');
    else item.removeAttribute('active');
  }
}

// =====================================================================
// Page scripts
// =====================================================================

/**
 * Tear down the scripts that belong to the page being left.
 *
 * The layout loads the current page's scripts with plain `<script type="module">`
 * tags, and those self-initialise. `import()` returns the same, already
 * evaluated module, so this does not run anything twice — it just gets a handle
 * to call `destroy()` on.
 */
async function releaseScripts() {
  const entries = activeScripts;
  activeScripts = [];
  window.__pjax = window.__pjax || {};

  for (const [url, module] of entries) {
    try {
      let mod = module;
      if (!mod) {
        window.__pjax.importing = true;
        mod = await import(url);
      }
      mod.destroy?.();
    } catch (err) {
      console.error('[pjax] could not tear down', url, err);
    } finally {
      window.__pjax.importing = false;
    }
  }
}

/**
 * Import and initialise the incoming page's scripts.
 *
 * `window.__pjax.importing` is set around the import because a module that has
 * not been evaluated yet runs its body during `import()`; the guard at the
 * bottom of each page script uses this flag to skip its own auto-init, so
 * initialisation happens exactly once — here.
 */
async function activateScripts(urls) {
  window.__pjax = window.__pjax || {};
  const entries = [];

  for (const url of urls) {
    try {
      window.__pjax.importing = true;
      entries.push([url, await import(url)]);
    } catch (err) {
      console.error('[pjax] could not load', url, err);
    } finally {
      window.__pjax.importing = false;
    }
  }

  activeScripts = entries;

  for (const [url, mod] of entries) {
    try {
      mod.init?.();
    } catch (err) {
      console.error('[pjax] could not initialise', url, err);
    }
  }
}

/** Re-run the shell-level enhancements on the freshly swapped content. */
async function refreshShell() {
  try {
    const app = await import('/js/app.js');
    app.init?.();
  } catch (err) {
    console.error('[pjax] shell refresh failed', err);
  }
}

// =====================================================================
// The swap
// =====================================================================

async function swap(doc) {
  const nextContainer = doc.querySelector(CONTAINER_SELECTOR);
  const container = document.querySelector(CONTAINER_SELECTOR);
  if (!nextContainer || !container) throw new Error('missing container');

  const nextScripts = scriptsOf(nextContainer);

  // Release first: the old scripts' listeners must be gone before their DOM is.
  await releaseScripts();

  const apply = () => {
    container.innerHTML = nextContainer.innerHTML;

    // `innerHTML` does not carry the container's own attributes, so the ones
    // that are page-specific have to be copied across by hand. Leaving
    // `data-pjax-scripts` stale would make a later teardown release the wrong
    // modules.
    container.dataset.pjaxScripts = nextContainer.dataset.pjaxScripts || '[]';
    if (nextContainer.className !== container.className) container.className = nextContainer.className;

    syncHead(doc);
    for (const rel of LINK_GROUPS) syncLinks(doc, rel);
    syncNavigation(doc);
    if (doc.body && doc.body.className !== document.body.className) {
      document.body.className = doc.body.className;
    }
  };

  // A cross-fade scoped to the content, where the View Transitions API is
  // available. The alternative is an instant swap, which is also fine.
  if (typeof document.startViewTransition === 'function') {
    await document.startViewTransition(apply).finished.catch(() => {});
  } else {
    apply();
  }

  await activateScripts(nextScripts);
  await refreshShell();
}

// =====================================================================
// Navigation
// =====================================================================

function progressStart() {
  document.documentElement.setAttribute('data-pjax-loading', '');
}

function progressDone() {
  document.documentElement.removeAttribute('data-pjax-loading');
}

// =====================================================================
// Scrolling
//
// The shell is a 100vh flex column and `.content-container` is the scroll box
// (`overflow: auto`, see css/content-container.css), so the *window* never
// scrolls on a public page. mdui's top app bar is bound to that same element
// through `scroll-target`, which is why scrolling the window changed nothing:
// the app bar's `elevate` state is derived from the container's scroll offset.
// =====================================================================

/** The element a navigation scrolls. Null only if the shell is missing. */
function scrollElement() {
  return document.querySelector(CONTAINER_SELECTOR);
}

/** Current scroll offset of the content region. */
function getScrollTop() {
  const element = scrollElement();
  return element ? element.scrollTop : window.scrollY;
}

/**
 * Move the content region to `top`. The window is moved too, so this stays
 * correct on a page rendered without the shell (and is a no-op otherwise).
 */
function setScrollTop(top) {
  const element = scrollElement();
  if (element) element.scrollTop = top;
  window.scrollTo(0, top);
}

/**
 * Blocks the scroll listener while a navigation moves the viewport itself.
 * A counter rather than a flag because a navigation can be superseded by
 * another one before the first has finished unwinding.
 */
let recordingSuppressed = 0;

/** Remember where the viewport is, so back/forward can put it back. */
let scrollFrame = 0;
window.addEventListener(
  'scroll',
  () => {
    if (recordingSuppressed > 0) return;
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (history.state && history.state.pjax) {
        history.replaceState({ ...history.state, scrollY: getScrollTop() }, '');
      }
    });
  },
  { passive: true },
);

async function navigate(url, { push = true, scrollTo = 0 } = {}) {
  if (pending) pending.abort();
  const controller = new AbortController();
  pending = controller;

  // Freeze the outgoing entry's offset before the viewport moves: this is the
  // position "back" has to restore, and it is about to be overwritten by our
  // own jump to the top.
  const originY = getScrollTop();
  if (history.state && history.state.pjax) {
    history.replaceState({ ...history.state, scrollY: originY }, '');
  }

  progressStart();

  // Return to the top *before* the swap. The incoming page always starts at the
  // top, so the app bar has to be in its "at the top" state by the time that
  // page is on screen — otherwise it keeps the elevated colour it inherited
  // from the page being left, and stays visually detached from the background.
  recordingSuppressed += 1;
  setScrollTop(0);

  try {
    const doc = await fetchDocument(url, { signal: controller.signal });
    if (controller.signal.aborted) return;

    // The URL has to be current *before* the incoming page's scripts run.
    // They read `window.location` — comments.js keys its request on the path —
    // and this used to happen after the swap, so a freshly navigated post
    // fetched the comment list for the page it had just left and only showed
    // its comments after a manual reload.
    if (push) {
      history.pushState({ pjax: true, scrollY: 0 }, '', `${url.pathname}${url.search}`);
    }

    await swap(doc);
    setScrollTop(scrollTo);
  } catch (err) {
    if (controller.signal.aborted) return;
    // Anything unexpected: hand the navigation back to the browser, which is
    // always correct, just slower.
    console.warn('[pjax] falling back to a full navigation:', err);
    window.location.href = url.href;
    return;
  } finally {
    recordingSuppressed -= 1;
    if (pending === controller) pending = null;
    progressDone();
  }
}

document.addEventListener('click', (event) => {
  const url = resolveLink(event);
  if (!url) return;

  // Current location with a different query only — still a normal navigation
  // if it is byte-identical.
  if (url.href === window.location.href) {
    event.preventDefault();
    return;
  }

  event.preventDefault();
  void navigate(url);
});

window.addEventListener('popstate', (event) => {
  // The entry we are returning to carries its own scroll offset; `event.state`
  // is that entry's state.
  const state = event.state && event.state.pjax ? event.state : null;
  restoreScrollY = state ? state.scrollY || 0 : null;

  const url = new URL(window.location.href);
  if (pending) pending.abort();
  const controller = new AbortController();
  pending = controller;

  progressStart();
  // The viewport is restored by hand below, so the listener must not record the
  // intermediate positions the swap passes through.
  recordingSuppressed += 1;
  (async () => {
    try {
      // `allowCache` is what makes going back feel instant.
      const doc = await fetchDocument(url, { signal: controller.signal, allowCache: true });
      if (controller.signal.aborted) return;
      await swap(doc);
      // Unlike a click, going back puts the reader where they left off — see
      // `originY` in navigate(), which is what recorded this offset.
      setScrollTop(restoreScrollY ?? 0);
    } catch (err) {
      if (!controller.signal.aborted) window.location.reload();
      console.warn('[pjax] back/forward failed:', err);
    } finally {
      recordingSuppressed -= 1;
      if (pending === controller) pending = null;
      restoreScrollY = null;
      progressDone();
    }
  })();
});

/**
 * Record the scripts the first page already initialised, so the first
 * navigation can tear them down. They are deliberately not initialised here:
 * the layout's own `<script type="module">` tags have already run.
 */
function bootstrap() {
  const container = document.querySelector(CONTAINER_SELECTOR);
  activeScripts = scriptsOf(container).map((url) => [url, null]);
  // Seed the history entry so back/forward can restore the scroll position.
  // `getScrollTop`, not `window.scrollY`: the window is not the scroller here,
  // so seeding from it would restore every page to the top.
  history.replaceState({ pjax: true, scrollY: getScrollTop() }, '');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
