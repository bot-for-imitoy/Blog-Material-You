/**
 * color.js — Material You dynamic colour.
 *
 * mdui 2 derives its whole design-token palette from a single seed colour, so
 * this is all it takes to theme the site. The seed comes from `theme.color` in
 * `_config.yml`, which the layout writes onto <html data-theme-color="…"> —
 * there are no inline scripts (the CSP forbids them), so a data attribute is the
 * way to hand server-side configuration to the client.
 *
 * The vendored bundle is loaded in <head> (before this module), but a blocked or
 * failed vendored script must not throw here, otherwise the remaining modules
 * would never run — hence the guard.
 */

/** Fallback used when the attribute is missing or malformed. */
var FALLBACK_COLOR = '#ff006a';

/** Any CSS colour is accepted; sanity-check the shape before applying it. */
function seedColor() {
  var value = document.documentElement.getAttribute('data-theme-color');
  if (typeof value !== 'string') return FALLBACK_COLOR;
  var trimmed = value.trim();
  if (trimmed === '') return FALLBACK_COLOR;
  // Accept #rgb/#rrggbb/#rrggbbaa, rgb()/hsl()/oklch()/named colours, which all
  // start with a letter, '#', or a digit (for the numeric forms).
  if (!/^(#|rgb|hsl|hwb|lab|lch|oklab|oklch|color\(|[a-z])/i.test(trimmed)) return FALLBACK_COLOR;
  return trimmed;
}

/**
 * Apply the seed colour when the mdui global is available.
 * @returns {boolean} true when the scheme was applied.
 */
function applyColorScheme() {
  if (typeof window.mdui === 'undefined') return false;
  if (typeof window.mdui.setColorScheme !== 'function') return false;
  window.mdui.setColorScheme(seedColor());
  return true;
}

if (!applyColorScheme()) {
  // Modules are deferred, so this normally means the vendored bundle simply
  // had not executed yet; retry once the document is ready.
  window.addEventListener('DOMContentLoaded', applyColorScheme);
}
