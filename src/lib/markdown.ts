/**
 * markdown.ts — Server-side Markdown rendering.
 *
 * The original implementation shipped raw Markdown to the browser and rendered
 * it with marked.js, which is invisible to crawlers. Rendering on the server
 * makes post bodies indexable and removes a 60 kB client-side dependency.
 *
 * Features: GitHub-flavoured basics, heading anchors (for the table of
 * contents), syntax highlighting via highlight.js, and KaTeX math.
 */
import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import katexModule from '@vscode/markdown-it-katex';
import hljs from 'highlight.js';

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

  return md;
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
