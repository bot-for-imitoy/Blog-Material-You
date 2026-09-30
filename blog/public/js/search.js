/**
 * search.js — progressive enhancement for /search/.
 *
 * The page already works without JavaScript: it is a plain GET form that
 * renders server-side results. This module upgrades it to live, as-you-type
 * results by querying `/api/search` and rebuilding the result list in place.
 *
 * Safety notes:
 *  - No `innerHTML` anywhere. The API returns plain `title`/`snippet` text plus
 *    the `tokens` that matched, and the highlighting is applied here with
 *    `createElement('mark')` + `textContent`, so post content can never inject
 *    markup. (The server also ships pre-escaped `*Html` fields for the
 *    no-JavaScript render, but they are deliberately unused here.)
 *  - `history.replaceState` keeps the URL shareable without adding a history
 *    entry per keystroke.
 *
 * The module is imported once (ES modules are evaluated once) but the search
 * page is re-created on every pjax navigation, so every DOM handle is acquired
 * by init() and released by destroy() instead of being captured at module scope.
 */
const DEBOUNCE_MS = 220;
const RESULT_LIMIT = 20;

/* ==========================================================================
 * Instance state
 *
 * The module body runs a single time; the pjax controller calls init() again
 * for every swapped-in page. Nothing below may therefore cache a node from the
 * previous page: init() re-reads all of it and destroy() drops it.
 * ======================================================================== */

/** Root of the search page, or null while that page is not mounted. */
let page = null;
let form = null;
let input = null;
let results = null;
let status = null;
/** Localised strings, re-parsed from the page root on every init(). */
let strings = {};

/** Whether the current instance acquired state (used to stay re-entrant). */
let initialised = false;

/** Replace `{n}` / `{q}` placeholders in a template string. */
function format(template, values) {
  return String(template || '').replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

/**
 * Append `text` to `parent`, wrapping every occurrence of any token in <mark>.
 * Everything is inserted with textContent, so no markup can leak through.
 */
function appendHighlighted(parent, text, tokens) {
  const source = String(text ?? '');
  if (!source) return;
  if (!tokens || tokens.length === 0) {
    parent.appendChild(document.createTextNode(source));
    return;
  }

  const lower = source.toLowerCase();
  // Collect non-overlapping match ranges for all tokens.
  const ranges = [];
  for (const token of tokens) {
    let at = lower.indexOf(token);
    while (at !== -1) {
      ranges.push([at, at + token.length]);
      at = lower.indexOf(token, at + token.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);

  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue; // skip overlaps
    if (start > cursor) parent.appendChild(document.createTextNode(source.slice(cursor, start)));
    const mark = document.createElement('mark');
    mark.className = 'search-mark';
    mark.textContent = source.slice(start, end);
    parent.appendChild(mark);
    cursor = end;
  }
  if (cursor < source.length) parent.appendChild(document.createTextNode(source.slice(cursor)));
}

/** Build one <mdui-chip> linking to a tag or category page. */
function buildChip(kind, value) {
  const chip = document.createElement('mdui-chip');
  chip.setAttribute('rounded', '');
  chip.setAttribute('href', `/${kind}/${encodeURIComponent(value)}/`);
  const icon = document.createElement('mdui-icon');
  icon.setAttribute('src', kind === 'tags' ? '/icon/tag.svg' : '/icon/category.svg');
  icon.setAttribute('slot', 'icon');
  chip.appendChild(icon);
  chip.appendChild(document.createTextNode(value));
  return chip;
}

/** Build one result card, mirroring views/pages/search.ejs. */
function buildResult(hit, tokens) {
  const card = document.createElement('mdui-card');
  card.className = 'search-result';
  card.setAttribute('variant', 'elevated');

  const link = document.createElement('a');
  link.className = 'search-result-link';
  link.href = `/post/${encodeURIComponent(hit.slug)}`;
  const title = document.createElement('div');
  title.className = 'search-result-title';
  appendHighlighted(title, hit.title, tokens);
  link.appendChild(title);
  card.appendChild(link);

  const meta = document.createElement('div');
  meta.className = 'search-result-meta';
  const clock = document.createElement('mdui-icon');
  clock.setAttribute('src', '/icon/calender.svg');
  meta.appendChild(clock);
  const date = document.createElement('span');
  date.textContent = hit.date || '';
  meta.appendChild(date);
  if (hit.archived) {
    const badge = document.createElement('span');
    badge.className = 'search-badge';
    badge.textContent = strings.archived || 'Archived';
    meta.appendChild(badge);
  }
  card.appendChild(meta);

  if (hit.snippet) {
    const snippet = document.createElement('div');
    snippet.className = 'search-result-snippet';
    appendHighlighted(snippet, hit.snippet, tokens);
    card.appendChild(snippet);
  }

  const tags = Array.isArray(hit.tags) ? hit.tags : [];
  const categories = Array.isArray(hit.categories) ? hit.categories : [];
  if (tags.length > 0 || categories.length > 0) {
    const chips = document.createElement('div');
    chips.className = 'search-result-chips';
    for (const category of categories) chips.appendChild(buildChip('categories', category));
    for (const tag of tags) chips.appendChild(buildChip('tags', tag));
    card.appendChild(chips);
  }

  return card;
}

function renderEmpty(message, tip) {
  const box = document.createElement('div');
  box.className = 'search-empty';
  box.id = 'search-empty';
  const icon = document.createElement('div');
  icon.className = 'search-empty-icon';
  icon.textContent = '🔍';
  box.appendChild(icon);
  const line = document.createElement('p');
  line.textContent = message;
  box.appendChild(line);
  if (tip) {
    const hint = document.createElement('p');
    hint.className = 'search-empty-tip';
    hint.textContent = tip;
    box.appendChild(hint);
  }
  results.replaceChildren(box);
}

let requestId = 0;
let timer = null;

/** Run a search and repaint. `updateUrl` keeps the address bar in sync. */
async function runSearch(query, updateUrl) {
  const trimmed = query.trim();
  const current = ++requestId;

  if (updateUrl) {
    const url = trimmed ? `/search/?q=${encodeURIComponent(trimmed)}` : '/search/';
    history.replaceState(null, '', url);
  }

  if (!trimmed) {
    status.replaceChildren();
    const idle = document.createElement('span');
    idle.className = 'search-count search-count-idle';
    idle.textContent = strings.empty || '';
    status.appendChild(idle);
    results.replaceChildren();
    return;
  }

  const loading = document.createElement('span');
  loading.className = 'search-count';
  loading.textContent = '…';
  status.replaceChildren(loading);

  let payload;
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=${RESULT_LIMIT}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    payload = await response.json();
  } catch {
    // A stale response must never overwrite a newer one.
    if (current !== requestId) return;
    status.replaceChildren();
    const failed = document.createElement('span');
    failed.className = 'search-count';
    failed.textContent = strings.failed || 'Failed';
    status.appendChild(failed);
    return;
  }
  if (current !== requestId) return;

  const data = payload?.data ?? {};
  const hits = Array.isArray(data.results) ? data.results : [];
  const tokens = Array.isArray(data.tokens) ? data.tokens : [];

  status.replaceChildren();
  const count = document.createElement('span');
  count.className = 'search-count';
  count.textContent = format(strings.resultsFor, { n: data.total ?? hits.length, q: trimmed });
  status.appendChild(count);

  if (hits.length === 0) {
    renderEmpty(strings.noResults || '', '');
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const hit of hits) fragment.appendChild(buildResult(hit, tokens));
  results.replaceChildren(fragment);
}

/* ==========================================================================
 * Wiring
 *
 * The handlers are named module-level functions (rather than inline closures)
 * so destroy() can remove the exact same references again. They read the DOM
 * through the module-level bindings that init() refreshes.
 * ======================================================================== */

/** Debounce keystrokes so a fast typist issues one request, not ten. */
function onInput() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => runSearch(input.value || '', true), DEBOUNCE_MS);
}

