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
 *   GET  /api/comments?path=…          → { errno: 0, data: Comment[] }
 *   GET  /api/comments?path=…&type=count → { errno: 0, data: { count } }
 *   POST /api/comments                 → { errno: 0, data: Comment }
 *                                        { errno: -1, errmsg }
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
let nickField = null;
let mailField = null;
let linkField = null;
let contentField = null;
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

/** Replace the list with the given comments. */
function renderComments(comments) {
  if (!listContainer) return;
  const fragment = document.createDocumentFragment();
  comments.forEach((comment) => fragment.append(createCommentItem(comment)));
  listContainer.replaceChildren(fragment);
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
    if (titleElement) titleElement.textContent = `${count} 条评论`;
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
  const payload = {
    nick: fieldValue(nickField),
    mail: fieldValue(mailField),
    comment: fieldValue(contentField),
    link: fieldValue(linkField),
    ua: withheld ? '' : navigator.userAgent,
    url: pagePath,
  };

  // The three required fields; the website is optional and the server rejects
  // anything that is not an http(s) URL.
  if (!payload.nick || !payload.mail || !payload.comment) {
    showSnackbar('snackbar-comment-failure');
    return;
  }

  setSubmitting(true);
  try {
    const response = await fetch(COMMENTS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    if (result.errno === 0) {
      // The visitor may have navigated away while the request was in flight;
      // the reply then belongs to a page that no longer exists.
      if (token !== instance) return;
      showSnackbar('snackbar-comment-success');
      clearFields();
      await Promise.all([loadCommentCount(), loadComments()]);
    } else {
      if (token === instance) showSnackbar('snackbar-comment-failure');
      console.error('Comment rejected:', result.errmsg);
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
  nickField = document.getElementById('comment-nick');
  mailField = document.getElementById('comment-email');
  linkField = document.getElementById('comment-website');
  contentField = document.getElementById('comment-content');
  privacyToggle = document.getElementById('comment-privacy-toggle');
  privacyRow = document.getElementById('comment-privacy-row');
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
  nickField = null;
  mailField = null;
  linkField = null;
  contentField = null;
  privacyToggle = null;
  privacyRow = null;
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
