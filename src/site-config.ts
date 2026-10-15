/**
 * site-config.ts — the single site configuration file.
 *
 * Like Hexo's `_config.yml`, everything a site owner is expected to change lives
 * in **one tracked YAML file at the repository root**: `_config.yml`.
 * Site identity, appearance, the navigation menu, feature toggles, list
 * lengths and any UI-string overrides all come from there. The TypeScript in
 * this module only supplies the *defaults* used when a key is absent, so a
 * partial (or even missing) config file still boots.
 *
 * What deliberately does NOT live here:
 *   - secrets and deployment specifics (port, bind address, session secret,
 *     admin bootstrap, S3 credentials). Those stay environment variables
 *     (`.env` / `BMY_*`), because they differ per deployment and must never be
 *     committed. See `.env.example`.
 *
 * The file is read with an mtime cache, so editing `_config.yml` takes effect
 * on the next request without restarting the server.
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { buildColorScheme, type ColorScheme } from './lib/color-scheme.ts';
import { CONFIG_MASTER_FILE, ROOT, SITE_URL } from './paths.ts';

/** One sidebar / navigation entry. */
export interface MenuItem {
  text: string;
  icon: string;
  route: string;
  /** Optional UI-string KEY used as the page title for this route. */
  pageTitle?: string;
  /** Optional UI-string KEY used as the page description for this route. */
  pageDesc?: string;
}

export interface SiteFeatures {
  /** Show the comment form and load the comment client on post pages. */
  comments: boolean;
  /** Expose the permission-gated visitor calendar on the status page. */
  calendar: boolean;
  /** Show the app-bar search button and serve `/search/`. */
  search: boolean;
  /** Enable the 2048 easter egg on the about page. */
  easterEgg: boolean;
  /** Serve `/rss.xml`. */
  rss: boolean;
  /** Serve `/sitemap.xml`. */
  sitemap: boolean;
}

/** One entry inside an expanded profile panel. */
export interface ProfileSubItem {
  text: string;
  href: string;
}

/**
 * A bar in the profile card's right-hand column.
 * `action: 'link'` shows a right chevron and navigates; `action: 'expand'`
 * shows a down chevron and opens a panel (extra links, or the music player).
 */
export interface ProfileButton {
  text: string;
  /** Icon key understood by the template: github | blog | more | music | link | mail | rss. */
  icon: string;
  href: string;
  action: 'link' | 'expand';
  items: ProfileSubItem[];
  /** True for the single panel that hosts the music player. */
  music: boolean;
}

export interface ProfileMusic {
  title: string;
  artist: string;
  cover: string;
  /** Direct audio URL, played by a native <audio> element. */
  audio: string;
  /** Embed URL (e.g. NetEase's outchain player); rendered in an <iframe>. */
  embed: string;
}

export interface ProfileSettings {
  enabled: boolean;
  /**
   * Accent colour for the card. Empty string follows the site `theme.color`, so
   * changing the theme colour also re-themes this page.
   */
  accent: string;
  avatar: string;
  greeting: string;
  name: string;
  tagline: string;
  /** Optional background photo. Blurred by CSS; empty uses the built-in night scene. */
  background: string;
  /** Rows of pill badges. */
  tags: string[][];
  buttons: ProfileButton[];
  music: ProfileMusic;
}

export interface SiteSettings {
  // ===== Identity =====
  title: string;
  /** Short tagline shown under the site name in the sidebar. */
  subtitle: string;
  /** Longer description used for the meta description / Open Graph. */
  description: string;
  keywords: string[];
  author: string;
  /** BCP-47 language tag, written into <html lang="…">. */
  language: string;
  /** Canonical base URL (used by canonical tags, sitemap and RSS). */
  url: string;

  // ===== Appearance =====
  avatar: string;
  copyright: string;
  github: string;
  /** Seed colour for mdui's dynamic Material You colour scheme. */
  themeColor: string;

  // ===== Content =====
  menu: MenuItem[];
  features: SiteFeatures;
  excerpt: { length: number; lengthWithCover: number };
  /** Number of posts in the RSS feed. */
  rssLimit: number;

