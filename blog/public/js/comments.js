/**
 * comments.js — comment list and comment form for post pages.
 *
 * Only loaded on `/post/<slug>/` (see VIEW_SCRIPTS in src/routes/public-pages.ts).
 * Everything rendered here comes from other visitors, so every value goes into
 * the DOM through `textContent` / `createElement`; `innerHTML` is never used on
 * remote data (the previous implementation interpolated comment text straight
 * into an HTML template string, which made stored XSS trivial).
 *
 * API wire format (src/routes/public-api.ts):
 *   GET  /api/comments?path=…          → { errno: 0, data: PublicComment[] }
 *   GET  /api/comments?path=…&type=count → { errno: 0, data: { count } }
 *   POST /api/comments                 → { errno: 0, data: PublicComment }
 *                                        { errno: -1, errmsg }   (400, and 429
 *                                        with `code: 'rate_limited'` +
 *                                        `retryAfter` + a Retry-After header)
 *
 * A refusal always carries a reason meant for the visitor ("邮箱格式不正确",
 * "昵称过长（最多 80 字符）"), which the form shows verbatim; see `showError()`.
 *
 * A `PublicComment` is `{ id, nick, comment, link, avatar, createTime }` — the
 * endpoint deliberately withholds the stored `mail` and `ua`.
 *
 * `path` may be any URL form of the page (`/post/x` or `/post/x/`): the server
 * canonicalises it, so both forms address the same thread.
 *
 * The module is imported once but every post page is a fresh DOM (pjax swaps
 * `#content-container`), so the nodes and the page path are acquired by init()
 * each time and dropped by destroy().
 */

const COMMENTS_API = '/api/comments';

/* ==========================================================================
 * Instance state
 *
 * Nothing here may be captured at module scope: the module body runs a single
 * time while init() runs once per swapped-in page.
 * ======================================================================== */

/** Comments are stored per page path, so the path is the storage key. */
let pagePath = '';
let submitButton = null;
let listContainer = null;
let titleElement = null;
let emptyElement = null;
/**
 * Where a rejected submission explains itself. A snackbar is wrong for this:
 * it dismisses itself after a few seconds, and the reason ("邮箱格式不正确",
 * "评论太频繁了，请 47 秒后再试") is exactly what the visitor has to act on.
 */
let errorElement = null;
let nickField = null;
let mailField = null;
let linkField = null;
let contentField = null;
/**
 * Localised wording, re-parsed from `#comment-section[data-strings]` on every
 * init(): the count and the empty state describe a list that only exists after
 * the fetch below, so the server cannot render them, and a rejected submission
 * is explained in the visitor's language. Reads the same `strings:` overrides as
 * the rest of the site (see js/search.js).
 */
let strings = {};
/**
 * The "不展示我的信息" switch. When it is on, nothing about the visitor's browser
 * is sent: the request carries only what the visitor typed (plus the page path,
 * which is where the comment is stored).
 */
let privacyToggle = null;
/** The row wrapping the switch and its wording, which also toggles the switch. */
let privacyRow = null;

/** Whether the current instance acquired state (used to stay re-entrant). */
let initialised = false;
/**
 * Monotonic instance id. `#comments-container` exists on every post page, so a
 * response from the previous post must be recognised as stale rather than being
 * rendered into the new post's list.
 */
let instance = 0;

/* ==========================================================================
 * Small helpers
 * ======================================================================== */

/** Current value of an mdui-text-field (or any form field), trimmed. */
function fieldValue(field) {
  return field && typeof field.value === 'string' ? field.value.trim() : '';
}

/** Replace `{n}` placeholders in a template string (as js/search.js does). */
function format(template, values) {
  return String(template || '').replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

/** Reset every input of the comment form. */
function clearFields() {
  [nickField, mailField, linkField, contentField].forEach((field) => {
    if (field) field.value = '';
  });
  // The switch is a per-submission choice, so it goes back to its default
  // (off) together with the fields it applies to.
  if (privacyToggle) privacyToggle.checked = false;
}

/**
 * Let the wording next to the switch switch it too.
 *
 * mdui-switch is not form-associated — its shadow root contains the real
 * `<label><input type="checkbox">` pair — so wrapping it in a `<label>` would
 * label nothing and the words would be inert. This forwards the click instead.
 *
 * Clicks that land on the switch are skipped: `event.target` is retargeted to
 * the host for shadow content, so one check covers both the host and its track,
 * and the switch keeps handling those itself (toggling twice would cancel out).
 */
function onPrivacyRowClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !privacyToggle) return;
  if (target.closest('mdui-switch')) return;
  privacyToggle.checked = !privacyToggle.checked;
}

