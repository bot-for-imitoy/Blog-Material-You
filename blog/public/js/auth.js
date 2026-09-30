/**
 * auth.js — visitor email verification on /auth/.
 *
 * Loaded only on `/auth/` (see VIEW_SCRIPTS in src/routes/public-pages.ts).
 * The whole flow is progressive: the page renders a form, this script checks
 * whether the address is registered and — when it is not — offers an inline
 * registration request.
 *
 *   POST /api/auth/check    { email } → { errno: 0, data: { registered, … } }
 *   POST /api/auth/register { email } → { errno: 0, data: { message } }
 *
 * A successful check also sets the signed visitor cookie, which is why the page
 * is simply reloaded: the server then renders the authenticated state.
 *
 * The module body is evaluated once, so the form fields are acquired by init()
 * (once per swapped-in page) and released by destroy().
 */

const AUTH_CHECK_API = '/api/auth/check';
const AUTH_REGISTER_API = '/api/auth/register';
/** Same shape the server validates against. */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* ==========================================================================
 * Instance state
 * ======================================================================== */

let emailInput = null;
let submitButton = null;
let resultElement = null;

/**
 * Text node holder inside #auth-result. The container also carries the
 * registration button, so messages are written to this span instead of wiping
 * the element's children.
 */
let resultText = null;

/** Whether the current instance acquired state (used to stay re-entrant). */
let initialised = false;
/**
 * Monotonic instance id: a reply that arrives after the page was swapped must
 * not write into the next instance's #auth-result.
 */
let instance = 0;

/* ==========================================================================
 * Result rendering
 * ======================================================================== */

/** Write a status message; `isError` switches it to the error colour. */
function setResult(message, isError) {
  if (!resultElement) return;

  if (!resultText || !resultText.isConnected) {
    resultText = document.createElement('span');
    resultText.className = 'auth-result-text';
    resultElement.replaceChildren(resultText);
  }
  resultText.textContent = message;
  resultElement.classList.toggle('auth-result-error', Boolean(isError));
}

/** Block the controls while a request is in flight. */
function setBusy(busy) {
  if (submitButton) {
    submitButton.disabled = busy;
    submitButton.loading = busy;
  }
}

/* ==========================================================================
 * Registration request
 * ======================================================================== */

/** POST a registration request and report the outcome in place. */
async function requestRegistration(email, button) {
  const token = instance;
  button.disabled = true;
  button.loading = true;

  try {
    const response = await fetch(AUTH_REGISTER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const result = await response.json();
    if (token !== instance) return;

    if (result.errno === 0) {
      setResult((result.data && result.data.message) || '注册请求已提交，请等待管理员审核。');
      button.remove();
      return;
    }

    setResult(result.errmsg || '提交失败，请稍后重试。', true);
  } catch (error) {
    if (token === instance) setResult('网络错误，请检查连接后重试。', true);
    console.error('Registration request failed:', error);
  }

  if (token !== instance) return;

  // Only reached on failure: give the visitor another chance.
  button.disabled = false;
  button.loading = false;
}

/** Offer the "send registration request" button next to the message. */
function showRegisterButton(email) {
  if (!resultElement) return;
  if (resultElement.querySelector('.auth-register-btn')) return;

  const button = document.createElement('mdui-button');
  button.className = 'auth-register-btn';
  button.setAttribute('variant', 'tonal');
  button.textContent = '📨 发送注册申请';
  button.addEventListener('click', () => requestRegistration(email, button));
  resultElement.append(button);
}

/** Enter submits the single-field form, matching `<form>` behaviour. */
function onEmailKeydown(event) {
  if (event.key === 'Enter') checkEmail();
}

/* ==========================================================================
 * Email check
 * ======================================================================== */

/** Validate the address, ask the server and branch on the answer. */
async function checkEmail() {
  const token = instance;
  const email = emailInput && typeof emailInput.value === 'string' ? emailInput.value.trim() : '';

  if (!EMAIL_PATTERN.test(email)) {
    setResult('邮箱格式不正确，请检查后重试。', true);
    return;
  }

  setBusy(true);
  setResult('正在验证…');

  try {
    const response = await fetch(AUTH_CHECK_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const result = await response.json();
    if (token !== instance) return;

    if (result.errno !== 0) {
      setResult(result.errmsg || '验证失败，请稍后重试。', true);
      return;
    }

    const data = result.data || {};
    if (data.registered) {
      setResult('✅ 验证通过，正在刷新页面…');
      // The check response already set the visitor cookie; reloading lets the
      // server render the authenticated card.
      window.location.reload();
      return;
    }

    setResult('该邮箱尚未注册，可发送注册申请等待管理员审核。');
    showRegisterButton(email);
  } catch (error) {
    if (token === instance) setResult('网络错误，请检查连接后重试。', true);
    console.error('Auth check failed:', error);
  } finally {
    if (token === instance) setBusy(false);
  }
}

/* ==========================================================================
 * Wiring
 * ======================================================================== */

/**
 * Acquire the current /auth/ page and wire it up. Re-entrant: a second call
 * tears the previous instance down first, so the button can never carry two
 * click handlers.
 */
export function init() {
  if (initialised) destroy();
  instance += 1;

  // Both states of the page render an #auth-card; on any other page pjax may
  // still call this defensively, and there is nothing to wire there.
  if (!document.getElementById('auth-card')) return;

  emailInput = document.getElementById('auth-email-input');
  submitButton = document.getElementById('auth-submit-btn');
  resultElement = document.getElementById('auth-result');
  // The result container is a fresh node on every navigation, so the cached
  // text span must not leak from the previous instance.
  resultText = null;
  initialised = true;

  // The form only exists for unauthenticated visitors; the authenticated card
  // has no #auth-submit-btn, so the module stays dormant there.
  if (submitButton) {
    submitButton.addEventListener('click', checkEmail);
  }

  if (emailInput) {
    emailInput.addEventListener('keydown', onEmailKeydown);
  }
}

/**
 * Release everything init() acquired. Safe before init() and safe twice.
 *
 * The two listeners sit inside `#content-container` and would be discarded with
 * the swapped subtree, but they are unbound explicitly so init() stays
 * idempotent even if it is called twice without a swap in between. Bumping the
 * instance id makes any reply still in flight a no-op.
 */
export function destroy() {
  if (submitButton) submitButton.removeEventListener('click', checkEmail);
  if (emailInput) emailInput.removeEventListener('keydown', onEmailKeydown);

  instance += 1;
  initialised = false;
  emailInput = null;
  submitButton = null;
  resultElement = null;
  resultText = null;
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
