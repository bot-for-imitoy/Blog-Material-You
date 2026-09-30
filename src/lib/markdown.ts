/**
 * markdown.ts — Server-side Markdown rendering.
 *
 * The original implementation shipped raw Markdown to the browser and rendered
 * it with marked.js, which is invisible to crawlers. Rendering on the server
 * makes post bodies indexable and removes a 60 kB client-side dependency.
 *
 * Features: GitHub-flavoured basics, heading anchors (for the table of
 * contents), syntax highlighting via highlight.js, KaTeX math, and responsive
 * images (a local `![](/uploads/a.jpg)` becomes a `srcset` of server-side
 * resizes, so the browser downloads one size instead of the original).
 */
import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import katexModule from '@vscode/markdown-it-katex';
import hljs from 'highlight.js';
import { CONTENT_SIZES, isResizableImage, mediaSrcset, mediaUrl } from '../media/resize.ts';

/** `@vscode/markdown-it-katex` is CJS; unwrap the interop layers defensively. */
const katexPlugin = (() => {
  const mod = katexModule as unknown as { default?: unknown };
  const inner = mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod;
  const innerObj = inner as { default?: unknown };
  return (innerObj && typeof innerObj === 'object' && 'default' in innerObj
    ? innerObj.default
    : inner) as (md: MarkdownIt) => void;
})();

export interface TocEntry {
  level: number;
  id: string;
  text: string;
}

export interface RenderedMarkdown {
  html: string;
  toc: TocEntry[];
}

let cached: MarkdownIt | null = null;
let cachedToc: TocEntry[] = [];
let cachedUnsafe: MarkdownIt | null = null;

function build(allowHtml: boolean): MarkdownIt {
  const md = new MarkdownIt({
    html: allowHtml,
    linkify: true,
    breaks: false,
    typographer: false,
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        } catch {
          /* fall through to auto-detection */
        }
      }
      try {
        return hljs.highlightAuto(code).value;
      } catch {
        return '';
      }
    },
  });

  md.use(anchor, {
    level: [1, 2, 3, 4, 5, 6],
    slugify: (s: string) =>
      s
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, '-')
        .slice(0, 80) || 'section',
    permalink: false,
    callback: (token: { tag: string; attrGet: (n: string) => string | null }, info: { title: string }) => {
      const level = Number.parseInt(token.tag.slice(1), 10);
      const id = token.attrGet('id');
      if (id) cachedToc.push({ level, id, text: info.title });
    },
  });

  md.use(katexPlugin);

  // Render KaTeX errors as visible text rather than throwing mid-request.
  md.renderer.rules.katex = ((tokens: unknown[], idx: number, options: unknown, _env: unknown, self: { renderToken: (t: unknown[], i: number, o: unknown) => string }) => {
    try {
      return self.renderToken(tokens, idx, options);
    } catch {
      return '';
    }
  }) as never;

  decorateImages(md);

  return md;
}

/** The slice of markdown-it's image token that `decorateImages` needs. */
interface ImageToken {
  attrGet: (name: string) => string | null;
  attrSet: (name: string, value: string) => void;
}

/** The renderer methods `decorateImages` delegates back to. */
interface ImageRendererSelf {
  renderToken: (tokens: unknown[], idx: number, options: unknown) => string;
}

/** Width of the `src` fallback, used by browsers that ignore `srcset`. */
const FALLBACK_WIDTH = 800;

/**
 * Make local Markdown images responsive.
 *
 * `![](/uploads/a.jpg)` normally renders a single `<img>` pointing at the full
 * resolution file. Here the source is rewritten to a `/media` URL and given a
 * `srcset` covering the article column's widths, so a phone fetches a ~480 px
 * WebP instead of a multi-megabyte original and a desktop gets the 1600 px one.
 * Only the candidate the browser actually picks is ever rendered — the server
 * is lazy about it, which is the whole point.
 *
 * Remote images (`https://…`), `data:` URIs and SVG icons are left exactly as
 * written: they cannot be resized locally, and `mediaUrl` returns them as-is.
 *
 * The original rule is called at the end rather than reimplemented, so the
 * `alt` attribute keeps being produced by markdown-it itself.
 */
function decorateImages(md: MarkdownIt): void {
  const renderImage = md.renderer.rules.image;

  md.renderer.rules.image = ((
    tokens: ImageToken[],
    idx: number,
    options: unknown,
    env: unknown,
    self: ImageRendererSelf,
  ) => {
    const token = tokens[idx];
    if (token) {
      const src = token.attrGet('src') ?? '';
      if (isResizableImage(src)) {
        const srcset = mediaSrcset(src);
        if (srcset) {
          // `sizes` is what lets the browser pick before it has laid anything
          // out; without it every candidate is assumed to be 100vw wide.
          token.attrSet('src', mediaUrl(src, { width: FALLBACK_WIDTH }));
          token.attrSet('srcset', srcset);
          token.attrSet('sizes', CONTENT_SIZES);
        }
      }
      // These are safe defaults for post bodies: images are almost always
      // below the fold, and `decoding` keeps a big decode off the main thread.
      token.attrSet('loading', 'lazy');
      token.attrSet('decoding', 'async');
    }

    return renderImage
      ? renderImage(tokens as never, idx, options as never, env as never, self as never)
      : self.renderToken(tokens, idx, options);
  }) as never;
}

/**
 * Render Markdown to HTML plus a table of contents.
 * `allowHtml` is only enabled for admin-authored content.
 */
export function renderMarkdown(source: unknown, allowHtml = true): RenderedMarkdown {
  const text = source === null || source === undefined ? '' : String(source);
  if (text.trim() === '') return { html: '', toc: [] };

  if (allowHtml) {
    cached ??= build(true);
    cachedToc = [];
    const html = (cached as MarkdownIt).render(text);
    const toc = cachedToc;
    cachedToc = [];
    return { html, toc };
  }

  cachedUnsafe ??= build(false);
  cachedToc = [];
  const html = (cachedUnsafe as MarkdownIt).render(text);
  const toc = cachedToc;
  cachedToc = [];
  return { html, toc };
}

/** Render Markdown and return only the HTML. */
export function mdToHtml(source: unknown, allowHtml = true): string {
  return renderMarkdown(source, allowHtml).html;
}

/** Render Markdown flattened to a single line of plain text (for meta tags). */
export function mdToPlain(source: unknown, maxChars = 200): string {
  const text = source === null || source === undefined ? '' : String(source);
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[\s\S]*?\]\([\s\S]*?\)/g, ' ')
    .replace(/\[([\s\S]*?)\]\([\s\S]*?\)/g, '$1')
    .replace(/[#>*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}
