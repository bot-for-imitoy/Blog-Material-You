/**
 * app.js — shared enhancement layer for every public page.
 *
 * The site is a plain server-rendered multi-page app: there is no router, no
 * pjax and no client-side Markdown rendering, so this module deliberately does
 * very little. It only adds behaviour that the server cannot express:
 *
 *   1. `data-action` event delegation (currently just the drawer toggle);
 *   2. closing the drawer after a navigation on narrow screens;
 *   3. image placeholders (skeleton while loading, error state on failure);
 *   4. `loading="lazy"` for images that do not ask for it themselves;
 *   5. the hidden /2048/ easter egg on the about page.
 *
 * Everything is guarded by element lookups so one module can safely run on
 * every page. All DOM built here uses createElement/textContent — never
 * innerHTML — so visitor data can never be interpreted as markup.
 */

/** Viewport width (px) at or below which the drawer behaves as mobile. */
const WIDE_VIEWPORT = 900;

/** Pages that host the click-count easter egg, in trailing-slash form. */
const EASTER_EGG_PATHS = ['/about/', '/pages/about/'];
/** Number of clicks needed before the game opens. */
const EASTER_EGG_CLICKS = 7;
/** Where the easter egg navigates to. */
const EASTER_EGG_TARGET = '/2048/';

/* ==========================================================================
 * Navigation drawer
 * ======================================================================== */

/** @returns {Element|null} the sidebar drawer, when the layout has one. */
function getDrawer() {
  return document.querySelector('.navigation-drawer');
}

/** Narrow viewports get the modal drawer, which must be closed by hand. */
function isNarrowViewport() {
  return window.innerWidth <= WIDE_VIEWPORT;
}

/**
 * Open/close the drawer. navigation-drawer.js exposes the implementation so
 * both scripts share one source of truth; the fallback only runs if that
 * script failed to load.
 */
function toggleDrawer() {
  if (typeof window.toggleNavigationDrawer === 'function') {
    window.toggleNavigationDrawer();
    return;
  }
  const drawer = getDrawer();
  if (drawer) {
    drawer.open = !drawer.open;
  }
}

/** Close the drawer unconditionally (used after in-drawer navigation). */
function closeDrawer() {
  const drawer = getDrawer();
  if (drawer) {
    drawer.open = false;
  }
}

/* ==========================================================================
 * Image placeholders
 * ======================================================================== */

/** Label used when the server did not render one we can reuse. */
const FALLBACK_LOADING_LABEL = '加载中...';
/** Label shown when an image fails to load. */
const IMAGE_ERROR_LABEL = '图片加载失败';

/**
 * The server renders the "loading" label in the page language for post covers.
 * Reuse that string for injected skeletons so no i18n has to ship to the
 * client. Falls back to the Chinese default on pages without a cover.
 */
function loadingLabel() {
  const serverLabel = document.querySelector(
    '.post-header-cover-wrapper .image-skeleton span:not(.image-skeleton-icon)',
  );
  const text = serverLabel && serverLabel.textContent ? serverLabel.textContent.trim() : '';
  return text || FALLBACK_LOADING_LABEL;
}

/**
 * Build the skeleton placeholder. Spans are used on purpose: the placeholder is
 * often injected into a <p> (markdown images live in paragraphs), and spans are
 * the only valid flow content there. CSS gives them block/flex behaviour.
 */
function createSkeleton(label) {
  const skeleton = document.createElement('span');
  skeleton.className = 'image-skeleton';

  const icon = document.createElement('span');
  icon.className = 'image-skeleton-icon';
  icon.textContent = '🖼️';

  const text = document.createElement('span');
  text.textContent = label;

  skeleton.append(icon, text);
  return skeleton;
}

/** Reveal the image and hide its skeleton (CSS keys off `.loaded`). */
function markImageLoaded(wrapper) {
  wrapper.classList.add('loaded');
  wrapper.classList.remove('error');
}

/** Keep the skeleton visible but switch it to the error state. */
function markImageFailed(wrapper) {
  // A successful load always wins: never overwrite it with an error state.
  if (wrapper.classList.contains('loaded')) return;
  wrapper.classList.add('error');

  const icon = wrapper.querySelector('.image-skeleton .image-skeleton-icon');
  if (icon) icon.textContent = '⚠️';
  const label = wrapper.querySelector('.image-skeleton span:not(.image-skeleton-icon)');
  if (label) label.textContent = IMAGE_ERROR_LABEL;
}

/**
 * Wire an image to its wrapper. Cached images can already be finished long
 * before this module runs, so `complete` is checked as well as the events.
 */
function watchImage(img, wrapper) {
  if (img.dataset.imageWatched === 'true') return;
  img.dataset.imageWatched = 'true';

  img.addEventListener('load', () => markImageLoaded(wrapper));
  img.addEventListener('error', () => markImageFailed(wrapper));

  if (img.complete) {
    if (img.naturalWidth > 0) markImageLoaded(wrapper);
    else markImageFailed(wrapper);
  }
}

/** Tags that only wrap the image; the placeholder belongs to a block parent. */
const INLINE_WRAPPER_TAGS = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'CODE', 'DEL', 'EM', 'I', 'INS',
  'LABEL', 'MARK', 'PICTURE', 'Q', 'RUBY', 'S', 'SMALL', 'SPAN', 'STRONG',
  'SUB', 'SUP', 'TIME', 'U', 'VAR', 'WBR',
]);

/**
 * Block elements that may carry `.image-wrapper` themselves. Table cells are
 * deliberately excluded: `.image-wrapper` sets `display: block`, which would
 * break the surrounding table layout.
 */
const REUSABLE_HOST_TAGS = new Set([
  'P', 'DIV', 'FIGURE', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'DD',
]);

