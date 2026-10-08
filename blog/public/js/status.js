/**
 * status.js — the /status/ dashboard.
 *
 * Loaded only on `/status/` (see VIEW_SCRIPTS in src/routes/public-pages.ts).
 * Two independent data sources are used:
 *
 *   GET /api/status   → process metrics + content counts (public)
 *   GET /api/calendar → permission-gated events (visitor cookie)
 *
 * Nothing here is server-rendered with data, so every value is written through
 * `textContent`; the calendar link is built with createElement.
 *
 * The module body runs a single time while pjax re-creates the page on every
 * navigation, so the two loads are started from init() (which is called again
 * per page instance) rather than at module scope.
 */

const STATUS_API = '/api/status';
const CALENDAR_API = '/api/calendar';
/** Shown when the calendar holds no events that are still ahead of us. */
const NO_UPCOMING_EVENTS = '暂无即将到来的事件';

/* ==========================================================================
 * Instance state
 * ======================================================================== */

/** Whether the current instance is mounted (used to stay re-entrant). */
let initialised = false;
/**
 * Monotonic instance id. The dashboard is a leaf page, but navigating to it
 * twice in a row still leaves one request pair in flight from the previous
 * instance; those responses must not overwrite the newer numbers.
 */
let instance = 0;

/* ==========================================================================
 * Helpers
 * ======================================================================== */

/** Write a value into an element by id (no-op when the element is missing). */
function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value);
}

/** Replace an element's content with a single paragraph of text. */
function setMessage(id, text) {
  const element = document.getElementById(id);
  if (!element) return;
  const paragraph = document.createElement('p');
  paragraph.className = 'empty-hint';
  paragraph.textContent = text;
  element.replaceChildren(paragraph);
}

/**
 * Humanise a duration: 3d 4h 5m → `3 天 4 小时 5 分`.
 * Zero components are skipped; a sub-minute uptime falls back to seconds.
 */
function humaniseUptime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(`${days} 天`);
  if (hours > 0) parts.push(`${hours} 小时`);
  if (minutes > 0) parts.push(`${minutes} 分`);
  if (parts.length === 0) parts.push(`${total % 60} 秒`);
  return parts.join(' ');
}

/** Humanise a byte count: prefer MB, switch to GB for very large values. */
function humaniseMemory(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '—';
  const megabytes = value / (1024 * 1024);
  if (megabytes >= 1024) return `${(megabytes / 1024).toFixed(2)} GB`;
  return `${megabytes.toFixed(1)} MB`;
}

/** Today as `YYYY-MM-DD`, matching the calendar's date format. */
function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/* ==========================================================================
 * Service status
 * ======================================================================== */

async function loadStatus() {
  // Captured before the await so a response for a replaced instance is dropped.
  const token = instance;
  try {
    const response = await fetch(STATUS_API);
    const result = await response.json();
    if (token !== instance) return;
    if (result.errno !== 0) throw new Error(result.errmsg || 'status unavailable');

    const data = result.data || {};
    const counts = data.counts || {};
    const visits = data.visits || {};

    setText('status-online', data.online ? '在线' : '离线');
    setText('status-visits', `博客 ${visits.blog ?? 0} · 主页 ${visits.profile ?? 0} · 共 ${visits.total ?? 0} 次`);
    setText('status-users', counts.visitors ?? '—');
    setText('status-uptime', humaniseUptime(data.uptimeSeconds));
    setText('status-posts', counts.posts ?? '—');
    setText('status-comments', counts.comments ?? '—');
    setText('status-memory', humaniseMemory(data.memory && data.memory.rss));
    setText('status-node', data.nodeVersion || '—');
  } catch (error) {
    // The request itself failing is the strongest possible "offline" signal.
    if (token === instance) setText('status-online', '离线');
    console.error('Status request failed:', error);
  }
}

/* ==========================================================================
 * Calendar (permission gated)
 * ======================================================================== */