  // ===== Standalone personal card (/profile/) =====
  profile: ProfileSettings;

  // ===== UI strings =====
  /** Overrides merged over the built-in dictionary in `DEFAULT_STRINGS`. */
  strings: Record<string, string>;
}

/**
 * Built-in UI strings. `_config.yml` can override any of them under `strings:`,
 * which keeps the defaults complete (no template ever renders a missing key)
 * while letting a site re-word anything without touching code.
 */
export const DEFAULT_STRINGS: Record<string, string> = {
  title: 'Blog Material You',
  desc: '暂无简介',
  avatar: '/img/avatar.svg',
  copyright: '© 2025 Blog Material You',

  loading: '加载中...',
  load_failed: '加载失败',
  network_error: '网络错误，请检查网络连接',
  back: '返回',
  submit: '提交',
  reply: '回复',
  save: '保存',
  cancel: '取消',
  delete: '删除',
  edit: '编辑',

  nav_home: '首页',
  nav_posts: '文章',
  nav_tags: '标签',
  nav_categories: '分类',
  nav_moments: '动态',
  nav_about: '关于',
  nav_archives: '归档',
  nav_friends: '友链',

  page_posts: '文章',
  page_posts_desc: '博客全部文章',
  page_tags: '标签',
  page_tags_desc: '博客全部标签',
  page_categories: '分类',
  page_categories_desc: '博客全部分类',
  page_moments: '动态',
  page_moments_desc: '最新动态',
  page_archives: '归档',
  page_archives_desc: '全部归档文章',
  page_friends: '友链',
  page_friends_desc: '我的朋友们',
  page_status: '状态',
  page_status_desc: '服务状态',
  page_auth: '身份验证',
  authDesc: '使用邮箱验证身份，解锁更多功能。',

  no_posts: '暂无文章',
  no_comments: '暂无评论',
  no_talks: '暂无动态',
  no_friends: '暂无友链',
  forward: '阅读全文',
  postsYear: '',
  write_comment: '写评论',
  commentTitle: '评论',

  nickName: '昵称',
  email: '邮箱',
  website: '网站（可选）',
  commentContent: '评论内容',
  commentSuccess: '评论提交成功',
  commentFail: '评论提交失败',
  networkError: '网络错误，请检查网络连接',

  // The comment form's privacy switch. `commentPrivacyNotice` has to stay
  // accurate about what is actually collected: see `submitComment()` in
  // js/comments.js (it drops the User-Agent) and README.md ("Comment privacy").
  commentPrivacyToggle: '不展示我的信息',
  commentPrivacyNotice:
    '提交时会根据你填写的信息记录昵称、邮箱、网址，以及浏览器标识等浏览信息，仅用于统计和展示评论，不会用于其它用途。我们尊重你的隐私：开启上方开关后，将不再收集浏览器标识等浏览信息。',

  status: '状态',
  statusDesc: '服务状态',
  cpr: '© 2025 Blog Material You',
  server_online: '在线',
  server_offline: '离线',

  tag_posts_desc: '标签为',
  cat_posts_desc: '分类为',

  page_404_title: '404 — 页面未找到',
  page_404_desc: '你访问的页面不存在。',

  // Search
  search_title: '搜索',
  search_desc: '在全部文章中查找',
  search_placeholder: '输入关键词…',
  search_button: '搜索',
  search_hint: '支持标题、标签、分类与正文；多个关键词用空格分隔。',
  search_empty: '请输入关键词开始搜索。',
  search_no_results: '没有找到匹配的文章。',
  search_results_for: '找到 {n} 篇与「{q}」相关的文章',
  search_archived: '已归档',
  search_clear: '清空',

  admin_title: '博客后台',
  admin_login_title: '博客后台登录',
  admin_login_btn: '登录',
  admin_login_error: '用户名或密码错误',
  admin_logout: '退出登录',
  admin_dashboard: '控制台',
  admin_posts: '文章',
  admin_comments: '评论',
  admin_talks: '动态',
  admin_friends: '友链',
  admin_pages: '页面',
  admin_security: '安全',
  admin_imghost: '图床',
  admin_backup: '数据备份',
  admin_new_post: '新建文章',
  admin_new_talk: '发布动态',
  admin_new_friend: '添加友链',
  admin_new_page: '新建页面',
  admin_edit_post: '编辑文章',
  admin_edit_page: '编辑页面',
  admin_save: '保存',
  admin_delete: '删除',
  admin_archive: '归档',
  admin_unarchive: '取消归档',
  admin_archived: '已归档',
  admin_recent_posts: '最近文章',
  admin_no_posts: '暂无文章，点击“新建文章”开始吧',
  admin_no_comments: '暂无评论',
  admin_no_talks: '暂无动态',
  admin_no_friends: '暂无友链',
  admin_no_pages: '暂无页面',
  admin_comment_title_placeholder: '「」的评论',
  admin_page_editor_title: '编辑页面',
  admin_friend_editor_title: '编辑友链',
  admin_setup_title: '初始化设置',
  admin_setup_desc: '创建管理员账号',
  admin_setup_btn: '创建管理员',
  admin_totp_enabled: '已启用',
  admin_totp_disabled: '未启用',
  admin_totp_enable: '启用两步验证',
  admin_totp_disable: '关闭两步验证',
  admin_totp_verify: '验证并启用',
  admin_totp_regenerate: '重新生成',
  admin_totp_cancel: '取消',
  admin_totp_secret_label: '密钥',
  admin_totp_code_label: '验证码',
  admin_totp_code_placeholder: '输入 6 位验证码',
  admin_totp_status: '状态',
  admin_totp_save_warning: '关闭前请保存密钥，否则将无法登录！',
  admin_totp_verify_help: '使用 Google Authenticator、Authy、1Password 等应用扫描二维码，然后输入 6 位验证码。',
  admin_totp_disabled_help: '启用后，登录需要密码 + 验证器应用中的 6 位验证码。',
  admin_change_password: '修改密码',
  admin_current_password: '当前密码',
  admin_new_username: '新用户名（可选）',
  admin_new_password: '新密码',
  admin_confirm_password: '确认密码',
  admin_save_changes: '保存修改',
  admin_post_count: '文章',
  admin_comment_count: '评论',
  admin_tag_count: '标签',

  editor_slug: '标识（Slug）',
  editor_title: '标题',
  editor_date: '日期',
  editor_cover: '封面 URL',
  editor_tags: '标签（逗号分隔）',
  editor_cats: '分类（逗号分隔）',
  editor_content: '内容',
  editor_english: '英文',

  friend_name: '名称',
  friend_url: '链接',
  friend_descr: '描述',
  friend_avatar: '头像',
  friend_sort: '排序',

  totp_title: '两步验证',
  totp_manual_secret: '手动输入密钥',
  totp_copy_secret: '复制',
  totp_copied: '已复制',

  game_score: '得分',
  game_best: '最高分',
  game_new_game: '新游戏',

  admin_permissions: '权限：',
  admin_permissions_none: '无',

  status_uptime: '运行时长',
  status_memory: '内存占用',
  status_node: 'Node.js 版本',
  status_posts: '文章数',
  status_comments: '评论数',
  status_talks: '动态数',
  status_friends: '友链数',
  status_registered: '已注册用户',
  status_disk: '内容目录',

  auth_check: '验证',
  auth_email_label: '邮箱地址',
  auth_email_placeholder: 'you@example.com',
  auth_registered: '已通过验证',
  auth_not_registered: '该邮箱尚未注册，可提交申请等待管理员审核',
  auth_register_submitted: '注册请求已提交，请等待管理员审核',
  auth_logout: '退出验证',
  auth_invalid_email: '邮箱格式不正确',
  auth_required: '请先完成邮箱验证',
  auth_no_permission: '无权限查看该内容',
  auth_permissions: '当前权限',
};