/**
 * Nearest block-level host of an image: climbs out of inline wrappers such as
 * `<a>` or `<picture>` so the skeleton never becomes a child of an inline box.
 */
function blockHost(img) {
  let node = img.parentElement;
  while (node && node !== document.body && INLINE_WRAPPER_TAGS.has(node.tagName)) {
    node = node.parentElement;
  }
  return node;
}

/** Wrap an image in a fresh `.image-wrapper` div, in place. */
function wrapImage(img) {
  const wrapper = document.createElement('div');
  wrapper.className = 'image-wrapper';
  img.replaceWith(wrapper);
  wrapper.append(img);
  return wrapper;
}

/**
 * Whether an existing block element can act as the image wrapper.
 * A paragraph is only reused when the image is its entire content — otherwise
 * the absolutely positioned skeleton would cover the surrounding text.
 */
function canReuseHost(host, article, img) {
  if (!host || host === article || host === document.body) return false;
  if (!REUSABLE_HOST_TAGS.has(host.tagName)) return false;
  if (host.tagName !== 'P') return true;
  return host.textContent.trim() === '' && host.querySelectorAll('img').length === 1;
}

/** Give a markdown image a relative wrapper plus a loading skeleton. */
function decorateMarkdownImage(img, label) {
  const article = img.closest('.markdown-content');
  const host = blockHost(img);

  let wrapper;
  if (canReuseHost(host, article, img)) {
    wrapper = host;
    if (wrapper.classList.contains('image-wrapper')) {
      // The block already has a placeholder: only watch this image.
      watchImage(img, wrapper);
      return;
    }
    wrapper.classList.add('image-wrapper');
  } else {
    // Raw <img> in a post, an inline image inside a text paragraph, or a host
    // whose layout must not be touched (table cells): use our own wrapper.
    wrapper = wrapImage(img);
  }

  wrapper.prepend(createSkeleton(label));
  watchImage(img, wrapper);
}

/** Enhance the post hero cover, whose skeleton is already server-rendered. */
function enhancePostHeaderCover() {
  document.querySelectorAll('.post-header-cover-wrapper img').forEach((img) => {
    const wrapper = img.closest('.post-header-cover-wrapper');
    if (wrapper) watchImage(img, wrapper);
  });
}

/** Enhance every image inside rendered Markdown. */
function enhanceMarkdownImages() {
  const images = document.querySelectorAll('.markdown-content img');
  if (images.length === 0) return;

  // Resolved once: querying per image would be wasteful.
  const label = loadingLabel();
  images.forEach((img) => decorateMarkdownImage(img, label));
}

/** Ask the browser to defer off-screen images that did not opt in already. */
function addLazyLoading() {
  document.body.querySelectorAll('img:not([loading])').forEach((img) => {
    img.setAttribute('loading', 'lazy');
  });
}

/* ==========================================================================
 * About-page easter egg
 * ======================================================================== */

/** Clicks counted so far on the about header/avatar. */
let aboutClickCount = 0;

/** `location.pathname` normalised to trailing-slash form. */
function currentPath() {
  const path = window.location.pathname;
  return path.endsWith('/') ? path : `${path}/`;
}

/**
 * Whether the current page hosts the easter egg.
 *
 * The path alone is not enough: `features.easterEgg` in _config.yml can switch
 * it off, and the server signals that by rendering the about header without
 * `data-easter-egg="true"` — there are no inline scripts (the CSP forbids them),
 * so a data attribute is how server-side configuration reaches the client.
 */
function isEasterEggPage() {
  if (!EASTER_EGG_PATHS.includes(currentPath())) return false;
  return document.querySelector('[data-easter-egg="true"]') !== null;
}

/** Play the avatar pulse animation, restarting it on rapid clicks. */
function pulseAboutAvatar() {
  const avatar = document.getElementById('about-avatar');
  if (!avatar) return;
  avatar.classList.remove('pulse');
  // Force a reflow so re-adding the class restarts the animation.
  void avatar.offsetWidth;
  avatar.classList.add('pulse');
}

/** Wire the click counter (only on the about page). */
function initEasterEgg() {
  const avatar = document.getElementById('about-avatar');
  if (avatar) {
    // Drop the class once the animation ends so the element stays clean.
    avatar.addEventListener('animationend', () => avatar.classList.remove('pulse'));
  }
}

/* ==========================================================================
 * Wiring
 * ======================================================================== */

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  // 1. Declarative actions. Event delegation keeps handlers off the DOM and
  //    works for elements the pages add later.
  const actionElement = target.closest('[data-action]');
  if (actionElement && actionElement.dataset.action === 'toggle-drawer') {
    toggleDrawer();
    return;
  }

  // 2. On narrow screens the drawer overlays the page, so close it as soon as
  //    a sidebar entry is activated. The browser performs the navigation.
  if (isNarrowViewport() && target.closest('#sidebar-list mdui-list-item')) {
    closeDrawer();
  }
});

document.addEventListener('click', (event) => {
  if (!isEasterEggPage()) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  // The avatar lives inside the header, so a single delegated listener counts
  // a click on either element exactly once (two listeners would double-count).
  if (!target.closest('#about-header') && !target.closest('#about-avatar')) return;

  aboutClickCount += 1;
  pulseAboutAvatar();

  if (aboutClickCount >= EASTER_EGG_CLICKS) {
    aboutClickCount = 0;
    window.location.assign(EASTER_EGG_TARGET);
  }
});

/** Run the enhancements; modules are deferred, so the DOM is ready already. */
function init() {
  addLazyLoading();
  enhancePostHeaderCover();
  enhanceMarkdownImages();
  if (isEasterEggPage()) initEasterEgg();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
