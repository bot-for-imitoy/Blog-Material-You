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
 */

const COMMENTS_API = '/api/comments';
/** Comments are stored per page path, so the path is the storage key. */
const PAGE_PATH = window.location.pathname;

const submitButton = document.getElementById('comment-submit-button');
const listContainer = document.getElementById('comments-container');
const titleElement = document.getElementById('comment-section-title');
const nickField = document.getElementById('comment-nick');
const mailField = document.getElementById('comment-email');
const linkField = document.getElementById('comment-website');
const contentField = document.getElementById('comment-content');

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
  try {
    const response = await fetch(
      `${COMMENTS_API}?path=${encodeURIComponent(PAGE_PATH)}&type=count`,
    );
    const result = await response.json();
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
  try {
    const response = await fetch(`${COMMENTS_API}?path=${encodeURIComponent(PAGE_PATH)}`);
    const result = await response.json();
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
  const payload = {
    nick: fieldValue(nickField),
    mail: fieldValue(mailField),
    comment: fieldValue(contentField),
    link: fieldValue(linkField),
    ua: navigator.userAgent,
    url: PAGE_PATH,
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
      showSnackbar('snackbar-comment-success');
      clearFields();
      await Promise.all([loadCommentCount(), loadComments()]);
    } else {
      showSnackbar('snackbar-comment-failure');
      console.error('Comment rejected:', result.errmsg);
    }
  } catch (error) {
    showSnackbar('snackbar-network-error');
    console.error('Comment request failed:', error);
  } finally {
    setSubmitting(false);
  }
}

/* ==========================================================================
 * Wiring
 * ======================================================================== */

if (submitButton) {
  submitButton.addEventListener('click', submitComment);
}

// Modules are deferred, so the DOM is parsed: load immediately.
loadCommentCount();
loadComments();