/** Default sidebar / navigation menu, mirroring the original site. */
export const DEFAULT_MENU: MenuItem[] = [
  { text: '首页', icon: '/icon/home.svg', route: '/' },
  { text: '文章', pageTitle: 'page_posts', pageDesc: 'page_posts_desc', icon: '/icon/article.svg', route: '/posts/' },
  { text: '标签', pageTitle: 'page_tags', pageDesc: 'page_tags_desc', icon: '/icon/tag.svg', route: '/tags/' },
  { text: '分类', pageTitle: 'page_categories', pageDesc: 'page_categories_desc', icon: '/icon/category.svg', route: '/categories/' },
  { text: '动态', pageTitle: 'page_moments', pageDesc: 'page_moments_desc', icon: '/icon/chat.svg', route: '/talks/' },
  { text: '关于', icon: '/icon/person.svg', route: '/about/' },
  { text: '归档', pageTitle: 'page_archives', pageDesc: 'page_archives_desc', icon: '/icon/archive.svg', route: '/archives/' },
  { text: '友链', pageTitle: 'page_friends', pageDesc: 'page_friends_desc', icon: '/icon/friends.svg', route: '/friends/' },
];

/** The one configuration file. Overridable with BMY_CONFIG_FILE. */
export const CONFIG_FILE = process.env.BMY_CONFIG_FILE
  ? path.resolve(process.env.BMY_CONFIG_FILE)
  : path.join(ROOT, '_config.yml');

