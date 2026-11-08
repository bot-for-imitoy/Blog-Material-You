--[[
  comment_validation.lua — Pure-Lua validation for the public comment API.

  No ngx.* dependency on purpose: this module is unit-testable with plain
  `lua` (see tests/lua/test_comment_validation.lua) and is shared by
  api/comments.lua so the client and the server cannot drift apart.

  Error contract (returned as the 2nd value, an ordered array):
    { field = "nick"|"mail"|"comment"|"url"|"link"|"avatar",
      error = "<machine_readable_code>",
      message = "<human readable English fallback>" }

  The first entry is also what the API exposes at the top level
  ({ok=false, error=..., field=...}) so a client can focus the exact input.
]]
local _M = {}

-- Column sizes in docker/db_init.sql: nick 100, mail 255, link/url/avatar 500.
-- `comment` is TEXT; we cap it well below 64KB to bound storage and render cost.
_M.LIMITS = {
    nick    = 100,
    mail    = 254,  -- RFC 5321 practical maximum
    comment = 5000,
    url     = 500,
    link    = 500,
    avatar  = 500,
    ua      = 512,
}

-- Every C0 control + DEL: rejected in single-line fields.
local CONTROL = "[%z\1-\31\127]"
-- Multi-line comment text may keep \t, \n and \r but nothing else.
local CONTROL_MULTILINE = "[%z\1-\8\11\12\14-\31\127]"

local function is_string(v)
    return type(v) == "string"
end

--- Trim whitespace from both ends (does not touch inner text).
--- Handles ASCII whitespace and U+00A0 (UTF-8 C2 A0) without ever slicing a
--- multi-byte sequence in half.
function _M.trim(s)
    if not is_string(s) then return s end
    s = s:gsub("^[ \t\r\n\f\v]+", ""):gsub("[ \t\r\n\f\v]+$", "")
    while s:sub(1, 2) == "\194\160" do s = s:sub(3) end
    while s:sub(-2) == "\194\160" do s = s:sub(1, -3) end
    return s
end

--- Truncate to at most `max_bytes` bytes without splitting a UTF-8 sequence.
function _M.truncate_utf8(s, max_bytes)
    if #s <= max_bytes then return s end
    local cut = max_bytes
    -- Walk back while the byte at `cut` is a continuation byte (10xxxxxx).
    while cut > 0 and s:byte(cut + 1) and s:byte(cut + 1) >= 128 and s:byte(cut + 1) < 192 do
        cut = cut - 1
    end
    return s:sub(1, cut)
end

--- UTF-8 aware length (counts code points, so the limit matches user
--- perception for CJK text instead of counting bytes).
function _M.utf8_len(s)
    local _, count = s:gsub("[^\128-\193]", "")
    return count
end

--- Permissive-but-safe email check: exactly one @, no whitespace/quotes in
--- either part, an ASCII domain with at least one dot and a alphabetic TLD.
function _M.is_email(s)
    if not is_string(s) or #s > _M.LIMITS.mail then return false end
    if s:find("[%s\"'\\,;:<>%(%)%[%]]") then return false end
    local local_part, domain = s:match("^([^@]+)@([^@]+)$")
    if not local_part or not domain then return false end
    if #local_part > 64 then return false end
    if domain:sub(1, 1) == "." or domain:sub(-1) == "." then return false end
    if domain:find("%.%.") then return false end
    return domain:match("^[%w%.%-]+%.[A-Za-z][A-Za-z]+$") ~= nil
end

--- A comment must belong to a site path: "/post/foo", "/about/", "/".
--- Rejecting absolute/protocol-relative URLs keeps the stored value usable as
--- an internal key and stops "javascript:" style values from ever reaching an
--- admin link.
function _M.is_site_path(s)
    if not is_string(s) or s == "" then return false end
    if _M.utf8_len(s) > _M.LIMITS.url then return false end
    if s:sub(1, 1) ~= "/" then return false end
    if s:sub(1, 2) == "//" then return false end
    if s:find(CONTROL) or s:find("%s") then return false end
    return true
end

