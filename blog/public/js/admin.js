/**
 * admin.js — every behaviour of the admin console.
 *
 * The admin templates are plain server-rendered HTML with no component library:
 * there is no inline script and no inline event-handler attribute anywhere (the
 * CSP only allows `script-src 'self'`). All interactivity therefore lives here:
 *
 *   - one delegated `click` listener that reads `data-action` and dispatches to
 *     the ACTIONS table;
 *   - one delegated `submit` listener, so pressing Enter inside any form runs
 *     the same handler as its submit button (our forms never navigate);
 *   - a handful of small `init*` functions for the widgets that are not click
 *     driven (colour picker, provider groups, QR image, file-name label).
 *
 * Conventions (src/routes/admin-api.ts):
 *   success → { errno: 0, data } ; failure → { errno: -1, errmsg }
 * A failure can be a "soft error" with HTTP 200, so the `errno` field — never
 * the status alone — decides success. HTTP 401 means the session is gone and
 * the browser is sent back to the login form.
 *
 * All values are written to the DOM with textContent/createElement; server and
 * user data is never interpolated into markup.
 */

const API_BASE = '/api/admin';
const LOGIN_PATH = '/admin/login/';
const DASHBOARD_PATH = '/admin/dashboard/';
const POSTS_PATH = '/admin/posts/';
const PAGES_PATH = '/admin/pages/';
const FRIENDS_PATH = '/admin/friends/';
const TALKS_PATH = '/admin/talks/';

/* ==========================================================================
 * Small DOM helpers
 * ======================================================================== */

/** getElementById shorthand. */
function byId(id) {
  return document.getElementById(id);
}

/** Trimmed `value` of a field, or '' when the field is missing. */
function fieldValue(id) {
  const field = byId(id);
  return field && typeof field.value === 'string' ? field.value.trim() : '';
}

/** `checked` state of a checkbox, or false when missing. */
function fieldChecked(id) {
  const field = byId(id);
  return Boolean(field && field.checked);
}

/** Comma-separated field → trimmed, non-empty array. */
function listFieldValue(id) {
  return fieldValue(id)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/** Un-hide an inline error area and fill it with a message. */
function showFormError(id, message) {
  const box = byId(id);
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
}

/** Hide an inline error area. */
function clearFormError(id) {
  const box = byId(id);
  if (!box) return;
  box.textContent = '';
  box.hidden = true;
}

/**
 * Page-level feedback: writes into `#admin-flash` and fades out again.
 * The stylesheet hides an empty flash, so clearing the text also clears space.
 * @param {string} message
 * @param {'success'|'error'|'info'} [kind]
 */
let flashTimer = 0;
function toast(message, kind = 'success') {
  const flash = byId('admin-flash');
  if (!flash) return;
  window.clearTimeout(flashTimer);
  flash.textContent = message;
  flash.classList.toggle('is-error', kind === 'error');
  flash.classList.remove('is-fading');
  // Two timers: one to start the fade, one to empty the box afterwards.
  flashTimer = window.setTimeout(() => {
    flash.classList.add('is-fading');
    flashTimer = window.setTimeout(() => {
      flash.textContent = '';
      flash.classList.remove('is-fading', 'is-error');
    }, 450);
  }, 4000);
}

/**
 * Show a result block (`#result-box`, `#upload-result`): one line per entry.
 * `lines` is an array of `[label, value]` pairs or plain strings.
 */
function showResult(id, lines, isError = false) {
  const box = byId(id);
  if (!box) return;
  box.classList.toggle('result-error', Boolean(isError));
  const fragment = document.createDocumentFragment();

  lines.forEach((line) => {
    const row = document.createElement('div');
    row.className = 'result-line';
    if (Array.isArray(line)) {
      const label = document.createElement('span');
      label.className = 'result-label';
      label.textContent = `${line[0]}：`;
      const value = document.createElement('span');
      value.className = 'result-value';
      value.textContent = String(line[1]);
      row.append(label, value);
    } else {
      row.textContent = String(line);
    }
    fragment.append(row);
  });

  box.replaceChildren(fragment);
  box.hidden = false;
}

/** Navigate, using the element's own href when the template provides one. */
function navigate(element, fallbackPath) {
  const href = element && element.getAttribute ? element.getAttribute('href') : '';
  window.location.assign(href || fallbackPath);
}

/** Read a file as a data URL (image upload) or as text (backup import). */
function readFile(file, asText) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`无法读取文件：${file.name}`));
    if (asText) reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

/* ==========================================================================
 * API access
 * ======================================================================== */

/** Error type carrying the server message so callers only handle one shape. */
class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Call the admin JSON API.
 *
 * @param {string} method  HTTP verb.
 * @param {string} path    Path below /api/admin.
 * @param {object|string} [payload] JSON body; a string is sent verbatim when
 *                                  `options.raw` is set (backup import).
 * @returns {Promise<unknown>} the `data` field of a successful response.
 */
