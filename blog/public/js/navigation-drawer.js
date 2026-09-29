/**
 * navigation-drawer.js — responsive state for the sidebar drawer.
 *
 * Classic (non-module) script so it runs as soon as the layout has been parsed
 * and the drawer gets its correct state before the first paint. It only owns
 * *state* — open on wide viewports, closed on narrow ones — plus keeping that
 * in sync while the window is resized.
 *
 * Click handling lives in app.js (`data-action="toggle-drawer"` delegation) so
 * there is exactly one place that flips the drawer. This file only binds the
 * button itself when the markup has no `data-action` attribute, which keeps the
 * script useful on its own without ever toggling twice for a single click.
 */
(function () {
  'use strict';

  /** Viewport width (px) at or above which the drawer stays docked open. */
  var WIDE_VIEWPORT = 900;

  var drawer = document.querySelector('.navigation-drawer');
  if (!drawer) {
    return;
  }

  /** Whether the viewport is wide enough to keep the drawer permanently open. */
  function isWideViewport() {
    return window.innerWidth > WIDE_VIEWPORT;
  }

  /**
   * Flip the drawer. Exposed on `window` so app.js reuses this exact function
   * instead of re-implementing the toggle.
   */
  function toggle() {
    drawer.open = !drawer.open;
  }

  /** Snap the drawer to the state that matches the current viewport. */
  function syncToViewport() {
    var shouldBeOpen = isWideViewport();
    if (drawer.open !== shouldBeOpen) {
      drawer.open = shouldBeOpen;
    }
  }

  window.toggleNavigationDrawer = toggle;

  // Without `data-action` nobody else handles the click, so bind it here.
  // With `data-action` present app.js owns it — binding both would toggle the
  // drawer open and immediately closed again.
  var button = document.querySelector('.navigation-drawer-button');
  if (button && !button.hasAttribute('data-action')) {
    button.addEventListener('click', toggle);
  }

  syncToViewport();

  // A ResizeObserver on <body> fires for window resizes *and* for layout
  // changes caused by content, which is what we want for breakpoint sync.
  var resizeObserver = new ResizeObserver(function () {
    syncToViewport();
  });
  resizeObserver.observe(document.body);
})();
