#!/usr/bin/env node
/**
 * sync-assets.mjs — Vendor the front-end libraries from node_modules into the
 * static tree so the site never depends on a public CDN at runtime.
 *
 * Run with `npm run assets` (also invoked automatically on server start when a
 * vendored file is missing).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const blogDir = path.resolve(process.env.BMY_BLOG_DIR || path.join(root, 'blog'));
const publicDir = path.resolve(process.env.BMY_PUBLIC_DIR || path.join(blogDir, 'public'));
const modules = path.join(root, 'node_modules');

/** @type {Array<[string, string]>} [source relative to node_modules, destination relative to public] */
const files = [
  ['mdui/mdui.css', 'vendor/mdui/mdui.css'],
  ['mdui/mdui.global.js', 'vendor/mdui/mdui.global.js'],
  ['mdui/mdui.esm.js', 'vendor/mdui/mdui.esm.js'],
  ['katex/dist/katex.min.css', 'vendor/katex/katex.min.css'],
  ['katex/dist/contrib/auto-render.min.js', 'vendor/katex/auto-render.min.js'],
  ['highlight.js/styles/github.min.css', 'vendor/highlight/github.min.css'],
  ['highlight.js/styles/github-dark.min.css', 'vendor/highlight/github-dark.min.css'],
];

/** Directories copied recursively. */
const dirs = [['katex/dist/fonts', 'vendor/katex/fonts']];

let copied = 0;
for (const [from, to] of files) {
  const src = path.join(modules, from);
  const dest = path.join(publicDir, to);
  if (!fs.existsSync(src)) {
    console.warn(`[assets] missing: node_modules/${from}`);
    continue;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  copied += 1;
}

for (const [from, to] of dirs) {
  const src = path.join(modules, from);
  const dest = path.join(publicDir, to);
  if (!fs.existsSync(src)) continue;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, entry), path.join(dest, entry));
    copied += 1;
  }
}

console.log(`[assets] synced ${copied} file(s) into ${path.relative(root, publicDir)}/vendor`);

export { files, dirs, publicDir, modules };