async function api(method, path, payload, options = {}) {
  const init = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  };

  if (payload !== undefined && payload !== null) {
    init.headers['Content-Type'] = 'application/json';
    init.body = options.raw ? String(payload) : JSON.stringify(payload);
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError('网络错误，请检查连接后重试', 0);
  }

  if (response.status === 401) {
    toast('登录已过期，请重新登录', 'error');
    // The API is cookie-guarded: a 401 means every further call would fail too.
    window.location.assign(LOGIN_PATH);
    throw new ApiError('未登录或会话已过期', 401);
  }

  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }

  if (!result || typeof result !== 'object') {
    throw new ApiError(`请求失败（HTTP ${response.status}）`, response.status);
  }
  if (result.errno !== 0) {
    throw new ApiError(result.errmsg || '操作失败', response.status);
  }
  return result.data;
}

/** Wrap a handler so any failure becomes visible feedback instead of a crash. */
function action(handler) {
  return async function run(element) {
    try {
      await handler(element);
    } catch (error) {
      // 401 already navigated away; skip the redundant noise.
      if (error instanceof ApiError && error.status === 401) return;
      toast(error instanceof Error ? error.message : '操作失败', 'error');
    }
  };
}

/* ==========================================================================
 * Confirmation dialog (native <dialog>)
 * ======================================================================== */

/** Resolver of the confirmation promise currently waiting. */
let pendingConfirm = null;

/**
 * Ask the visitor to confirm a destructive action.
 * Uses the shared `#admin-confirm` dialog via `showModal()`; if the element is
 * missing or unsupported it falls back to the native confirm().
 * @returns {Promise<boolean>}
 */
function confirmAction(message) {
  const dialog = byId('admin-confirm');
  const text = byId('admin-confirm-text');

  if (!dialog || !text || typeof dialog.showModal !== 'function') {
    return Promise.resolve(window.confirm(message));
  }

  // A previous confirmation that was never answered must not leak into this one.
  if (pendingConfirm) {
    const previous = pendingConfirm;
    pendingConfirm = null;
    previous(false);
  }

  text.textContent = message;
  if (!dialog.open) dialog.showModal();
  return new Promise((resolve) => {
    pendingConfirm = resolve;
  });
}

/** Answer the open confirmation dialog. */
function resolveConfirm(value) {
  const dialog = byId('admin-confirm');
  const resolve = pendingConfirm;
  pendingConfirm = null;
  if (dialog && dialog.open && typeof dialog.close === 'function') dialog.close();
  if (resolve) resolve(value);
}

/* ==========================================================================
 * Theme accent + settings page
 * ======================================================================== */

/** Mirror a colour onto the `--admin-accent` token (and the preview swatch). */
function applyAccent(value) {
  const colour = String(value || '').trim();
  if (colour === '') return;
  document.documentElement.style.setProperty('--admin-accent', colour);
  const preview = byId('theme-preview');
  if (preview) preview.style.backgroundColor = colour;
}

/**
 * Apply the site's configured `theme.color` to the whole console.
 * The layout carries it in `data-accent`, so no extra request is needed.
 */
function initAccent() {
  const configured = document.body ? document.body.dataset.accent : '';
  if (configured) document.documentElement.style.setProperty('--admin-accent', configured);
}

/**
 * Keep the colour picker and the free-text colour field in sync.
 * @param {'picker'|'text'|'init'} source which control the user touched last
 */
function syncThemeColor(source) {
  const picker = byId('set-theme-color');
  const text = byId('set-theme-color-text');
  if (!picker || !text) return;

  if (source === 'picker') {
    text.value = picker.value;
  } else if (source === 'text') {
    // <input type="color"> only understands #rrggbb; other CSS colours (or a
    // named colour) legitimately leave the picker on its previous value.
    const candidate = text.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(candidate)) picker.value = candidate;
  }
  applyAccent(text.value.trim() || picker.value);
}

/** Write the settings status line (used for both success and failure). */
function setSettingsStatus(message, isError) {
  const status = byId('settings-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', Boolean(isError));
}

/** Collect the settings form and persist it into _config.yml. */
const handleSaveSettings = action(async () => {
  const payload = {
    title: fieldValue('set-title'),
    subtitle: fieldValue('set-subtitle'),
    description: fieldValue('set-description'),
    // The API accepts an array (or a comma-separated string) for list fields.
    keywords: listFieldValue('set-keywords'),
    author: fieldValue('set-author'),
    language: fieldValue('set-language'),
    url: fieldValue('set-url'),
    avatar: fieldValue('set-avatar'),
    copyright: fieldValue('set-copyright'),
    github: fieldValue('set-github'),
    // The free-text field wins: it can hold any CSS colour, not just hex.
    themeColor: fieldValue('set-theme-color-text') || fieldValue('set-theme-color'),
  };

  try {
    const data = await api('PUT', '/settings', payload);
    const message = data && data.message ? String(data.message) : '配置已保存';
    setSettingsStatus(message, false);
    applyAccent(payload.themeColor);
    toast(message);
  } catch (error) {
    // Report in place as well: the precise validation message is the useful part.
    setSettingsStatus(error instanceof Error ? error.message : '保存失败', true);
    throw error;
  }
});

