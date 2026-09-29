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
 */

const AUTH_CHECK_API = '/api/auth/check';
const AUTH_REGISTER_API = '/api/auth/register';
/** Same shape the server validates against. */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const emailInput = document.getElementById('auth-email-input');
const submitButton = document.getElementById('auth-submit-btn');
const resultElement = document.getElementById('auth-result');

/**
 * Text node holder inside #auth-result. The container also carries the
 * registration button, so messages are written to this span instead of wiping
 * the element's children.
 */
let resultText = null;

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
  button.disabled = true;
  button.loading = true;

  try {
    const response = await fetch(AUTH_REGISTER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const result = await response.json();

    if (result.errno === 0) {
      setResult((result.data && result.data.message) || '注册请求已提交，请等待管理员审核。');
      button.remove();
      return;
    }

    setResult(result.errmsg || '提交失败，请稍后重试。', true);
  } catch (error) {
    setResult('网络错误，请检查连接后重试。', true);
    console.error('Registration request failed:', error);
  }

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

/* ==========================================================================
 * Email check
 * ======================================================================== */

/** Validate the address, ask the server and branch on the answer. */
async function checkEmail() {
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
    setResult('网络错误，请检查连接后重试。', true);
    console.error('Auth check failed:', error);
  } finally {
    setBusy(false);
  }
}

/* ==========================================================================
 * Wiring
 * ======================================================================== */

// The form only exists for unauthenticated visitors; the authenticated card has
// no #auth-submit-btn, so the module stays dormant there.
if (submitButton) {
  submitButton.addEventListener('click', checkEmail);
}

if (emailInput) {
  emailInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') checkEmail();
  });
}
