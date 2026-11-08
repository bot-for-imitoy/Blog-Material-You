/*
 * comment.js — public comment form: validation, accessibility and rendering.
 *
 * Loaded by templates/pages/shell.etlua for every page, but it does nothing
 * until BMYComments.init(path) is called after the post fragment is rendered.
 *
 * Design notes
 *  - Field level validation mirrors backend/lua/comment_validation.lua, so a
 *    user sees the error before a round-trip; a 422 from the server is mapped
 *    back onto the same field if the two ever disagree.
 *  - Errors are real DOM nodes referenced through aria-describedby, and the
 *    invalid state is exposed with aria-invalid (no alert(), no innerHTML
 *    concatenation of user data).
 *  - Comments are rendered with textContent / createElement only: nick,
 *    comment body and avatar are all attacker-controlled.
 */
(function () {
  'use strict';

  var LIMITS = { nick: 100, mail: 254, comment: 5000, link: 500 };

  var ZH = (navigator.language || '').toLowerCase().indexOf('zh') === 0;
  var STRINGS = ZH ? {
    required: '此项为必填项',
    nickRequired: '请填写昵称',
    mailRequired: '请填写邮箱',
    mailInvalid: '邮箱格式不正确',
    contentRequired: '请填写评论内容',
    nickTooLong: '昵称不能超过 100 个字符',
    contentTooLong: '评论不能超过 5000 个字符',
    linkInvalid: '网站地址需以 http:// 或 https:// 开头',
    submitFailed: '评论提交失败',
    networkError: '网络错误，请检查连接后重试',
    loadFailed: '评论加载失败'
  } : {
    required: 'This field is required',
    nickRequired: 'Please enter a nickname',
    mailRequired: 'Please enter your email',
    mailInvalid: 'Please enter a valid email address',
    contentRequired: 'Please write a comment',
    nickTooLong: 'Nickname must be at most 100 characters',
    contentTooLong: 'Comment must be at most 5000 characters',
    linkInvalid: 'Website must start with http:// or https://',
    submitFailed: 'Failed to submit comment',
    networkError: 'Network error, please check your connection',
    loadFailed: 'Failed to load comments'
  };

  // field name -> { el, errorId, message }
  var FIELDS = {
    nick: { id: 'comment-nick' },
    mail: { id: 'comment-email', errorId: 'comment-email-error' },
    comment: { id: 'comment-content' },
    link: { id: 'comment-website' }
  };

  function $(id) { return document.getElementById(id); }

  function snackbar(type) {
    var el = document.querySelector('.snackbar-' + type);
    if (el) el.show = true;
  }

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  /* ---------- field errors ---------- */

  function errorNode(field) {
    if (!FIELDS[field]) return null;
    var input = $(FIELDS[field].id);
    if (!input) return null;
    var id = FIELDS[field].errorId || ('comment-' + field + '-error');
    var node = document.getElementById(id);
    if (!node) {
      node = el('div', 'comment-field-error');
      node.id = id;
      // role=alert is read by screen readers as soon as the text appears
      node.setAttribute('role', 'alert');
      input.parentNode.insertBefore(node, input.nextSibling);
    }
    return node;
  }

  function clearError(field) {
    if (!FIELDS[field]) return;
    var node = document.getElementById(FIELDS[field].errorId || ('comment-' + field + '-error'));
    var input = $(FIELDS[field].id);
    if (input) {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('error');
      input.removeAttribute('aria-describedby');
    }
    if (node) node.textContent = '';
  }

  function showError(field, message) {
    if (!FIELDS[field]) return;
    var node = errorNode(field);
    var input = $(FIELDS[field].id);
    if (node) node.textContent = message;
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('error', '');
      if (node) input.setAttribute('aria-describedby', node.id);
    }
  }

  function clearAllErrors() {
    Object.keys(FIELDS).forEach(clearError);
  }

  /* ---------- validation (mirrors the server) ---------- */

  function isEmail(value) {
    if (value.length > LIMITS.mail) return false;
    if (/[\s"'\\,;:<>()[\]%]/.test(value)) return false;
    var at = value.indexOf('@');
    if (at <= 0 || at !== value.lastIndexOf('@')) return false;
    var local = value.slice(0, at);
    var domain = value.slice(at + 1);
    if (local.length > 64) return false;
    if (!domain || domain[0] === '.' || domain[domain.length - 1] === '.') return false;
    if (domain.indexOf('..') !== -1) return false;
    return /^[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(domain);
  }

  function readValues() {
    return {
      nick: ($('comment-nick') || {}).value || '',
      mail: ($('comment-email') || {}).value || '',
      link: ($('comment-website') || {}).value || '',
      comment: ($('comment-content') || {}).value || ''
    };
  }

  /** @returns {Array} [{field, message}] in visual order */
  function validate(values) {
    var errors = [];
    var nick = String(values.nick).trim();
    var mail = String(values.mail).trim();
    var link = String(values.link).trim();
    var body = String(values.comment).trim();

    if (!nick) errors.push({ field: 'nick', message: STRINGS.nickRequired });
    else if (nick.length > LIMITS.nick) errors.push({ field: 'nick', message: STRINGS.nickTooLong });

    if (!mail) errors.push({ field: 'mail', message: STRINGS.mailRequired });
    else if (!isEmail(mail)) errors.push({ field: 'mail', message: STRINGS.mailInvalid });

    if (!body) errors.push({ field: 'comment', message: STRINGS.contentRequired });
    else if (body.length > LIMITS.comment) errors.push({ field: 'comment', message: STRINGS.contentTooLong });

    if (link && !/^https?:\/\/\S+$/i.test(link)) {
      errors.push({ field: 'link', message: STRINGS.linkInvalid });
    }

    return errors;
  }

  function focusField(field) {
    var input = $(FIELDS[field] && FIELDS[field].id);
    if (!input) return;
    if (typeof input.focus === 'function') input.focus();
  }

  /* ---------- rendering ---------- */

  function safeUrl(value, allowRelative) {
    if (typeof value !== 'string' || value === '') return '';
    if (/[\s"'<>`]/.test(value)) return '';
    if (allowRelative && value.charAt(0) === '/' && value.charAt(1) !== '/') return value;
    if (/^https?:\/\//i.test(value)) return value;
    return '';
  }

  function renderComments(container, list) {
    container.textContent = '';
    (list || []).forEach(function (comment) {
      var item = document.createElement('mdui-list-item');
      item.classList.add('comment');
      item.alignment = 'start';
      item.nonclickable = true;

      var block = el('div', 'comment-block');
      block.setAttribute('slot', 'custom');

      var avatarSrc = safeUrl(comment.avatar, true) || '/icon/person.svg';
      var avatar;
      if (avatarSrc === '/icon/person.svg') {
        avatar = document.createElement('mdui-avatar');
        avatar.setAttribute('src', avatarSrc);
      } else {
        avatar = el('img', 'comment-avatar');
        avatar.setAttribute('src', avatarSrc);
        avatar.setAttribute('alt', '');
        avatar.setAttribute('loading', 'lazy');
        avatar.setAttribute('referrerpolicy', 'no-referrer');
      }
      avatar.classList.add('comment-avatar');

      var right = el('div', 'comment-right-area');
      var nick = el('p', 'comment-nick-name');
      nick.textContent = comment.nick || '';
      var body = el('div', 'comment-content');
      body.textContent = comment.comment || '';
      right.appendChild(nick);
      right.appendChild(body);

      block.appendChild(avatar);
      block.appendChild(right);
      item.appendChild(block);
      container.appendChild(item);
    });
  }

  function setCount(count) {
    var title = document.querySelector('.comment-section-title');
    if (!title) return;
    count = parseInt(count, 10) || 0;
    title.textContent = count + ' Comment' + (count !== 1 ? 's' : '');
  }

  function loadComments(path) {
    fetch('/api/comments?path=' + encodeURIComponent(path))
      .then(function (res) { return res.json(); })
      .then(function (result) {
        if (result.errno !== 0) {
          console.error('Load comments failed:', result.errmsg);
          snackbar('comment-failure');
          return;
        }
        var container = $('comments-container');
        if (container && result.data && result.data.data) {
          renderComments(container, result.data.data);
        }
      })
      .catch(function (err) {
        console.error('Load comments network error:', err);
        snackbar('network-error');
      });
  }

  function loadCount(path) {
    return fetch('/api/comments?type=count&path=' + encodeURIComponent(path))
      .then(function (res) { return res.json(); })
      .then(function (result) {
        if (result.errno === 0 && result.data) setCount(result.data.count);
      })
      .catch(function () { /* the list request will surface the error */ });
  }

  /* ---------- submit ---------- */

  function setBusy(busy) {
    var btn = $('comment-submit-button');
    var ids = ['comment-nick', 'comment-email', 'comment-website', 'comment-content'];
    ids.forEach(function (id) {
      var input = $(id);
      if (input) input.disabled = busy;
    });
    if (btn) {
      btn.disabled = busy;
      btn.loading = busy;
    }
  }

  function clearForm() {
    ['comment-nick', 'comment-email', 'comment-website', 'comment-content'].forEach(function (id) {
      var input = $(id);
      if (input) input.value = '';
    });
    clearAllErrors();
  }

  function submit(path) {
    var values = readValues();
    var errors = validate(values);
    clearAllErrors();

    if (errors.length) {
      errors.forEach(function (e) { showError(e.field, e.message); });
      focusField(errors[0].field);
      return;
    }

    setBusy(true);
    fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nick: values.nick.trim(),
        mail: values.mail.trim(),
        comment: values.comment.trim(),
        link: values.link.trim(),
        ua: navigator.userAgent,
        url: path
      })
    }).then(function (res) {
      return res.json().catch(function () { return { errno: -1 }; });
    }).then(function (result) {
      if (result.errno === 0) {
        snackbar('comment-success');
        clearForm();
        loadCount(path);
        loadComments(path);
      } else if (result.field && FIELDS[result.field]) {
        // Server-side validation (422): focus the exact field it complained about
        var CODE = {
          nick_required: 'nickRequired', nick_too_long: 'nickTooLong',
          mail_required: 'mailRequired', mail_invalid: 'mailInvalid',
          content_required: 'contentRequired', content_too_long: 'contentTooLong',
          link_invalid: 'linkInvalid'
        };
        clearAllErrors();
        showError(result.field, STRINGS[CODE[result.error]] || result.errmsg || STRINGS.submitFailed);
        focusField(result.field);
        snackbar('comment-failure');
      } else {
        snackbar('comment-failure');
        console.error('Submit comment failed:', result.errmsg || result.error);
      }
    }).catch(function (err) {
      console.error('Submit comment network error:', err);
      snackbar('network-error');
    }).then(function () {
      setBusy(false);
    });
  }

  function bindForm(path) {
    var btn = $('comment-submit-button');
    if (!btn || btn.dataset.bmyBound === '1') return;

    // cloneNode drops listeners from a previous page instance
    var fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    fresh.dataset.bmyBound = '1';
    fresh.addEventListener('click', function () { submit(path); });

    Object.keys(FIELDS).forEach(function (field) {
      var input = $(FIELDS[field].id);
      if (!input) return;
      input.setAttribute('aria-required', field === 'link' ? 'false' : 'true');
      input.addEventListener('input', function () {
        clearError(field);
        if (field === 'nick' || field === 'mail' || field === 'comment') {
          input.removeAttribute('aria-invalid');
        }
      });
    });
  }

  function init(path) {
    path = path || window.location.pathname;
    if (!$('comment-submit-button')) return; // not a post page
    bindForm(path);
    loadCount(path);
    loadComments(path);
  }

  window.BMYComments = {
    init: init,
    validate: validate,
    clearAllErrors: clearAllErrors,
    strings: STRINGS,
    // Exposed for tests/js/test_comment_validation.mjs — not part of the UI API.
    _render: renderComments
  };
})();