/** Settings page wiring: mirror the two colour controls both ways. */
function initSettings() {
  const picker = byId('set-theme-color');
  const text = byId('set-theme-color-text');
  if (!picker || !text) return;

  // Start from the text field: it holds the authoritative CSS colour.
  syncThemeColor('init');
  picker.addEventListener('input', () => syncThemeColor('picker'));
  text.addEventListener('input', () => syncThemeColor('text'));
}

/* ==========================================================================
 * Login / setup
 * ======================================================================== */

/** Temp token of a password step that is waiting for its TOTP code. */
let tempToken = '';

/** Read the two login fields and run the password step. */
const handleLogin = action(async () => {
  clearFormError('login-error');
  const username = fieldValue('lf-user');
  const password = fieldValue('lf-pass');

  if (!username || !password) {
    showFormError('login-error', '请输入用户名和密码');
    return;
  }

  const data = await api('POST', '/login', { username, password });

  if (data && data.step === 2) {
    // Two-factor enabled: the password only earned a one-time handshake token.
    tempToken = String(data.tempToken || '');
    const step1 = byId('login-step1');
    const step2 = byId('login-step2');
    if (step1) step1.hidden = true;
    if (step2) step2.hidden = false;
    const code = byId('lf-totp');
    if (code && typeof code.focus === 'function') code.focus();
    return;
  }

  // The server set the session cookie in this response.
  window.location.assign(DASHBOARD_PATH);
});

/** Second login step: the authenticator code. */
const handleLoginTotp = action(async () => {
  clearFormError('login-error');
  const totp = fieldValue('lf-totp');

  if (!totp) {
    showFormError('login-error', '请输入验证码');
    return;
  }
  if (!tempToken) {
    showFormError('login-error', '会话已过期，请重新输入密码');
    return;
  }

  await api('POST', '/login', { step: 2, tempToken, totp });
  window.location.assign(DASHBOARD_PATH);
});

/** First-run wizard: create the admin account. */
const handleSetupInit = action(async () => {
  clearFormError('setup-error');
  const warning = byId('setup-warning');
  if (warning) warning.hidden = true;

  const user = fieldValue('su-user');
  const password = fieldValue('su-pass');
  const confirmation = fieldValue('su-pass2');

  if (!user || !password) {
    showFormError('setup-error', '请填写用户名和密码');
    return;
  }
  if (password.length < 6) {
    showFormError('setup-error', '密码长度不少于6位');
    return;
  }
  if (password !== confirmation) {
    showFormError('setup-error', '两次输入的密码不一致');
    return;
  }

  await api('POST', '/setup', { action: 'init', user, password });
  toast('初始化完成，请登录');
  window.location.assign(LOGIN_PATH);
});

/* ==========================================================================
 * Posts
 * ======================================================================== */

/** Whether the slug field is editable, i.e. this is a brand new post. */
function isNewPost() {
  const slug = byId('ed-slug');
  // The server renders `readonly` on existing posts, which is the only marker
  // that distinguishes "create" from "update" in the editor.
  return Boolean(slug) && !slug.hasAttribute('readonly');
}

/** Collect every editor field into the API payload. */
function postPayload() {
  return {
    slug: fieldValue('ed-slug'),
    title: fieldValue('ed-title'),
    titleEn: fieldValue('ed-title-en'),
    content: fieldValue('ed-content'),
    contentEn: fieldValue('ed-content-en'),
    date: fieldValue('ed-date'),
    cover: fieldValue('ed-cover'),
    tags: listFieldValue('ed-tags'),
    categories: listFieldValue('ed-cats'),
    archived: fieldChecked('ed-archived'),
  };
}

/** Create or update the post currently open in the editor. */
const handleSavePost = action(async () => {
  clearFormError('editor-error');
  const payload = postPayload();

  if (!payload.slug) {
    showFormError('editor-error', '请填写标识（Slug）');
    return;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(payload.slug)) {
    showFormError('editor-error', '标识只能包含字母、数字、点、下划线或短横线');
    return;
  }
  if (!payload.title) {
    showFormError('editor-error', '请填写标题');
    return;
  }

  const creating = isNewPost();
  try {
    await api(creating ? 'POST' : 'PUT', '/posts', payload);
  } catch (error) {
    // A new-post form can collide with an existing file; that is an update.
    const conflict = creating && /already exists/i.test(error.message);
    if (!conflict) throw error;
    await api('PUT', '/posts', payload);
  }

  toast('保存成功');
  if (creating) {
    // Reload as an edit view so the slug becomes read-only and the next save
    // takes the update path.
    window.location.assign(`${POSTS_PATH}${encodeURIComponent(payload.slug)}/edit/`);
  }
});

/** Toggle a post's archived flag from the list. */
const handleToggleArchive = action(async (element) => {
  const slug = element.dataset.slug || '';
  if (!slug) return;
  await api('PATCH', '/posts', { slug });
  toast('状态已更新');
  window.location.reload();
});