/**
 * Reveal one of the server-rendered snackbars.
 * mdui 2 exposes `.open`; older mdui builds used `.show`. Whichever exists is
 * used, so the page keeps working if the vendored bundle is ever swapped.
 */
function showSnackbar(className) {
  const snackbar = document.querySelector(`.${className}`);
  if (!snackbar) return;
  if ('open' in snackbar) snackbar.open = true;
  else snackbar.show = true;
}

/**
 * Explain why a submission was refused, under the form.
 *
 * This used to be a snackbar carrying the single word "提交失败", so a visitor
 * whose 网站 field read `example.com` — or one who had simply retried a few
 * times — was told nothing at all and had no way to know what to change.
 * `message` is the server's own wording when it has some (it always answers a
 * refusal with a reason a person can act on), and `strings.fail` otherwise.
 */
function showError(message, field) {
  if (errorElement) {
    errorElement.textContent = message || strings.fail || '';
    errorElement.hidden = errorElement.textContent === '';
  }
  // Put the caret where the problem is, so "邮箱格式不正确" is one click from
  // being fixed rather than a search for which field it meant.
  if (field && typeof field.focus === 'function') field.focus();
}

/** Drop the error line (on a successful submit). */
function clearError() {
  if (!errorElement) return;
  errorElement.textContent = '';
  errorElement.hidden = true;
}

/** Block the form while a request is in flight. */
function setSubmitting(busy) {
  if (!submitButton) return;
  submitButton.disabled = busy;
  submitButton.loading = busy;
}

/* ==========================================================================
 * Rendering
 * ======================================================================== */

/**
 * Avatar for one comment: the stored image when the visitor has one, otherwise
 * the site's generic person icon.
 */
function createAvatar(comment) {
  if (comment.avatar) {
    const image = document.createElement('img');
    image.className = 'comment-avatar';
    image.src = comment.avatar;
    image.alt = comment.nick || '';
    image.loading = 'lazy';
    // Broken avatar URLs must not leave a hole in the layout.
    image.addEventListener('error', () => {
      image.replaceWith(createFallbackAvatar());
    });
    return image;
  }
  return createFallbackAvatar();
}

/** `<mdui-avatar>` variant of the avatar. */
function createFallbackAvatar() {
  const avatar = document.createElement('mdui-avatar');
  avatar.className = 'comment-avatar';
  avatar.setAttribute('src', '/icon/person.svg');
  return avatar;
}

/** Build one `<mdui-list-item class="comment">` from a comment record. */
function createCommentItem(comment) {
  const item = document.createElement('mdui-list-item');
  item.className = 'comment';
  // `alignment=start` keeps the avatar at the top for multi-line comments and
  // `nonclickable` prevents the list item from looking interactive.
  item.setAttribute('alignment', 'start');
  item.setAttribute('nonclickable', '');

  const block = document.createElement('div');
  block.className = 'comment-block';
  block.setAttribute('slot', 'custom');
  block.append(createAvatar(comment));

  const right = document.createElement('div');
  right.className = 'comment-right-area';

  const nick = document.createElement('div');
  nick.className = 'comment-nick-name';
  nick.textContent = comment.nick || '匿名';

  const content = document.createElement('div');
  content.className = 'comment-content';
  content.textContent = comment.comment || '';

  right.append(nick, content);
  block.append(right);
  item.append(block);
  return item;
}

/**
 * Replace the list with the given comments, and show the empty state only when
 * a *successful* load came back with nothing to show.
 */
function renderComments(comments) {
  if (!listContainer) return;
  const fragment = document.createDocumentFragment();
  comments.forEach((comment) => fragment.append(createCommentItem(comment)));
  listContainer.replaceChildren(fragment);
  if (emptyElement) emptyElement.hidden = comments.length > 0;
}

