/**
 * site-config.ts — Site configuration and the complete UI string dictionary.
 *
 * These values used to be hard-coded in `backend/lua/config.lua`. They are
 * still the defaults, but every one of them can now be overridden from
 * `blog/data/site.json` so the site can be re-branded without editing code.
 *
 * The public `/api/site` endpoint deliberately omits the session secret and any
 * credential material (the old `/api/config` leaked all three).
 */
import { DATA_DIR, SITE_URL } from './paths.ts';
import { JsonStore } from './store/json-store.ts';
import path from 'node:path';

export interface MenuItem {
  text: string;
  icon: string;
  route: string;
  pageTitle?: string;
  pageDesc?: string;
}

/** UI strings, keyed exactly as the templates reference them. */
export const STRINGS: Record<string, string> = {
  title: "imitoy's Blog",
  desc: '暂无简介',
  avatar: '/img/avatar.jpg',
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

/** Sidebar / navigation menu (also drives the admin shell). */
export const MENU: MenuItem[] = [
  { text: '首页', icon: '/icon/home.svg', route: '/' },
  { text: '文章', pageTitle: 'page_posts', pageDesc: 'page_posts_desc', icon: '/icon/article.svg', route: '/posts/' },
  { text: '标签', pageTitle: 'page_tags', pageDesc: 'page_tags_desc', icon: '/icon/tag.svg', route: '/tags/' },
  { text: '分类', pageTitle: 'page_categories', pageDesc: 'page_categories_desc', icon: '/icon/category.svg', route: '/categories/' },
  { text: '动态', pageTitle: 'page_moments', pageDesc: 'page_moments_desc', icon: '/icon/chat.svg', route: '/talks/' },
  { text: '关于', icon: '/icon/person.svg', route: '/about/' },
  { text: '归档', pageTitle: 'page_archives', pageDesc: 'page_archives_desc', icon: '/icon/archive.svg', route: '/archives/' },
  { text: '友链', pageTitle: 'page_friends', pageDesc: 'page_friends_desc', icon: '/icon/friends.svg', route: '/friends/' },
];

export interface SiteSettings {
  title: string;
  desc: string;
  avatar: string;
  copyright: string;
  github: string;
  /** Canonical base URL, used by sitemap/RSS/canonical tags. */
  url: string;
  /** Per-post comments enabled. */
  commentsEnabled: boolean;
  /** Whether the visitor calendar feature is exposed. */
  calendarEnabled: boolean;
  strings: Record<string, string>;
}

function defaults(): SiteSettings {
  return {
    title: STRINGS.title!,
    desc: STRINGS.desc!,
    avatar: STRINGS.avatar!,
    copyright: STRINGS.copyright!,
    github: 'https://github.com/imitoy/Blog',
    url: SITE_URL,
    commentsEnabled: true,
    calendarEnabled: true,
    strings: {},
  };
}

const store = new JsonStore<SiteSettings>(path.join(DATA_DIR, 'site.json'), defaults, 0o644);

/** Current site settings (defaults merged with `blog/data/site.json`). */
export function getSiteSettings(): SiteSettings {
  const saved = store.read();
  return { ...defaults(), ...saved, strings: { ...(saved.strings ?? {}) } };
}

export function updateSiteSettings(patch: Partial<SiteSettings>): SiteSettings {
  const next = { ...getSiteSettings(), ...patch };
  store.write(next);
  return next;
}

/**
 * Resolve a UI string key. Custom overrides from `site.json` win over the
 * built-in dictionary, and an unknown key returns itself (matching the old
 * `_h._()` behaviour).
 */
export function t(key: string): string {
  const settings = getSiteSettings();
  return settings.strings[key] ?? STRINGS[key] ?? key;
}

/** Everything the templates need, assembled once per render. */
export interface TemplateGlobals {
  site: {
    title: string;
    desc: string;
    avatar: string;
    copyright: string;
    github: string;
    url: string;
  };
  menu: Array<{ text: string; icon: string; route: string; pageTitle?: string; pageDesc?: string }>;
  t: (key: string) => string;
  strings: Record<string, string>;
}

export function templateGlobals(): TemplateGlobals {
  const settings = getSiteSettings();
  return {
    site: {
      title: settings.title,
      desc: settings.desc,
      avatar: settings.avatar,
      copyright: settings.copyright,
      github: settings.github,
      url: settings.url,
    },
    menu: MENU,
    t,
    strings: { ...STRINGS, ...settings.strings },
  };
}

/** Public representation for `/api/site` — no secrets. */
export function publicSiteConfig(): Record<string, unknown> {
  const settings = getSiteSettings();
  return {
    title: settings.title,
    desc: settings.desc,
    avatar: settings.avatar,
    copyright: settings.copyright,
    github: settings.github,
    url: settings.url,
    commentsEnabled: settings.commentsEnabled,
    calendarEnabled: settings.calendarEnabled,
    menu: MENU,
    strings: { ...STRINGS, ...settings.strings },
  };
}

export { store as siteStore };