/** Delete a post (confirmed). */
const handleDeletePost = action(async (element) => {
  const slug = element.dataset.slug || '';
  const title = element.dataset.title || slug;
  if (!slug) return;

  const confirmed = await confirmAction(`确定要删除文章「${title}」吗？此操作不可撤销。`);
  if (!confirmed) return;

  await api('DELETE', `/posts?slug=${encodeURIComponent(slug)}`);
  toast('文章已删除');
  window.location.reload();
});

/* ==========================================================================
 * Markdown toolbar
 * ======================================================================== */

/**
 * Insert `data-wrap` around the selection, or `data-snippet` at the caret.
 * `#ed-content` is a real <textarea>, so the caret is read directly.
 */
function insertMarkdown(element) {
  const field = byId('ed-content');
  if (!field) return;

  const wrap = element.dataset.wrap || '';
  const snippet = element.dataset.snippet || '';
  const current = typeof field.value === 'string' ? field.value : '';

  const start = typeof field.selectionStart === 'number' ? field.selectionStart : current.length;
  const end = typeof field.selectionEnd === 'number' ? field.selectionEnd : current.length;
  const selected = current.slice(start, end);

  let inserted;
  let selectFrom;
  let selectTo;

  if (wrap) {
    // Bold/italic: keep the selected text (or insert the placeholder) between
    // the markers and leave it selected so typing replaces it.
    const inner = selected === '' ? wrap : selected;
    inserted = `${wrap}${inner}${wrap}`;
    selectFrom = start + wrap.length;
    selectTo = selectFrom + inner.length;
  } else {
    inserted = snippet;
    selectFrom = start + inserted.length;
    selectTo = selectFrom;
  }

  field.value = current.slice(0, start) + inserted + current.slice(end);
  if (typeof field.focus === 'function') field.focus();
  if (typeof field.setSelectionRange === 'function') {
    field.setSelectionRange(selectFrom, selectTo, 'forward');
  }
}

/* ==========================================================================
 * Pages
 * ======================================================================== */

const handleSavePage = action(async () => {
  clearFormError('page-error');
  const slugField = byId('ed-slug');
  const payload = {
    slug: fieldValue('ed-slug'),
    title: fieldValue('ed-title'),
    titleEn: fieldValue('ed-title-en'),
    content: fieldValue('ed-content'),
    contentEn: fieldValue('ed-content-en'),
  };

  if (!payload.slug) {
    showFormError('page-error', '请填写标识（Slug）');
    return;
  }
  if (!payload.title) {
    showFormError('page-error', '请填写标题');
    return;
  }

  // PUT is an upsert for pages: one route covers create and update.
  await api('PUT', '/pages', payload);
  toast('页面已保存');

  if (slugField && !slugField.hasAttribute('readonly')) {
    window.location.assign(`${PAGES_PATH}${encodeURIComponent(payload.slug)}/edit/`);
  }
});

const handleDeletePage = action(async (element) => {
  const slug = element.dataset.slug || fieldValue('ed-slug');
  const title = element.dataset.title || slug;
  if (!slug) return;

  const confirmed = await confirmAction(`确定要删除页面「${title}」吗？`);
  if (!confirmed) return;

  await api('DELETE', `/pages?slug=${encodeURIComponent(slug)}`);
  toast('页面已删除');
  window.location.assign(PAGES_PATH);
});

/* ==========================================================================
 * Talks
 * ======================================================================== */

const handleSaveTalk = action(async () => {
  clearFormError('talk-error');
  const content = fieldValue('talk-content');
  if (!content) {
    showFormError('talk-error', '内容不能为空');
    return;
  }

  await api('POST', '/talks', { content });
  toast('动态已发布');
  window.location.assign(TALKS_PATH);
});

const handleDeleteTalk = action(async (element) => {
  const id = element.dataset.id || '';
  if (!id) return;

  const confirmed = await confirmAction('确定要删除这条动态吗？');
  if (!confirmed) return;

  await api('DELETE', `/talks?id=${encodeURIComponent(id)}`);
  toast('动态已删除');
  window.location.reload();
});

/* ==========================================================================
 * Friends
 * ======================================================================== */

const handleSaveFriend = action(async () => {
  clearFormError('friend-error');
  const id = Number.parseInt(fieldValue('f-id'), 10);
  const payload = {
    title: fieldValue('f-title'),
    url: fieldValue('f-url'),
    titleEn: fieldValue('f-title-en'),
    descr: fieldValue('f-descr'),
    descrEn: fieldValue('f-descr-en'),
    avatar: fieldValue('f-avatar'),
    sortOrder: Number.parseInt(fieldValue('f-sort'), 10) || 0,
  };

  if (!payload.title || !payload.url) {
    showFormError('friend-error', '标题和链接为必填项');
    return;
  }

  const editing = Number.isFinite(id) && id > 0;
  if (editing) await api('PUT', '/friends', { id, ...payload });
  else await api('POST', '/friends', payload);

  toast('友链已保存');
  window.location.assign(FRIENDS_PATH);
});

