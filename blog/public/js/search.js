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
 */
const DEBOUNCE_MS = 220;
const RESULT_LIMIT = 20;

const page = document.getElementById('search-page');
const form = document.getElementById('search-form');
const input = document.getElementById('search-input');
const results = document.getElementById('search-results');
const status = document.getElementById('search-status');

let strings = {};
try {
  strings = JSON.parse(page?.dataset.strings || '{}');
} catch {
  strings = {};
}

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

if (page && form && input && results && status) {
  // Debounce keystrokes so a fast typist issues one request, not ten.
  input.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => runSearch(input.value || '', true), DEBOUNCE_MS);
  });

  // Intercept submit so the enhanced path does not reload the page. Without
  // JavaScript the same form performs a normal GET navigation.
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (timer) clearTimeout(timer);
    runSearch(input.value || '', true);
  });

  input.addEventListener('clear', () => {
    if (timer) clearTimeout(timer);
    runSearch('', true);
  });

  // Ctrl/Cmd+K focuses search from anywhere on the page.
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      input.focus();
    }
  });
}