--- Optional website: empty, or an absolute http(s) URL.
function _M.is_http_url(s)
    if s == "" then return true end
    if not is_string(s) or _M.utf8_len(s) > _M.LIMITS.link then return false end
    if s:find(CONTROL) or s:find("%s") then return false end
    return s:match("^https?://[^/]") ~= nil
end

--- Optional avatar: empty, an internal /path, or an absolute http(s) URL.
function _M.is_avatar_ref(s)
    if s == "" then return true end
    if not is_string(s) or #s > _M.LIMITS.avatar then return false end
    if s:find(CONTROL) or s:find("%s") then return false end
    if s:find("[\"'<>`\\]") then return false end
    if s:sub(1, 1) == "/" and s:sub(1, 2) ~= "//" then return true end
    return s:match("^https?://[^/]") ~= nil
end

local function push(errors, field, code, message)
    errors[#errors + 1] = { field = field, error = code, message = message }
end

--- Validate + normalise a decoded JSON payload.
-- @param data table  decoded request body
-- @return cleaned table|nil, errors table|nil
function _M.validate(data)
    if type(data) ~= "table" then
        return nil, { { field = "body", error = "invalid_body", message = "Request body must be a JSON object" } }
    end

    local errors = {}
    local cleaned = {}

    -- nick (required)
    local nick = data.nick
    if not is_string(nick) then nick = "" end
    nick = _M.trim(nick)
    cleaned.nick = nick
    if nick == "" then
        push(errors, "nick", "nick_required", "Nickname is required")
    elseif _M.utf8_len(nick) > _M.LIMITS.nick then
        push(errors, "nick", "nick_too_long", "Nickname must be at most " .. _M.LIMITS.nick .. " characters")
    elseif nick:find(CONTROL) then
        push(errors, "nick", "nick_invalid", "Nickname contains invalid control characters")
    end

    -- mail (required, format)
    local mail = data.mail
    if not is_string(mail) then mail = "" end
    mail = _M.trim(mail)
    cleaned.mail = mail
    if mail == "" then
        push(errors, "mail", "mail_required", "Email is required")
    elseif not _M.is_email(mail) then
        push(errors, "mail", "mail_invalid", "Email address is not valid")
    end

    -- comment (required)
    local body = data.comment
    if not is_string(body) then body = "" end
    body = _M.trim(body)
    cleaned.comment = body
    if body == "" then
        push(errors, "comment", "content_required", "Comment content is required")
    elseif _M.utf8_len(body) > _M.LIMITS.comment then
        push(errors, "comment", "content_too_long", "Comment must be at most " .. _M.LIMITS.comment .. " characters")
    elseif body:find(CONTROL_MULTILINE) then
        push(errors, "comment", "content_invalid", "Comment contains invalid control characters")
    end

    -- url (required, internal path of the page being commented on)
    local url = data.url
    if not is_string(url) then url = "" end
    url = _M.trim(url)
    cleaned.url = url
    if url == "" then
        push(errors, "url", "url_required", "Page path is required")
    elseif not _M.is_site_path(url) then
        push(errors, "url", "url_invalid", "Page path must be an internal path starting with /")
    end

    -- link / avatar / ua (optional)
    local link = data.link
    if not is_string(link) then link = "" end
    link = _M.trim(link)
    cleaned.link = link
    if not _M.is_http_url(link) then
        push(errors, "link", "link_invalid", "Website must be an http(s) URL")
    end

    local avatar = data.avatar
    if not is_string(avatar) then avatar = "" end
    avatar = _M.trim(avatar)
    cleaned.avatar = avatar
    if not _M.is_avatar_ref(avatar) then
        push(errors, "avatar", "avatar_invalid", "Avatar must be an internal path or an http(s) URL")
    end

    -- ua is informational: clamp instead of rejecting the whole submission.
    local ua = data.ua
    if not is_string(ua) then ua = "" end
    ua = _M.trim(ua):gsub(CONTROL, "")
    if #ua > _M.LIMITS.ua then
        ua = _M.truncate_utf8(ua, _M.LIMITS.ua)
    end
    cleaned.ua = ua

    if #errors > 0 then
        return nil, errors
    end
    return cleaned, nil
end

return _M
