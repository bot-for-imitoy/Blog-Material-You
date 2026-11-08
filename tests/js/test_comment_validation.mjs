// Front-end tests for blog/public/js/comment.js
// Run: node tests/js/test_comment_validation.mjs
import fs from 'node:fs';
import vm from 'node:vm';

class El {
  constructor(tag, doc) {
    this.tagName = tag;
    this.ownerDocument = doc;
    this.children = [];
    this.attrs = {};
    this._text = '';
    this.dataset = {};
    this.classList = { add: () => {} };
  }
  set textContent(v) { this.children = []; this._text = String(v); }
  get textContent() {
    return this._text + this.children.map(c => c.textContent).join('');
  }
  appendChild(c) { this.children.push(c); return c; }
  insertBefore(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener() {}
  cloneNode() { return new El(this.tagName, this.ownerDocument); }
  focus() { this.focused = true; }
}

function makeDocument() {
  const doc = {
    createElement: (tag) => new El(tag, doc),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return doc;
}

const doc = makeDocument();
const sandbox = {
  window: {},
  document: doc,
  navigator: { language: 'zh-CN', userAgent: 'node-test' },
  console,
  fetch: () => Promise.reject(new Error('no network in unit test')),
  Promise,
};
sandbox.window.document = doc;
sandbox.window.navigator = sandbox.navigator;
sandbox.window.location = { pathname: '/post/x' };
vm.createContext(sandbox);

const src = fs.readFileSync(new URL('../../blog/public/js/comment.js', import.meta.url), 'utf8');
vm.runInContext(src, sandbox);

const api = sandbox.window.BMYComments;

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  PASS  ' + msg); }
  else { failed++; console.log('  FAIL  ' + msg); }
}
function eq(a, b, msg) {
  if (a === b) { passed++; console.log('  PASS  ' + msg); }
  else { failed++; console.log(`  FAIL  ${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`); }
}

console.log('== comment.js validation ==');

const empty = api.validate({ nick: '', mail: '', comment: '', link: '' });
eq(empty.length, 3, 'empty form reports exactly 3 required errors');
eq(empty[0].field, 'nick', 'error order starts with nick');
eq(empty[0].message, '请填写昵称', 'zh-CN locale message for nick');
eq(api.strings.required, '此项为必填项', 'zh-CN required hint is localised');

const blank = api.validate({ nick: '   ', mail: 'a@b.co', comment: 'hi', link: '' });
eq(blank.length, 1, 'whitespace-only nick is rejected');
eq(blank[0].field, 'nick', 'whitespace-only nick -> nick field');

const badMail = api.validate({ nick: 'n', mail: 'nope', comment: 'hi', link: '' });
eq(badMail.length, 1, 'invalid email rejected');
eq(badMail[0].field, 'mail', 'invalid email -> mail field');

const good = api.validate({ nick: 'n', mail: 'a@b.co', comment: 'hi', link: 'https://example.com' });
eq(good.length, 0, 'valid payload has no errors');

const jsLink = api.validate({ nick: 'n', mail: 'a@b.co', comment: 'hi', link: 'javascript:alert(1)' });
eq(jsLink[0].field, 'link', 'javascript: link rejected');

const longNick = api.validate({ nick: 'x'.repeat(101), mail: 'a@b.co', comment: 'hi', link: '' });
eq(longNick[0].field, 'nick', '101-char nick rejected');

// ---- rendering: user data must never become markup ----
console.log('\n== comment.js rendering ==');
const container = new El('mdui-list', doc);
api._render(container, [
  { nick: '<img src=x onerror=alert(1)>', comment: '<script>alert(2)</script>' },
  { nick: 'ok', comment: 'plain', avatar: 'x" onerror="alert(3)' },
  { nick: 'ok2', comment: 'plain', avatar: 'javascript:alert(4)' },
  { nick: 'ok3', comment: 'plain', avatar: 'https://cdn.example.com/a.png' },
]);

const markup = JSON.stringify(container);
const tags = [];
(function walk(n) { tags.push(n.tagName); n.children.forEach(walk); })(container);
ok(!markup.includes('onerror="alert'), 'no injected event handler attributes');
ok(!tags.includes('script'), 'no script element created from comment body');

const texts = [];
(function walk(n) { if (n._text) texts.push(n._text); n.children.forEach(walk); })(container);
ok(texts.includes('<img src=x onerror=alert(1)>'), 'nick payload rendered as literal text');
ok(texts.includes('<script>alert(2)</script>'), 'comment payload rendered as literal text');

const avatars = [];
(function walk(n) { if (n.tagName === 'img') avatars.push(n.attrs.src); n.children.forEach(walk); })(container);
eq(avatars.length, 1, 'only the safe http(s) avatar becomes an <img>');
eq(avatars[0], 'https://cdn.example.com/a.png', 'safe avatar src preserved');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