/**
 * Default content for the standalone personal card at `/profile/`.
 * These mirror exactly what the site owner asked for, so the page looks right
 * with an empty `_config.yml` and is then editable key by key.
 */
export const DEFAULT_PROFILE: ProfileSettings = {
  enabled: true,
  accent: '',
  avatar: DEFAULT_STRINGS.avatar!,
  greeting: 'Hi, I am',
  name: 'Your Name',
  tagline: '这里是我的名片与导航',
  background: '',
  tags: [
    ['摄影', '旅行', '美食'],
    ['编程', '游戏'],
  ],
  buttons: [
    { text: 'Github', icon: 'github', href: 'https://github.com/yourname', action: 'link', items: [], music: false },
    { text: 'Blog', icon: 'blog', href: '/posts/', action: 'link', items: [], music: false },
    {
      text: 'More',
      icon: 'more',
      href: '',
      action: 'expand',
      items: [
        { text: '归档', href: '/archives/' },
        { text: '标签', href: '/tags/' },
        { text: '友链', href: '/friends/' },
        { text: 'RSS', href: '/rss.xml' },
      ],
      music: false,
    },
    { text: 'Music (From NetEase)', icon: 'music', href: '', action: 'expand', items: [], music: true },
  ],
  music: { title: '', artist: '', cover: '', audio: '', embed: '' },
};

function defaultSettings(): SiteSettings {
  return {
    title: DEFAULT_STRINGS.title!,
    subtitle: DEFAULT_STRINGS.desc!,
    description: '暂无简介',
    keywords: [],
    author: '',
    language: 'zh-CN',
    url: SITE_URL,
    avatar: DEFAULT_STRINGS.avatar!,
    copyright: DEFAULT_STRINGS.copyright!,
    github: 'https://github.com/yourname/blog',
    themeColor: '#ff006a',
    menu: DEFAULT_MENU,
    features: { comments: true, calendar: true, search: true, easterEgg: true, rss: true, sitemap: true },
    excerpt: { length: 200, lengthWithCover: 120 },
    rssLimit: 20,
    profile: DEFAULT_PROFILE,
    strings: {},
  };
}

// ===================== loading =====================

interface ConfigCache {
  mtimeMs: number;
  raw: Record<string, unknown>;
}

let cache: ConfigCache | null = null;

let configCopyDone = false;

