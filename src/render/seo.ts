/**
 * seo.ts — Per-route <title> / meta description / canonical path.
 *
 * Ported from the original `seo.lua`, with two fixes:
 *  - descriptions are truncated on code-point boundaries (the Lua version cut
 *    at 200 *bytes* and could split a CJK character in half);
 *  - the English variant is used for posts when present, and the description
 *    always comes from the matching language variant.
 */
import { getSiteSettings } from '../site-config.ts';
import { stripMarkdown } from '../lib/text.ts';
import { getPost } from '../content/posts.ts';
import { getPage } from '../content/pages.ts';
import type { PageSeo } from './engine.ts';
import { buildSeo } from './engine.ts';

const DESC_LIMIT = 200;

function site(): { title: string; desc: string } {
  const settings = getSiteSettings();
  return { title: settings.title || 'Blog', desc: settings.desc || '' };
}

/** SEO metadata for a public route path (canonical form, e.g. `/posts/`). */
export function seoForRoute(route: string): PageSeo {
  const { title: siteTitle, desc: siteDesc } = site();
  const path = route || '/';

  // Single post: /post/<slug>
  const postMatch = path.match(/^\/post\/([^/]+)/);
  if (postMatch?.[1]) {
    const slug = decodeURIComponent(postMatch[1]);
    const post = getPost(slug);
    if (post) {
      const useEn = post.titleEn !== '';
      const title = useEn ? post.titleEn : post.title;
      const source = useEn && post.contentEn !== '' ? post.contentEn : post.content;
      return buildSeo({
        title: `${title} - ${siteTitle}`,
        desc: stripMarkdown(source, DESC_LIMIT),
        canonical: path,
      });
    }
    return buildSeo({ title: `404 - ${siteTitle}`, desc: '页面未找到', canonical: path });
  }

  // Static pages
  const pages = getPage(path.replace(/^\/+|\/+$/g, ''));
  const staticRoutes: Record<string, { title: string; desc: string }> = {
    '/posts/': { title: `文章 - ${siteTitle}`, desc: '博客所有文章' },
    '/tags/': { title: `标签 - ${siteTitle}`, desc: '博客所有标签' },
    '/categories/': { title: `分类 - ${siteTitle}`, desc: '博客所有分类' },
    '/archives/': { title: `归档 - ${siteTitle}`, desc: '所有已归档文章' },
    '/friends/': { title: `友链 - ${siteTitle}`, desc: '友情链接' },
    '/about/': { title: `关于 - ${siteTitle}`, desc: siteDesc },
    '/talks/': { title: `动态 - ${siteTitle}`, desc: '动态' },
    '/status/': { title: `状态 - ${siteTitle}`, desc: '系统状态与设备信息' },
    '/auth/': { title: `身份验证 - ${siteTitle}`, desc: '访客认证' },
    '/2048/': { title: `2048 - ${siteTitle}`, desc: '2048 小游戏' },
    '/': { title: siteTitle, desc: siteDesc },
  };

  const normalised = path.endsWith('/') || path === '/' ? path : `${path}/`;
  const exact = staticRoutes[normalised] ?? staticRoutes[path];
  if (exact) return buildSeo({ ...exact, canonical: normalised === '/' ? '/' : normalised });

  // Tag / category listings
  const tagMatch = path.match(/^\/tags\/(.+?)\/?$/);
  if (tagMatch?.[1]) {
    const tag = decodeURIComponent(tagMatch[1]);
    return buildSeo({
      title: `${tag} - ${siteTitle}`,
      desc: `「${tag}」标签下的文章`,
      canonical: `/tags/${encodeURIComponent(tag)}/`,
    });
  }
  const catMatch = path.match(/^\/categories\/(.+?)\/?$/);
  if (catMatch?.[1]) {
    const category = decodeURIComponent(catMatch[1]);
    return buildSeo({
      title: `${category} - ${siteTitle}`,
      desc: `「${category}」分类下的文章`,
      canonical: `/categories/${encodeURIComponent(category)}/`,
    });
  }

  // Arbitrary page: /pages/<slug>/ or a bare /<slug>/
  if (pages) {
    const useEn = pages.titleEn !== '';
    return buildSeo({
      title: `${useEn ? pages.titleEn : pages.title} - ${siteTitle}`,
      desc: stripMarkdown(pages.content, DESC_LIMIT) || siteDesc,
      canonical: path,
    });
  }

  return buildSeo({ title: `404 - ${siteTitle}`, desc: '页面未找到', canonical: path });
}

/** SEO for the 404 view. */
export function seoForNotFound(route = '/'): PageSeo {
  const { title } = site();
  return buildSeo({ title: `404 - ${title}`, desc: '你访问的页面不存在。', canonical: route });
}