/** One event row: colour dot, date, title and description. */
function createEventRow(event) {
  const row = document.createElement('div');
  row.className = 'status-event';

  const dot = document.createElement('span');
  dot.className = 'status-event-dot';
  // Assigning through the CSSOM only accepts a colour, so a malformed value is
  // ignored by the browser and cannot inject further declarations.
  if (event.color) dot.style.backgroundColor = event.color;

  const main = document.createElement('div');
  main.className = 'status-event-main';

  const title = document.createElement('div');
  title.className = 'status-event-title';
  title.textContent = event.title || '(未命名)';

  const date = document.createElement('div');
  date.className = 'status-event-date';
  date.textContent = event.date || '';

  main.append(title, date);

  if (event.description) {
    const description = document.createElement('div');
    description.className = 'status-event-desc';
    description.textContent = event.description;
    main.append(description);
  }

  row.append(dot, main);
  return row;
}

/** Render the upcoming events (or an empty state) into the calendar card. */
function renderEvents(events) {
  const container = document.getElementById('status-calendar-body');
  if (!container) return;

  const limit = today();
  const upcoming = events
    .filter((event) => String(event.date || '') >= limit)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  if (upcoming.length === 0) {
    setMessage('status-calendar-body', NO_UPCOMING_EVENTS);
    return;
  }

  const list = document.createElement('div');
  list.className = 'status-event-list';
  upcoming.forEach((event) => list.append(createEventRow(event)));
  container.replaceChildren(list);
}

/** The authenticated state of the calendar card. */
function showAuthGranted() {
  const card = document.getElementById('status-auth-card');
  const body = card && card.querySelector('.status-card-body');
  if (!body) return;

  const line = body.querySelector('.mdui-list-item-text');
  if (line) line.textContent = '✅ 已验证，日历数据已解锁';

  // The "go to /auth/" button only makes sense while unauthenticated.
  const button = body.querySelector('mdui-button');
  if (button) button.remove();
}

/** Link the reader to the verification page when the cookie is missing. */
function showCalendarAuthRequired() {
  const container = document.getElementById('status-calendar-body');
  if (!container) return;

  const paragraph = document.createElement('p');
  paragraph.className = 'empty-hint';
  const link = document.createElement('a');
  link.href = '/auth/';
  link.textContent = '请先完成邮箱验证 → 去验证';
  paragraph.append(link);
  container.replaceChildren(paragraph);
}

async function loadCalendar() {
  const token = instance;
  try {
    const response = await fetch(CALENDAR_API);
    if (token !== instance) return;

    if (response.status === 401) {
      showCalendarAuthRequired();
      return;
    }
    if (response.status === 403) {
      setMessage('status-calendar-body', '无权限');
      return;
    }

    const result = await response.json();
    if (token !== instance) return;
    if (result.errno !== 0) {
      setMessage('status-calendar-body', '日历数据加载失败');
      console.error('Calendar request failed:', result.errmsg);
      return;
    }

    renderEvents(Array.isArray(result.data) ? result.data : []);
    // Reaching this point means the visitor cookie carried the permission.
    showAuthGranted();
  } catch (error) {
    if (token === instance) setMessage('status-calendar-body', '日历数据加载失败');
    console.error('Calendar network error:', error);
  }
}

/* ==========================================================================
 * Wiring
 * ======================================================================== */

/**
 * Start the dashboard loads for the current page. Re-entrant: a second call
 * first releases the previous instance, so a navigation back to /status/ never
 * leaves two instances racing for the same elements.
 */
export function init() {
  if (initialised) destroy();
  instance += 1;

  // The dashboard is recognised by its page-scoped wrapper. On any other page
  // pjax may still call this defensively; there is nothing to load there.
  if (!document.querySelector('.status-content')) return;

  initialised = true;

  loadStatus();
  loadCalendar();
}

/**
 * Release everything init() acquired. Safe before init() and safe twice.
 *
 * status.js binds no listeners, timers, animation frames or observers, and
 * every DOM write looks its element up by id when the response arrives, so the
 * only thing left to release is the request pair started by init(): bumping the
 * instance id turns any later response into a no-op.
 */
export function destroy() {
  instance += 1;
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