/**
 * Copy the master config over the working copy when the master is newer.
 *
 * `config.yml` is the tracked, human-edited source of truth; `_config.yml` is
 * the runtime working copy that the admin console writes to. Before the first
 * read, a newer (or first-time) master is copied over the working copy — so
 * committing a new `config.yml` and restarting updates the site — while later
 * admin edits to `_config.yml` survive restarts (the working copy then has the
 * newer mtime). Set `BMY_CONFIG_MASTER` to relocate the master file, or delete
 * it to manage `_config.yml` directly as before.
 */
export function ensureConfigWorkingCopy(): void {
  if (configCopyDone) return;
  configCopyDone = true;
  try {
    if (!fs.existsSync(CONFIG_MASTER_FILE)) return;
    const masterMtime = fs.statSync(CONFIG_MASTER_FILE).mtimeMs;
    let workingMtime = -1;
    try {
      workingMtime = fs.statSync(CONFIG_FILE).mtimeMs;
    } catch {
      /* missing working copy — copy below */
    }
    if (workingMtime >= masterMtime) return;
    fs.copyFileSync(CONFIG_MASTER_FILE, CONFIG_FILE);
    console.log(`[config] ${path.basename(CONFIG_MASTER_FILE)} is newer — copied to ${path.basename(CONFIG_FILE)}`);
  } catch (err) {
    // A failed copy must never prevent boot: the existing working copy (or the
    // built-in defaults) still applies.
    console.warn('[config] could not sync the master config:', (err as Error).message);
  }
}

/**
 * Read `_config.yml`. A missing file is not an error — the built-in defaults
 * take over, which keeps `npm start` working on a bare checkout.
 */
function readConfigFile(): Record<string, unknown> {
  ensureConfigWorkingCopy();

  let stat: fs.Stats;
  try {
    stat = fs.statSync(CONFIG_FILE);
  } catch {
    cache = null;
    return {};
  }

  if (cache && cache.mtimeMs === stat.mtimeMs) return cache.raw;

  try {
    const parsed = yaml.load(fs.readFileSync(CONFIG_FILE, 'utf8'), { filename: CONFIG_FILE });
    const raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
    cache = { mtimeMs: stat.mtimeMs, raw };
    return raw;
  } catch (err) {
    // A broken config must be loud but must not take the site down: fall back
    // to defaults so the operator can still reach the admin and fix the file.
    // The failure is cached against the file's mtime so a broken file logs once
    // per edit instead of once per request.
    console.error(`[config] failed to parse ${CONFIG_FILE}: ${(err as Error).message}`);
    console.error('[config] falling back to built-in defaults until the file changes');
    cache = { mtimeMs: stat.mtimeMs, raw: {} };
    return {};
  }
}

/** Coerce a YAML scalar to a trimmed string. */
function text(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.toLowerCase();
    if (['true', 'yes', 'on', '1'].includes(lowered)) return true;
    if (['false', 'no', 'off', '0'].includes(lowered)) return false;
  }
  return fallback;
}

function wholeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => text(v, '')).filter((v) => v !== '');
  if (typeof value === 'string' && value.trim() !== '') {
    return value.split(',').map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

/** Normalise one menu entry; invalid entries are dropped rather than throwing. */
function toMenuItem(raw: unknown): MenuItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const route = text(entry.route, '');
  const label = text(entry.text, '');
  if (route === '' || label === '') return null;
  const item: MenuItem = {
    text: label,
    icon: text(entry.icon, '/icon/article.svg'),
    route,
  };
  const pageTitle = text(entry.pageTitle ?? entry.page_title, '');
  if (pageTitle) item.pageTitle = pageTitle;
  const pageDesc = text(entry.pageDesc ?? entry.page_desc, '');
  if (pageDesc) item.pageDesc = pageDesc;
  return item;
}

function toMenu(value: unknown, fallback: MenuItem[]): MenuItem[] {
  if (!Array.isArray(value)) return fallback;
  const items = value.map(toMenuItem).filter((item): item is MenuItem => item !== null);
  return items.length > 0 ? items : fallback;
}

