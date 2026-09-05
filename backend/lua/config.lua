--[[
  config.lua — Blog configuration module.
  All UI text is defined here as direct strings (single language).
]]
local _M = {}

local function env(key, default)
    local val = os.getenv(key)
    if val and val ~= "" then return val end
    return default
end

_M.data = {
    -- Sidebar header
    title = "imitoy's Blog",
    desc = '暂无简介',

    -- Avatar
    avatar = "/img/avatar.jpg",

    -- Footer copyright
    copyright = "© 2025 Blog Material You",

    -- Common UI text
    loading = '加载中...',
    load_failed = '加载失败',
    network_error = '网络错误，请检查网络连接',
    back = '返回',
    submit = '提交',
    reply = '回复',
    save = '保存',
    cancel = '取消',
    delete = '删除',
    edit = '编辑',

    -- Navigation labels
    nav_home = '首页',
    nav_posts = '文章',
    nav_tags = '标签',
    nav_categories = '分类',
    nav_moments = '动态',
    nav_about = '关于',
    nav_archives = '归档',
    nav_friends = '友链',

    -- Page headers
    page_posts = '文章',
    page_posts_desc = '博客全部文章',
    page_tags = '标签',
    page_tags_desc = '博客全部标签',
    page_categories = '分类',
    page_categories_desc = '博客全部分类',
    page_moments = '动态',
    page_moments_desc = '最新动态',
    page_archives = '归档',
    page_archives_desc = '全部归档文章',
    page_friends = '友链',
    page_friends_desc = '我的朋友们',
    page_status = '状态',
    page_status_desc = '服务状态',
    page_auth = '身份验证',
    authDesc = '使用邮箱验证身份，解锁更多功能。',

    -- Post / list related
    no_posts = '暂无文章',
    no_comments = '暂无评论',
    no_talks = '暂无动态',
    no_friends = '暂无友链',
    forward = '阅读全文',
    posts_year = "",  -- suffix after year number (e.g. " 年" in Chinese)
    write_comment = '写评论',
    comment_title = '评论',

    -- Comment form
    nick_name = '昵称',
    email = '邮箱',
    website = '网站（可选）',
    comment_content = '评论内容',
    comment_success = '评论提交成功',
    comment_fail = '评论提交失败',
    comment_title = "Comments",

    -- Aliases for template backward compat
    commentContent = '评论内容',
    commentFail = '评论提交失败',
    commentSuccess = '评论提交成功',
    commentTitle = '评论',
    networkError = '网络错误，请检查网络连接',
    nickName = '昵称',
    noFriends = '暂无友链',
    postsYear = "",
    status = '状态',
    statusDesc = '服务状态',
    cpr = "© 2025 Blog Material You",
    -- Status page
    server_online = '在线',
    server_offline = '离线',

    -- Tag/category page
    tag_posts_desc = '标签为',
    cat_posts_desc = '分类为',

    -- 404
    page_404_title = '404 — 页面未找到',
    page_404_desc = '你访问的页面不存在。',

    -- Admin
    admin_title = '博客后台',
    admin_login_title = '博客后台登录',
    admin_login_btn = '登录',
    admin_login_error = '用户名或密码错误',
    admin_logout = '退出登录',
    admin_dashboard = '控制台',
    admin_posts = '文章',
    admin_comments = '评论',
    admin_talks = '动态',
    admin_friends = '友链',
    admin_pages = '页面',
    admin_security = '安全',
    admin_new_post = '新建文章',
    admin_new_talk = '发布动态',
    admin_new_friend = '添加友链',
    admin_edit_post = '编辑文章',
    admin_edit_page = '编辑页面',
    admin_save = '保存',
    admin_delete = '删除',
    admin_archive = '归档',
    admin_unarchive = '取消归档',
    admin_archived = '已归档',
    admin_recent_posts = '最近文章',
    admin_no_posts = '暂无文章，点击“新建文章”开始吧',
    admin_no_comments = '暂无评论',
    admin_no_talks = '暂无动态',
    admin_no_friends = '暂无友链',
    admin_no_pages = '暂无页面',
    admin_comment_title_placeholder = '「」的评论',
    admin_page_editor_title = '编辑页面',
    admin_friend_editor_title = '编辑友链',
    admin_setup_title = '初始化设置',
    admin_setup_desc = '创建管理员账号',
    admin_setup_btn = '创建管理员',
    admin_totp_enabled = '已启用',
    admin_totp_disabled = '未启用',
    admin_totp_enable = '启用两步验证',
    admin_totp_disable = '关闭两步验证',
    admin_totp_verify = '验证并启用',
    admin_totp_regenerate = '重新生成',
    admin_totp_cancel = '取消',
    admin_totp_secret_label = '密钥',
    admin_totp_code_label = '验证码',
    admin_totp_code_placeholder = '输入 6 位验证码',
    admin_totp_status = '状态',
    admin_totp_save_warning = '关闭前请保存密钥，否则将无法登录！',
    admin_totp_verify_help = '使用 Google Authenticator、Authy、1Password 等应用扫描二维码，然后输入 6 位验证码。',
    admin_totp_disabled_help = '启用后，登录需要密码 + 验证器应用中的 6 位验证码。',
    admin_change_password = '修改密码',
    admin_current_password = '当前密码',
    admin_new_username = '新用户名（可选）',
    admin_new_password = '新密码',
    admin_confirm_password = '确认密码',
    admin_save_changes = '保存修改',
    admin_post_count = '文章',
    admin_comment_count = '评论',
    admin_tag_count = '标签',

    -- Admin editor labels
    editor_slug = '标识（Slug）',
    editor_title = '标题',
    editor_date = '日期',
    editor_cover = '封面 URL',
    editor_tags = '标签（逗号分隔）',
    editor_cats = '分类（逗号分隔）',
    editor_content = '内容',
    editor_english = '英文',

    -- Admin friend editor
    friend_name = '名称',
    friend_url = '链接',
    friend_descr = '描述',
    friend_avatar = '头像',
    friend_sort = '排序',

    -- TOTP / 2FA page
    totp_title = '两步验证',
    totp_manual_secret = '手动输入密钥',
    totp_copy_secret = '复制',
    totp_copied = '已复制',

    game_score = '得分',
    game_best = '最高分',
    game_new_game = '新游戏',

    -- Permissions
    admin_permissions = '权限：',
    admin_permissions_none = '无',

    -- Blog info
    github = "https://github.com/imitoy/Blog",

    -- Admin credentials loaded from encrypted store at runtime.
    admin_user = "",
    admin_pass = "",

    -- Session token HMAC secret (default for dev, always override in production)
    session_secret = env("BMY_SESSION_SECRET", "bmy-default-dev-secret-2024"),

    -- Sidebar navigation menu
    -- Each item: { text, page_title?, page_desc?, icon, route }
    -- page_title and page_desc reference keys in this config (e.g. "page_posts")
    menu = {
        { text = '首页',       icon = "/icon/home.svg",    route = "/" },
        { text = '文章',      page_title = "page_posts", page_desc = "page_posts_desc", icon = "/icon/article.svg",  route = "/posts/" },
        { text = '标签',       page_title = "page_tags",  page_desc = "page_tags_desc",  icon = "/icon/tag.svg",     route = "/tags/" },
        { text = '分类', page_title = "page_categories", page_desc = "page_categories_desc", icon = "/icon/category.svg", route = "/categories/" },
        { text = '动态',    page_title = "page_moments", page_desc = "page_moments_desc", icon = "/icon/chat.svg",   route = "/talks/" },
        { text = '关于',      icon = "/icon/person.svg",  route = "/about/" },
        { text = '归档',   page_title = "page_archives", page_desc = "page_archives_desc", icon = "/icon/archive.svg", route = "/archives/" },
        { text = '友链',    page_title = "page_friends", page_desc = "page_friends_desc", icon = "/icon/friends.svg", route = "/friends/" },
    },
}

function _M.get()
    return _M.data
end

return _M