/* ==========================================================================
 * Data loading
 * ======================================================================== */

/** Update the section heading with the number of comments on this page. */
async function loadCommentCount() {
  // Captured before the await: after it, the page may already have been swapped.
  const token = instance;
  try {
    const response = await fetch(
      `${COMMENTS_API}?path=${encodeURIComponent(pagePath)}&type=count`,
    );
    const result = await response.json();
    if (token !== instance) return;
    if (result.errno !== 0) {
      console.error('Comment count failed:', result.errmsg);
      return;
    }
    const count = Number(result.data && result.data.count) || 0;
    if (titleElement) {
      // `comment_count` is a `{n}` template (`1 条评论`), not a hardcoded
      // string: the label has to follow `strings:` in _config.yml like every
      // other piece of UI text on the site. A page rendered by an older build
      // has no `count` key, so fall back to the bare number.
      titleElement.textContent = strings.count ? format(strings.count, { n: count }) : String(count);
    }
  } catch (error) {
    // The heading keeps its server-rendered text; a failed count is not worth
    // interrupting the reader with a snackbar.
    console.error('Comment count request failed:', error);
  }
}

/** Fetch and render the comment list. */
async function loadComments() {
  if (!listContainer) return;
  // Captured before the await: a response for the previous post must not be
  // rendered into this post's list.
  const token = instance;
  try {
    const response = await fetch(`${COMMENTS_API}?path=${encodeURIComponent(pagePath)}`);
    const result = await response.json();
    if (token !== instance) return;
    if (result.errno !== 0) {
      console.error('Loading comments failed:', result.errmsg);
      return;
    }
    renderComments(Array.isArray(result.data) ? result.data : []);
  } catch (error) {
    console.error('Comment list request failed:', error);
  }
}

/* ==========================================================================
 * Submission
 * ======================================================================== */

/** Same shape the server accepts (store/comments.ts). */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Promote a bare host to an https URL, mirroring `normaliseCommentLink()` in
 * src/store/comments.ts. The 网站 field is optional and invites `example.com`,
 * which is what people type; the server used to refuse it and drop the whole
 * comment with it. Anything that is not `http(s)://…`, `host.tld` or
 * `host.tld/path` yields '' — the same value the server refuses.
 */
function normaliseLink(value) {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i.test(value)) return '';
  return `https://${value}`;
}

/**
 * First problem with the form, as `{ message, field }`, or null.
 *
 * Checked before sending so an obvious mistake costs no round trip and names
 * the field instead of failing silently. The server validates the same rules;
 * this is the fast path, not the authority.
 */
function checkForm(payload, linkInput) {
  if (!payload.nick) return { message: strings.required, field: nickField };
  if (!payload.mail) return { message: strings.required, field: mailField };
  if (!EMAIL_PATTERN.test(payload.mail)) return { message: strings.badEmail, field: mailField };
  if (!payload.comment) return { message: strings.required, field: contentField };
  if (linkInput && !payload.link) return { message: strings.badLink, field: linkField };
  return null;
}

/**
 * Why the server refused the comment.
 *
 * The endpoint answers every refusal with a reason meant for a person ("昵称过
 * 长（最多 80 字符）", "请求过于频繁，请稍后再试"), so that is what gets shown —
 * a generic "提交失败" left the visitor with nothing to correct. The one case
 * worth rewording is the rate limiter, whose wait is localised here into
 * `commentRateLimited` (`{n}` seconds) so `strings:` stays authoritative.
 */
function rejectionText(response, result) {
  const serverMessage =
    result && typeof result.errmsg === 'string' ? result.errmsg.trim() : '';
  if (response.status !== 429) return serverMessage;

  const retryAfter =
    Number(response.headers.get('Retry-After')) ||
    Number(result && result.retryAfter) ||
    60;
  const template = strings.rateLimited || serverMessage;
  return template ? format(template, { n: Math.ceil(retryAfter) }) : serverMessage;
}