/** Normalise one profile bar; entries without a label are dropped. */
function toProfileButton(raw: unknown): ProfileButton | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const label = text(entry.text, '');
  if (label === '') return null;

  const action: 'link' | 'expand' =
    text(entry.action, 'link').toLowerCase() === 'expand' ? 'expand' : 'link';

  const items: ProfileSubItem[] = Array.isArray(entry.items)
    ? entry.items
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const sub = item as Record<string, unknown>;
          const subText = text(sub.text, '');
          const subHref = text(sub.href, '');
          return subText !== '' ? { text: subText, href: subHref } : null;
        })
        .filter((item): item is ProfileSubItem => item !== null)
    : [];

  return {
    text: label,
    icon: text(entry.icon, 'link').toLowerCase(),
    href: text(entry.href, ''),
    action,
    items,
    music: bool(entry.music, false),
  };
}

/** Rows of pill badges; a flat list is wrapped into a single row. */
function toTagRows(value: unknown, fallback: string[][]): string[][] {
  if (!Array.isArray(value)) return fallback;
  const rows: string[][] = [];
  for (const row of value) {
    if (Array.isArray(row)) {
      const items = row.map((item) => text(item, '')).filter((item) => item !== '');
      if (items.length > 0) rows.push(items);
    } else {
      // A flat `tags: [a, b]` list is treated as one row.
      const single = text(row, '');
      if (single !== '') rows.push([single]);
    }
  }
  return rows.length > 0 ? rows : fallback;
}

function normaliseProfile(raw: Record<string, unknown>, base: ProfileSettings): ProfileSettings {
  const musicRaw = (raw.music && typeof raw.music === 'object' ? raw.music : {}) as Record<string, unknown>;
  const buttons = Array.isArray(raw.buttons)
    ? raw.buttons.map(toProfileButton).filter((button): button is ProfileButton => button !== null)
    : [];
  return {
    enabled: bool(raw.enabled, base.enabled),
    accent: text(raw.accent, base.accent),
    avatar: text(raw.avatar, base.avatar),
    greeting: text(raw.greeting, base.greeting),
    name: text(raw.name, base.name),
    tagline: text(raw.tagline, base.tagline),
    background: text(raw.background, base.background),
    tags: toTagRows(raw.tags, base.tags),
    buttons: buttons.length > 0 ? buttons : base.buttons,
    music: {
      title: text(musicRaw.title, base.music.title),
      artist: text(musicRaw.artist, base.music.artist),
      cover: text(musicRaw.cover, base.music.cover),
      audio: text(musicRaw.audio, base.music.audio),
      embed: text(musicRaw.embed, base.music.embed),
    },
  };
}

/** Merge the YAML file over the defaults. */
function normalise(raw: Record<string, unknown>): SiteSettings {
  const base = defaultSettings();

  const theme = (raw.theme && typeof raw.theme === 'object' ? raw.theme : {}) as Record<string, unknown>;
  const features = (raw.features && typeof raw.features === 'object' ? raw.features : {}) as Record<string, unknown>;
  const excerpt = (raw.excerpt && typeof raw.excerpt === 'object' ? raw.excerpt : {}) as Record<string, unknown>;
  const strings = (raw.strings && typeof raw.strings === 'object' ? raw.strings : {}) as Record<string, unknown>;
  const profile = (raw.profile && typeof raw.profile === 'object' ? raw.profile : {}) as Record<string, unknown>;

  const subtitle = text(raw.subtitle ?? raw.desc, base.subtitle);
  return {
    title: text(raw.title, base.title),
    subtitle,
    // Fall back to the subtitle so a site that only sets one of them still gets
    // a sensible meta description.
    description: text(raw.description, subtitle),
    keywords: stringList(raw.keywords),
    author: text(raw.author, base.author),
    language: text(raw.language, base.language),
    // The canonical URL is the one setting that a deployment may need to
    // override without editing a tracked file (e.g. a container behind a
    // different hostname), so an explicitly set BMY_SITE_URL wins over the
    // YAML value. Everything else is file-first.
    url: SITE_URL !== '' ? SITE_URL : text(raw.url, base.url),
    avatar: text(raw.avatar, base.avatar),
    copyright: text(raw.copyright, base.copyright),
    github: text(raw.github, base.github),
    themeColor: text(theme.color ?? raw.themeColor, base.themeColor),
    menu: toMenu(raw.menu, base.menu),
    features: {
      comments: bool(features.comments, base.features.comments),
      calendar: bool(features.calendar, base.features.calendar),
      search: bool(features.search, base.features.search),
      easterEgg: bool(features.easterEgg ?? features.easter_egg, base.features.easterEgg),
      rss: bool(features.rss, base.features.rss),
      sitemap: bool(features.sitemap, base.features.sitemap),
    },
    excerpt: {
      length: wholeNumber(excerpt.length, base.excerpt.length, 1, 5000),
      lengthWithCover: wholeNumber(excerpt.lengthWithCover, base.excerpt.lengthWithCover, 1, 5000),
    },
    rssLimit: wholeNumber(raw.rssLimit, base.rssLimit, 1, 200),
    profile: normaliseProfile(profile, base.profile),
    // Only string values are accepted, so a stray nested object cannot leak into
    // a template as "[object Object]".
    strings: Object.fromEntries(
      Object.entries(strings)
        .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
        .map(([key, value]) => [key, String(value)]),
    ),
  };
}