/**
 * Intercept submit so the enhanced path does not reload the page. Without
 * JavaScript the same form performs a normal GET navigation.
 */
function onSubmit(event) {
  event.preventDefault();
  if (timer) clearTimeout(timer);
  runSearch(input.value || '', true);
}

/** The mdui clear button empties the field and the result list. */
function onClear() {
  if (timer) clearTimeout(timer);
  runSearch('', true);
}

/** Ctrl/Cmd+K focuses search from anywhere on the page. */
function onKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    input.focus();
  }
}

/**
 * Acquire the current /search/ page and wire it up. Re-entrant: calling it
 * again (a second navigation back to the page) tears the previous instance
 * down first, so listeners can never double up.
 */
export function init() {
  // Defensive: pjax is supposed to call destroy() before init(), but a second
  // live instance would double the debounce and the Ctrl/Cmd+K shortcut.
  if (initialised) destroy();

  page = document.getElementById('search-page');
  // On a navigation to another page this module may still be called
  // defensively; there is nothing to enhance without the search root.
  if (!page) return;

  form = document.getElementById('search-form');
  input = document.getElementById('search-input');
  results = document.getElementById('search-results');
  status = document.getElementById('search-status');

  strings = {};
  try {
    strings = JSON.parse(page.dataset.strings || '{}');
  } catch {
    strings = {};
  }

  initialised = true;

  if (!(form && input && results && status)) return;

  input.addEventListener('input', onInput);
  form.addEventListener('submit', onSubmit);
  input.addEventListener('clear', onClear);
  document.addEventListener('keydown', onKeydown);
}

/**
 * Release everything init() acquired. Safe to call before init() and safe to
 * call twice: every step is individually guarded.
 */
export function destroy() {
  // Stop the pending debounce so it cannot fire against a page that is gone.
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  // Invalidate an in-flight search, so a response that arrives after the swap
  // bails out instead of repainting the next page's result list.
  requestId += 1;

  // The three element listeners would be discarded with the content region on a
  // pjax swap, but they are removed explicitly so init() stays idempotent even
  // if it is ever called twice without a swap in between.
  if (input) {
    input.removeEventListener('input', onInput);
    input.removeEventListener('clear', onClear);
  }
  if (form) form.removeEventListener('submit', onSubmit);
  // This one is bound to `document`, outside the content region, so removing it
  // here is mandatory rather than merely tidy.
  document.removeEventListener('keydown', onKeydown);

  page = null;
  form = null;
  input = null;
  results = null;
  status = null;
  strings = {};
  initialised = false;
}

// Loaded from a full page load: initialise immediately. When the pjax
// controller imports this module to hand it a freshly swapped page it sets
// `window.__pjax.importing` first, and the call to init() below must be skipped
// so the module body does not initialise twice.
if (!(window.__pjax && window.__pjax.importing)) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
