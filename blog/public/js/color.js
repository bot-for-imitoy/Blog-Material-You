/**
 * color.js — Material You dynamic colour.
 *
 * mdui 2 derives its whole design-token palette from a single seed colour, so
 * this is all it takes to theme the site. The vendored bundle is loaded in
 * <head> (before this module), but a blocked or failed vendored script must not
 * throw here, otherwise the remaining modules would never run — hence the
 * guard.
 */

/** Seed colour of the Material You palette. */
var SEED_COLOR = '#ff006a';

/**
 * Apply the seed colour when the mdui global is available.
 * @returns {boolean} true when the scheme was applied.
 */
function applyColorScheme() {
  if (typeof window.mdui === 'undefined') return false;
  if (typeof window.mdui.setColorScheme !== 'function') return false;
  window.mdui.setColorScheme(SEED_COLOR);
  return true;
}

if (!applyColorScheme()) {
  // Modules are deferred, so this normally means the vendored bundle simply
  // had not executed yet; retry once the document is ready.
  window.addEventListener('DOMContentLoaded', applyColorScheme);
}