/** Current site settings (cached per `_config.yml` mtime). */
export function getSiteSettings(): SiteSettings {
  return normalise(readConfigFile());
}

/** Drop the config cache (used after an external write, and by tests). */
export function invalidateConfig(): void {
  cache = null;
}

/**
 * Resolve a UI string key: `_config.yml` overrides win over the built-in
 * dictionary, and an unknown key returns itself so a typo is visible rather
 * than blank.
 */
export function t(key: string): string {
  const settings = getSiteSettings();
  return settings.strings[key] ?? DEFAULT_STRINGS[key] ?? key;
}

/** Everything the templates need, assembled once per render. */
export interface TemplateGlobals {
  site: {
    title: string;
    subtitle: string;
    description: string;
    keywords: string[];
    author: string;
    language: string;
    url: string;
    avatar: string;
    copyright: string;
    github: string;
    themeColor: string;
  };
  menu: MenuItem[];
  features: SiteFeatures;
  /** Content for the standalone personal card at `/profile/`. */
  profile: ProfileSettings;
  /**
   * Material You palette generated from `theme.color`, plus the class that
   * applies it. Rendered server-side so pages are correctly themed on first
   * paint and without JavaScript.
   */
  colorScheme: ColorScheme;
  t: (key: string) => string;
  strings: Record<string, string>;
}

export function templateGlobals(): TemplateGlobals {
  const settings = getSiteSettings();
  return {
    site: {
      title: settings.title,
      subtitle: settings.subtitle,
      description: settings.description,
      keywords: settings.keywords,
      author: settings.author,
      language: settings.language,
      url: settings.url,
      avatar: settings.avatar,
      copyright: settings.copyright,
      github: settings.github,
      themeColor: settings.themeColor,
    },
    menu: settings.menu,
    features: settings.features,
    profile: settings.profile,
    colorScheme: buildColorScheme(settings.themeColor),
    t,
    strings: { ...DEFAULT_STRINGS, ...settings.strings },
  };
}

/**
 * Public representation for `/api/site`.
 * Deliberately contains no credential material (the original `/api/config`
 * leaked `session_secret`, `admin_user` and `admin_pass`).
 */
export function publicSiteConfig(): Record<string, unknown> {
  const settings = getSiteSettings();
  return {
    title: settings.title,
    subtitle: settings.subtitle,
    description: settings.description,
    keywords: settings.keywords,
    author: settings.author,
    language: settings.language,
    url: settings.url,
    avatar: settings.avatar,
    copyright: settings.copyright,
    github: settings.github,
    themeColor: settings.themeColor,
    menu: settings.menu,
    features: settings.features,
    excerpt: settings.excerpt,
    rssLimit: settings.rssLimit,
    profile: settings.profile,
    strings: { ...DEFAULT_STRINGS, ...settings.strings },
  };
}