const handleDeleteFriend = action(async (element) => {
  const id = element.dataset.id || '';
  const title = element.dataset.title || id;
  if (!id) return;

  const confirmed = await confirmAction(`确定要删除友链「${title}」吗？`);
  if (!confirmed) return;

  await api('DELETE', `/friends?id=${encodeURIComponent(id)}`);
  toast('友链已删除');
  window.location.reload();
});

/* ==========================================================================
 * Comments
 * ======================================================================== */

const handleDeleteComment = action(async (element) => {
  const id = element.dataset.id || '';
  if (!id) return;

  const confirmed = await confirmAction('确定要删除这条评论吗？');
  if (!confirmed) return;

  await api('DELETE', `/comments?id=${encodeURIComponent(id)}`);
  toast('评论已删除');
  window.location.reload();
});

/* ==========================================================================
 * Visitors
 * ======================================================================== */

/** Values of the ticked checkboxes found inside `container`. */
function checkedPermissions(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll('input[type="checkbox"]'))
    .filter((box) => box.checked)
    .map((box) => String(box.value || ''))
    .filter((value) => value !== '');
}

/** Create or update an approved visitor. */
const handleSaveVisitor = action(async () => {
  const email = fieldValue('visitor-email');
  if (!email) {
    showErrorAndToast('请填写邮箱');
    return;
  }

  await api('POST', '/visitors', {
    email,
    name: fieldValue('visitor-name'),
    permissions: checkedPermissions(byId('visitor-perms')),
  });
  toast('访客已保存');
  window.location.reload();
});

/** Report a validation failure both in the flash and as a toast. */
function showErrorAndToast(message) {
  showFormError('visitor-error', message);
  toast(message, 'error');
}

const handleDeleteVisitor = action(async (element) => {
  const email = element.dataset.email || '';
  if (!email) return;

  const confirmed = await confirmAction(`确定要删除访客「${email}」吗？`);
  if (!confirmed) return;

  await api('DELETE', `/visitors?email=${encodeURIComponent(email)}`);
  toast('访客已删除');
  window.location.reload();
});

/** Approve a pending registration with the permissions ticked on its row. */
const handleApproveVisitor = action(async (element) => {
  const email = element.dataset.email || '';
  if (!email) return;

  // Scope the checkbox lookup to this row, so no selector has to embed the
  // address (and the permissions always belong to the right applicant).
  const row = element.closest('tr') || element.closest('.post-item');
  const permissions = checkedPermissions(row);

  await api('POST', '/visitors/approve', { email, permissions });
  toast('已通过申请');
  window.location.reload();
});

const handleRejectVisitor = action(async (element) => {
  const email = element.dataset.email || '';
  if (!email) return;

  const confirmed = await confirmAction(`确定要拒绝「${email}」的注册申请吗？`);
  if (!confirmed) return;

  await api('DELETE', `/visitors/pending?email=${encodeURIComponent(email)}`);
  toast('已拒绝申请');
  window.location.reload();
});

/* ==========================================================================
 * Two-factor authentication
 * ======================================================================== */

/** The (hidden until needed) TOTP enrollment panel. */
function totpSetupCard() {
  return byId('totp-setup-card');
}

/** Hide the enrollment panel and wipe the pending secret from the DOM. */
function hideTotpSetup() {
  const card = totpSetupCard();
  if (card) card.hidden = true;

  const secretBox = byId('totp-secret');
  if (secretBox) secretBox.textContent = '';
  const uriBox = byId('totp-uri');
  if (uriBox) uriBox.textContent = '';

  const qr = byId('totp-qr');
  if (qr) {
    qr.removeAttribute('src');
    qr.hidden = true;
  }

  const code = byId('totp-verify-code');
  if (code) code.value = '';

  // Restore the "启用" button that starting the enrollment hid.
  const startButton = document.querySelector('[data-action="totp-start"]');
  if (startButton) startButton.hidden = false;
}

/**
 * Fill the enrollment panel with a freshly generated pending secret and reveal
 * it. No QR encoder is bundled (the project ships no third-party libraries), so
 * the image is only shown when the value really is an image data URI; the
 * otpauth:// URI is always printed as selectable text for manual entry.
 */
function fillTotpSetup(secret, provisioningUri) {
  const card = totpSetupCard();
  if (!card) return;

  const secretBox = byId('totp-secret');
  if (secretBox) secretBox.textContent = secret || '';

  const uriBox = byId('totp-uri');
  if (uriBox) uriBox.textContent = provisioningUri || '';

  showQrImage(byId('totp-qr'), provisioningUri);
  card.hidden = false;
}

/** Point the QR <img> at `source` when it is an image, else hide it. */
function showQrImage(img, source) {
  if (!img) return;
  const value = String(source || '');
  if (value.startsWith('data:image')) {
    img.src = value;
    img.hidden = false;
  } else {
    // Not an image (the usual case) — hide instead of showing a broken image.
    img.removeAttribute('src');
    img.hidden = true;
  }
}

