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
    desc = "No blog desc.",

    -- Avatar
    avatar = "/img/avatar.jpg",

    -- Footer copyright
    copyright = "© 2025 Blog Material You",

    -- Common UI text
    loading = "Loading...",
    load_failed = "Failed to load",
    network_error = "Network error, please check connection",
    back = "Back",
    submit = "Submit",
    reply = "Reply",
    save = "Save",
    cancel = "Cancel",
    delete = "Delete",
    edit = "Edit",

    -- Navigation labels
    nav_home = "Home",
    nav_posts = "Posts",
    nav_tags = "Tags",
    nav_categories = "Categories",
    nav_moments = "Moments",
    nav_about = "About",
    nav_archives = "Archives",
    nav_friends = "Friends",

    -- Page headers
    page_posts = "Posts",
    page_posts_desc = "All posts of the blog",
    page_tags = "Tags",
    page_tags_desc = "All tags of the blog",
    page_categories = "Categories",
    page_categories_desc = "All categories of the blog",
    page_moments = "Moments",
    page_moments_desc = "Moments",
    page_archives = "Archives",
    page_archives_desc = "All archived posts",
    page_friends = "Friends",
    page_friends_desc = "My Friends",
    page_status = "Status",
    page_status_desc = "Service Status",
    page_auth = "Authentication",
    authDesc = "Authenticate with your email to access additional features.",

    -- Post / list related
    no_posts = "No posts yet",
    no_comments = "No comments yet",
    no_talks = "No moments yet",
    no_friends = "No friends yet",
    forward = "Read",
    posts_year = "",  -- suffix after year number (e.g. " 年" in Chinese)
    write_comment = "Write a comment",
    comment_title = "Comments",

    -- Comment form
    nick_name = "Nick Name",
    email = "Email",
    website = "Website (optional)",
    comment_content = "Comment",
    comment_success = "Comment submitted successfully",
    comment_fail = "Failed to submit comment",
    comment_title = "Comments",

    -- Aliases for template backward compat
    commentContent = "Comment",
    commentFail = "Failed to submit comment",
    commentSuccess = "Comment submitted successfully",
    commentTitle = "Comments",
    networkError = "Network error, please check connection",
    nickName = "Nick Name",
    noFriends = "No friends yet",
    postsYear = "",
    status = "Status",
    statusDesc = "Service Status",
    cpr = "© 2025 Blog Material You",
    -- Status page
    server_online = "Online",
    server_offline = "Offline",

    -- Tag/category page
    tag_posts_desc = "Posts tagged with",
    cat_posts_desc = "Posts in category",

    -- 404
    page_404_title = "404 — Page Not Found",
    page_404_desc = "The page you are looking for does not exist.",

    -- Admin
    admin_title = "Blog Admin",
    admin_login_title = "Blog Admin Login",
    admin_login_btn = "Login",
    admin_login_error = "Invalid username or password",
    admin_logout = "Logout",
    admin_dashboard = "Dashboard",
    admin_posts = "Posts",
    admin_comments = "Comments",
    admin_talks = "Talks",
    admin_friends = "Friends",
    admin_pages = "Pages",
    admin_security = "Security",
    admin_new_post = "New Post",
    admin_new_talk = "New Talk",
    admin_new_friend = "Add Friend",
    admin_edit_post = "Edit Post",
    admin_edit_page = "Edit Page",
    admin_save = "Save Changes",
    admin_delete = "Delete",
    admin_archive = "Archive",
    admin_unarchive = "Unarchive",
    admin_archived = "Archived",
    admin_recent_posts = "Recent Posts",
    admin_no_posts = 'No posts yet. Click "New Post" to start.',
    admin_no_comments = "No comments",
    admin_no_talks = "No talks",
    admin_no_friends = "No friends yet",
    admin_no_pages = "No pages yet",
    admin_comment_title_placeholder = "Comments for",
    admin_page_editor_title = "Edit Page",
    admin_friend_editor_title = "Edit Friend",
    admin_setup_title = "Initial Setup",
    admin_setup_desc = "Create your admin account",
    admin_setup_btn = "Create Admin",
    admin_totp_enabled = "Enabled",
    admin_totp_disabled = "Disabled",
    admin_totp_enable = "Enable 2FA",
    admin_totp_disable = "Disable 2FA",
    admin_totp_verify = "Verify & Enable",
    admin_totp_regenerate = "Regenerate",
    admin_totp_cancel = "Cancel",
    admin_totp_secret_label = "Secret",
    admin_totp_code_label = "Code",
    admin_totp_code_placeholder = "Enter 6-digit code",
    admin_totp_status = "Status",
    admin_totp_save_warning = "Save your secret before disabling, or you'll be locked out!",
    admin_totp_verify_help = "Scan the QR code with Google Authenticator, Authy, 1Password, etc., then enter the 6-digit code.",
    admin_totp_disabled_help = "When enabled, login requires password + 6-digit code from authenticator app.",
    admin_change_password = "Change Password",
    admin_current_password = "Current Password",
    admin_new_username = "New Username (optional)",
    admin_new_password = "New Password",
    admin_confirm_password = "Confirm Password",
    admin_save_changes = "Save Changes",
    admin_post_count = "Posts",
    admin_comment_count = "Comments",
    admin_tag_count = "Tags",

    -- Admin editor labels
    editor_slug = "Slug",
    editor_title = "Title",
    editor_date = "Date",
    editor_cover = "Cover URL",
    editor_tags = "Tags (comma separated)",
    editor_cats = "Categories (comma separated)",
    editor_content = "Content",
    editor_english = "English",

    -- Admin friend editor
    friend_name = "Name",
    friend_url = "URL",
    friend_descr = "Description",
    friend_avatar = "Avatar",
    friend_sort = "Sort Order",

    -- TOTP / 2FA page
    totp_title = "Two-Factor Auth",
    totp_manual_secret = "Manual Secret",
    totp_copy_secret = "Copy",
    totp_copied = "Copied",

    game_score = "Score",
    game_best = "Best",
    game_new_game = "New Game",

    -- Permissions
    admin_permissions = "Permissions: ",
    admin_permissions_none = "None",

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
        { text = "Home",       icon = "/icon/home.svg",    route = "/" },
        { text = "Posts",      page_title = "page_posts", page_desc = "page_posts_desc", icon = "/icon/article.svg",  route = "/posts/" },
        { text = "Tags",       page_title = "page_tags",  page_desc = "page_tags_desc",  icon = "/icon/tag.svg",     route = "/tags/" },
        { text = "Categories", page_title = "page_categories", page_desc = "page_categories_desc", icon = "/icon/category.svg", route = "/categories/" },
        { text = "Moments",    page_title = "page_moments", page_desc = "page_moments_desc", icon = "/icon/chat.svg",   route = "/talks/" },
        { text = "About",      icon = "/icon/person.svg",  route = "/about/" },
        { text = "Archives",   page_title = "page_archives", page_desc = "page_archives_desc", icon = "/icon/archive.svg", route = "/archives/" },
        { text = "Friends",    page_title = "page_friends", page_desc = "page_friends_desc", icon = "/icon/friends.svg", route = "/friends/" },
    },
}

function _M.get()
    return _M.data
end

return _M
