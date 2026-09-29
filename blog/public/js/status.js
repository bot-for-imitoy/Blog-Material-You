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
 */

const STATUS_API = '/api/status';
const CALENDAR_API = '/api/calendar';
/** Shown when the calendar holds no events that are still ahead of us. */
const NO_UPCOMING_EVENTS = '暂无即将到来的事件';

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
  try {
    const response = await fetch(STATUS_API);
    const result = await response.json();
    if (result.errno !== 0) throw new Error(result.errmsg || 'status unavailable');

    const data = result.data || {};
    const counts = data.counts || {};

    setText('status-online', data.online ? '在线' : '离线');
    setText('status-users', counts.visitors ?? '—');
    setText('status-uptime', humaniseUptime(data.uptimeSeconds));
    setText('status-posts', counts.posts ?? '—');
    setText('status-comments', counts.comments ?? '—');
    setText('status-memory', humaniseMemory(data.memory && data.memory.rss));
    setText('status-node', data.nodeVersion || '—');
  } catch (error) {
    // The request itself failing is the strongest possible "offline" signal.
    setText('status-online', '离线');
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
  try {
    const response = await fetch(CALENDAR_API);

    if (response.status === 401) {
      showCalendarAuthRequired();
      return;
    }
    if (response.status === 403) {
      setMessage('status-calendar-body', '无权限');
      return;
    }

    const result = await response.json();
    if (result.errno !== 0) {
      setMessage('status-calendar-body', '日历数据加载失败');
      console.error('Calendar request failed:', result.errmsg);
      return;
    }

    renderEvents(Array.isArray(result.data) ? result.data : []);
    // Reaching this point means the visitor cookie carried the permission.
    showAuthGranted();
  } catch (error) {
    setMessage('status-calendar-body', '日历数据加载失败');
    console.error('Calendar network error:', error);
  }
}

/* ==========================================================================
 * Wiring
 * ======================================================================== */

loadStatus();
loadCalendar();