/** Start TOTP enrollment and reveal the setup panel. */
const handleTotpStart = action(async () => {
  const data = await api('POST', '/totp', { action: 'start' });
  fillTotpSetup(data && data.secret, data && data.provisioningUri);

  // The "启用" button would be confusing next to the setup panel.
  const startButton = document.querySelector('[data-action="totp-start"]');
  if (startButton) startButton.hidden = true;

  toast('密钥已生成，请使用身份验证器扫码或手动输入');
});

/** Confirm the enrollment code. */
const handleTotpVerify = action(async () => {
  clearFormError('security-error');
  const code = fieldValue('totp-verify-code');
  if (!code) {
    showFormError('security-error', '请输入 6 位验证码');
    return;
  }

  await api('POST', '/totp', { action: 'verify', code });
  toast('两步验证已启用');
  // Reload so the server renders the "enabled" state (and stops sending the
  // pending secret to the browser).
  window.location.reload();
});

/** Abort enrollment: the pending secret stays on the server, unused. */
const handleTotpCancel = action(async () => {
  hideTotpSetup();
  toast('已取消设置', 'info');
});

/** Generate a new secret for an account that already has 2FA enabled. */
const handleTotpRegenerate = action(async () => {
  const confirmed = await confirmAction(
    '重新生成密钥后，需要用新的密钥重新绑定身份验证器。当前密钥会立即失效，确定继续吗？',
  );
  if (!confirmed) return;

  const data = await api('POST', '/totp', { action: 'start' });
  fillTotpSetup(data && data.secret, data && data.provisioningUri);
  toast('已生成新密钥，请重新绑定');
});

const handleTotpDisable = action(async () => {
  const confirmed = await confirmAction('确定要关闭两步验证吗？账户将只受密码保护。');
  if (!confirmed) return;

  await api('POST', '/totp', { action: 'disable' });
  toast('两步验证已关闭');
  window.location.reload();
});

/* ==========================================================================
 * Password change
 * ======================================================================== */

const handleChangePassword = action(async () => {
  clearFormError('cp-error');
  const oldPassword = fieldValue('cp-old');
  const newPassword = fieldValue('cp-new');
  const confirmation = fieldValue('cp-new2');
  const newUser = fieldValue('cp-user');

  if (!oldPassword) {
    showFormError('cp-error', '请输入当前密码');
    return;
  }
  if (newPassword.length < 6) {
    showFormError('cp-error', '新密码长度不少于6位');
    return;
  }
  if (newPassword !== confirmation) {
    showFormError('cp-error', '两次输入的新密码不一致');
    return;
  }

  const payload = { action: 'change', oldPassword, newPassword };
  // An empty username keeps the stored one; the server trims and validates it.
  if (newUser !== '') payload.newUser = newUser;

  await api('POST', '/setup', payload);
  toast('密码已修改，请重新登录');
  // Every session was revoked by the change, so the next page is the login form.
  window.location.assign(LOGIN_PATH);
});

/* ==========================================================================
 * Image host
 * ======================================================================== */

/** Show only the field group that belongs to the selected provider. */
function syncProviderGroups() {
  const provider = fieldValue('provider') === 's3' ? 's3' : 'sftp';
  document.querySelectorAll('[data-provider]').forEach((group) => {
    group.hidden = group.dataset.provider !== provider;
  });
}

/** Collect the imghost form into the API payload. */
function imghostPayload() {
  const provider = fieldValue('provider') === 's3' ? 's3' : 'sftp';
  return {
    enabled: fieldChecked('enabled'),
    provider,
    filename_template: fieldValue('filename_template'),
    // Both groups carry a `public_url_base`; the active provider wins, with the
    // other group as a fallback so switching providers never loses the value.
    public_url_base:
      provider === 's3'
        ? fieldValue('s3_public_url_base') || fieldValue('sftp_public_url_base')
        : fieldValue('sftp_public_url_base') || fieldValue('s3_public_url_base'),
    host: fieldValue('sftp_host'),
    port: fieldValue('sftp_port'),
    username: fieldValue('sftp_username'),
    ssh_key_path: fieldValue('sftp_ssh_key_path'),
    remote_dir: fieldValue('sftp_remote_dir'),
    endpoint: fieldValue('s3_endpoint'),
    bucket: fieldValue('s3_bucket'),
    access_key: fieldValue('s3_access_key'),
    secret_key: fieldValue('s3_secret_key'),
    region: fieldValue('s3_region'),
    prefix: fieldValue('s3_prefix'),
    insecure: fieldChecked('s3_insecure'),
    ssl_ca: fieldValue('s3_ssl_ca'),
    ssl_cert: fieldValue('s3_ssl_cert'),
    ssl_key: fieldValue('s3_ssl_key'),
  };
}

/** Update the enabled/disabled badge in the page header. */
function updateImghostBadge(enabled) {
  const badge = byId('status-badge');
  if (!badge) return;
  badge.textContent = enabled ? '已启用' : '未启用';
  badge.classList.toggle('status-enabled', Boolean(enabled));
  badge.classList.toggle('status-disabled', !enabled);
}