/** Validate the form, POST the comment and refresh the list on success. */
async function submitComment() {
  const token = instance;
  /**
   * What leaves the browser. Everything here was typed by the visitor except
   * `ua` and `url`: `url` is what the comment is attached to, and `ua` is the
   * browsing detail the privacy switch exists to withhold. With the switch on
   * the field is simply absent, so the server stores an empty value rather than
   * a server-side guess at the browser.
   */
  const withheld = Boolean(privacyToggle && privacyToggle.checked);
  const linkInput = fieldValue(linkField);
  const payload = {
    nick: fieldValue(nickField),
    mail: fieldValue(mailField),
    comment: fieldValue(contentField),
    link: normaliseLink(linkInput),
    ua: withheld ? '' : navigator.userAgent,
    url: pagePath,
  };

  const problem = checkForm(payload, linkInput);
  if (problem) {
    showError(problem.message, problem.field);
    return;
  }

  clearError();
  setSubmitting(true);
  try {
    const response = await fetch(COMMENTS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    // A proxy or a crash can answer with HTML; that is a failed request, not a
    // rejection with a reason.
    const result = await response.json().catch(() => null);

    if (result && result.errno === 0) {
      // The visitor may have navigated away while the request was in flight;
      // the reply then belongs to a page that no longer exists.
      if (token !== instance) return;
      clearError();
      showSnackbar('snackbar-comment-success');
      clearFields();
      await Promise.all([loadCommentCount(), loadComments()]);
    } else {
      console.error('Comment rejected:', response.status, result && result.errmsg);
      if (token === instance) showError(rejectionText(response, result));
    }
  } catch (error) {
    if (token === instance) showSnackbar('snackbar-network-error');
    console.error('Comment request failed:', error);
  } finally {
    if (token === instance) setSubmitting(false);
  }
}

/* ==========================================================================
 * Wiring
 * ======================================================================== */

/**
 * Acquire the current post page and wire it up. Re-entrant: a second call
 * first tears the previous instance down, so the submit button can never end
 * up with two handlers.
 */
export function init() {
  if (initialised) destroy();
  instance += 1;

  // The comment block only exists on a post page (views/pages/post.ejs). On a
  // navigation to another page this module may still be called defensively, so
  // bail out unless the article marker is present.
  if (!document.querySelector('[data-post-slug]')) return;

  pagePath = window.location.pathname;
  submitButton = document.getElementById('comment-submit-button');
  listContainer = document.getElementById('comments-container');
  titleElement = document.getElementById('comment-section-title');
  emptyElement = document.getElementById('comment-empty');
  errorElement = document.getElementById('comment-error');
  nickField = document.getElementById('comment-nick');
  mailField = document.getElementById('comment-email');
  linkField = document.getElementById('comment-website');
  contentField = document.getElementById('comment-content');
  privacyToggle = document.getElementById('comment-privacy-toggle');
  privacyRow = document.getElementById('comment-privacy-row');
  strings = {};
  try {
    strings = JSON.parse(document.getElementById('comment-section')?.dataset.strings || '{}');
  } catch {
    strings = {};
  }
  initialised = true;

  // The submit button lives inside `#content-container` and would be discarded
  // with it on a swap; it is still unbound explicitly in destroy() so init()
  // stays idempotent even if it is called twice without a swap in between.
  if (submitButton) {
    submitButton.addEventListener('click', submitComment);
  }
  if (privacyRow) {
    privacyRow.addEventListener('click', onPrivacyRowClick);
  }

  // Modules are deferred, so the DOM is parsed: load immediately.
  loadCommentCount();
  loadComments();
}

/**
 * Release everything init() acquired. Safe before init() and safe twice: it
 * unsubscribes the form (a no-op when init() never ran), bumps the instance id
 * so replies still in flight are dropped, and clears the references.
 */
export function destroy() {
  if (submitButton) submitButton.removeEventListener('click', submitComment);
  if (privacyRow) privacyRow.removeEventListener('click', onPrivacyRowClick);

  instance += 1;
  initialised = false;
  pagePath = '';
  submitButton = null;
  listContainer = null;
  titleElement = null;
  emptyElement = null;
  errorElement = null;
  nickField = null;
  mailField = null;
  linkField = null;
  contentField = null;
  privacyToggle = null;
  privacyRow = null;
  strings = {};
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