const handleSaveImghost = action(async () => {
  clearFormError('imghost-error');
  const payload = imghostPayload();

  const data = await api('PUT', '/imghost', payload);
  updateImghostBadge(Boolean(payload.enabled));

  // Re-sync the masked secret the server echoed back, if any.
  if (data && data.config) {
    const secret = byId('s3_secret_key');
    if (secret && typeof data.config.secret_key === 'string') secret.value = data.config.secret_key;
  }

  showResult('result-box', [data && data.message ? data.message : '配置已保存']);
  toast('配置已保存');
});

const handleTestImghost = action(async (element) => {
  element.disabled = true;
  try {
    const data = await api('POST', '/imghost', { action: 'test' });
    showResult('result-box', [data && data.message ? data.message : '连接成功']);
    toast('连接成功');
  } catch (error) {
    // Report in place as well: the provider message is the useful part.
    const message = error instanceof Error ? error.message : '连接失败';
    showResult('result-box', [message], true);
    toast(message, 'error');
  } finally {
    element.disabled = false;
  }
});

const handleUploadImghost = action(async (element) => {
  const input = byId('upload-file');
  const file = input && input.files ? input.files[0] : null;
  if (!file) {
    showResult('upload-result', ['请先选择要上传的图片'], true);
    return;
  }

  element.disabled = true;
  try {
    const image = await readFile(file, false);
    const data = await api('POST', '/imghost', {
      action: 'upload',
      image,
      filename: fieldValue('upload-name') || file.name,
    });

    const box = byId('upload-result');
    const url = data && data.url ? String(data.url) : '';
    if (box && url) {
      // A clickable URL, built as DOM so the value is never treated as markup.
      const line = document.createElement('div');
      line.className = 'result-line';
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = url;
      line.append(link);
      box.replaceChildren(line);
      box.classList.remove('result-error');
      box.hidden = false;
    } else {
      showResult('upload-result', ['上传成功']);
    }
    toast('上传成功');
  } finally {
    element.disabled = false;
  }
});

/** Keep the provider groups in sync with the select. */
function initImghost() {
  const provider = byId('provider');
  if (!provider) return;
  syncProviderGroups();
  provider.addEventListener('change', syncProviderGroups);
}

/* ==========================================================================
 * Backup
 * ======================================================================== */

/** Render the per-section summary returned by the import endpoint. */
function renderImportSummary(summary) {
  if (!summary || typeof summary !== 'object') {
    showResult('result-box', ['导入完成']);
    return;
  }
  const labels = {
    posts: '文章',
    pages: '页面',
    talks: '动态',
    friends: '友链',
    comments: '评论',
    visitors: '访客',
    pending: '待审核',
    images: '图片',
    settings: '设置',
    calendar: '日历',
    imghost: '图床配置',
  };
  const lines = Object.entries(summary).map(([key, value]) => [labels[key] || key, value]);
  showResult('result-box', lines.length > 0 ? lines : ['导入完成']);
}

const handleImportBackup = action(async (element) => {
  clearFormError('backup-error');
  const input = byId('import-file');
  const file = input && input.files ? input.files[0] : null;

  if (!file) {
    showFormError('backup-error', '请先选择备份文件');
    return;
  }

  const confirmed = await confirmAction('导入会先清空当前全部数据再写入备份内容，操作不可撤销。确定继续吗？');
  if (!confirmed) return;

  const text = await readFile(file, true);
  element.disabled = true;
  try {
    // The file content is already JSON; send it verbatim as the request body.
    const data = await api('POST', '/import', text, { raw: true });
    renderImportSummary(data && data.summary);
    toast('数据导入完成');
  } finally {
    element.disabled = false;
  }
});

const handleReloadSite = action(async () => {
  const data = await api('POST', '/reload');
  const counts = data && typeof data === 'object' ? data : {};
  const summary = ['posts', 'pages', 'talks', 'friends', 'comments']
    .filter((key) => counts[key] !== undefined)
    .map((key) => `${key} ${counts[key]}`)
    .join(' · ');
  toast(summary ? `数据已重新加载：${summary}` : '数据已重新加载');
});

const handleLogout = action(async () => {
  await api('POST', '/logout');
  window.location.assign(LOGIN_PATH);
});

/* ==========================================================================
 * Shell navigation (narrow screens)
 * ======================================================================== */

/** Open/close the stacked sidebar below the 800px breakpoint. */
function toggleNav() {
  const shell = byId('admin-shell');
  if (shell) shell.classList.toggle('nav-open');
}

/* ==========================================================================
 * Action table — every `data-action` in the templates has an entry here
 * ======================================================================== */

const ACTIONS = {
  // Shell / session
  'toggle-nav': async () => toggleNav(),
  logout: handleLogout,

  // Authentication
  login: handleLogin,
  'login-totp': handleLoginTotp,
  'setup-init': handleSetupInit,
  'change-password': handleChangePassword,

  // Confirmation dialog
  'dialog-confirm': async () => resolveConfirm(true),
  'dialog-cancel': async () => resolveConfirm(false),

  // Posts
  'new-post': async (element) => navigate(element, `${POSTS_PATH}new/`),
  'edit-post': async (element) => navigate(element, `${POSTS_PATH}${encodeURIComponent(element.dataset.slug || '')}/edit/`),
  'save-post': handleSavePost,
  'toggle-archive': handleToggleArchive,
  'delete-post': handleDeletePost,

  // Markdown toolbar
  'md-bold': async (element) => insertMarkdown(element),
  'md-italic': async (element) => insertMarkdown(element),
  'md-heading': async (element) => insertMarkdown(element),
  'md-list': async (element) => insertMarkdown(element),
  'md-code': async (element) => insertMarkdown(element),
  'md-quote': async (element) => insertMarkdown(element),

  // Pages
  'new-page': async (element) => navigate(element, `${PAGES_PATH}new/`),
  'edit-page': async (element) => navigate(element, `${PAGES_PATH}${encodeURIComponent(element.dataset.slug || '')}/edit/`),
  'save-page': handleSavePage,
  'delete-page': handleDeletePage,

  // Talks
  'new-talk': async (element) => navigate(element, `${TALKS_PATH}new/`),
  'save-talk': handleSaveTalk,
  'delete-talk': handleDeleteTalk,

  // Friends
  'new-friend': async (element) => navigate(element, `${FRIENDS_PATH}new/`),
  'edit-friend': async (element) => navigate(element, `${FRIENDS_PATH}${encodeURIComponent(element.dataset.id || '')}/edit/`),
  'save-friend': handleSaveFriend,
  'delete-friend': handleDeleteFriend,

  // Comments
  'delete-comment': handleDeleteComment,

  // Visitors
  'save-visitor': handleSaveVisitor,
  'delete-visitor': handleDeleteVisitor,
  'approve-visitor': handleApproveVisitor,
  'reject-visitor': handleRejectVisitor,

  // Two-factor authentication
  'totp-start': handleTotpStart,
  'totp-verify': handleTotpVerify,
  'totp-cancel': handleTotpCancel,
  'totp-regenerate': handleTotpRegenerate,
  'totp-disable': handleTotpDisable,

  // Image host
  'save-imghost': handleSaveImghost,
  'test-imghost': handleTestImghost,
  'upload-imghost': handleUploadImghost,

  // Backup
  'export-backup': async () => {
    // A plain navigation: the Content-Disposition header triggers the download.
    window.location.assign(`${API_BASE}/export`);
  },
  'import-backup': handleImportBackup,
  'reload-site': handleReloadSite,

  // Site settings
  'save-settings': handleSaveSettings,
};

/* ==========================================================================
 * Wiring
 * ======================================================================== */

/** Look up and run the handler for one `[data-action]` element. */
function runAction(element) {
  const name = element.dataset ? element.dataset.action : '';
  const handler = ACTIONS[name];
  if (!handler) return;

  try {
    const result = handler(element);
    // Handlers already funnel their errors into `toast`; this is the safety net
    // for the few trivial ones that are not wrapped in `action()`.
    if (result && typeof result.catch === 'function') {
      result.catch((error) => {
        toast(error instanceof Error ? error.message : '操作失败', 'error');
      });
    }
  } catch (error) {
    toast(error instanceof Error ? error.message : '操作失败', 'error');
  }
}

// One listener for every click in the console; newly rendered markup works
// without any re-binding.
document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const element = target.closest('[data-action]');
  if (!element) return;

  // Handled actions navigate explicitly, so the default anchor/form behaviour
  // of an element that also carries an href or type="submit" must not run twice.
  event.preventDefault();
  runAction(element);
});

// One listener for implicit submissions (Enter inside a field). Our forms are
// all JavaScript-driven, so the browser must never navigate.
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();

  const trigger =
    form.querySelector('button[type="submit"][data-action]') || form.querySelector('[data-action]');
  if (trigger) runAction(trigger);
});

/* ==========================================================================
 * Page initialisation
 * ======================================================================== */

/** Show the stored provisioning URI on the QR image when it is an image. */
function initTotpQr() {
  const qr = byId('totp-qr');
  if (!qr) return;
  showQrImage(qr, qr.dataset.uri || '');
}

/** Show the chosen backup file name next to the picker. */
function initImportPicker() {
  const input = byId('import-file');
  const name = byId('file-name');
  if (!input || !name) return;
  input.addEventListener('change', () => {
    const file = input.files ? input.files[0] : null;
    name.textContent = file ? file.name : '未选择文件';
  });
}

/** Resolve the pending confirmation when the dialog closes any other way. */
function initConfirmDialog() {
  const dialog = byId('admin-confirm');
  if (!dialog) return;
  // `cancel` fires on Escape; `close` covers programmatic closes.
  dialog.addEventListener('cancel', () => resolveConfirm(false));
  dialog.addEventListener('close', () => {
    if (pendingConfirm) resolveConfirm(false);
  });
}

function init() {
  initAccent();
  initSettings();
  initTotpQr();
  initImghost();
  initImportPicker();
  initConfirmDialog();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
