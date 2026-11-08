-- Pure-Lua unit tests for backend/lua/comment_validation.lua
-- Run: lua tests/lua/test_comment_validation.lua
local root = (arg and arg[0] or ""):match("^(.*)/tests/lua/") or "."
package.path = root .. "/backend/lua/?.lua;" .. root .. "/tests/lua/?.lua;" .. package.path

local v = require("comment_validation")

local passed, failed = 0, 0

local function ok(cond, msg)
    if cond then
        passed = passed + 1
        print("  PASS  " .. msg)
    else
        failed = failed + 1
        print("  FAIL  " .. msg)
    end
end

local function eq(actual, expected, msg)
    if actual == expected then
        passed = passed + 1
        print("  PASS  " .. msg)
    else
        failed = failed + 1
        print(string.format("  FAIL  %s (expected %q, got %q)", msg, tostring(expected), tostring(actual)))
    end
end

local function has_error(errors, field, code)
    for _, e in ipairs(errors or {}) do
        if e.field == field and e.error == code then return true end
    end
    return false
end

local base = {
    nick = "Alice",
    mail = "alice@example.com",
    comment = "Hello world",
    url = "/post/hello",
}

local function clone(t)
    local o = {}
    for k, val in pairs(t) do o[k] = val end
    return o
end

print("== comment_validation ==")

-- 1. happy path
do
    local cleaned, errors = v.validate(clone(base))
    ok(errors == nil, "valid payload has no errors")
    eq(cleaned.nick, "Alice", "nick kept as-is")
    eq(cleaned.url, "/post/hello", "url kept as-is")
    eq(cleaned.link, "", "optional link defaults to empty string")
end

-- 2. trim
do
    local cleaned = v.validate({ nick = "  Bob\t", mail = " bob@example.com ", comment = "\n hi \n", url = "/about/" })
    eq(cleaned.nick, "Bob", "nick is trimmed")
    eq(cleaned.mail, "bob@example.com", "mail is trimmed")
    eq(cleaned.comment, "hi", "comment is trimmed")
end

-- 3. required nick
for _, bad in ipairs({ "", "   ", "\t\n" }) do
    local _, errors = v.validate({ nick = bad, mail = "a@b.co", comment = "x", url = "/" })
    ok(has_error(errors, "nick", "nick_required"), string.format("blank nick %q -> nick_required", bad))
end
do
    local _, errors = v.validate({ mail = "a@b.co", comment = "x", url = "/" })
    ok(has_error(errors, "nick", "nick_required"), "missing nick -> nick_required")
end

-- 4. required / invalid mail
do
    local _, errors = v.validate({ nick = "n", comment = "x", url = "/" })
    ok(has_error(errors, "mail", "mail_required"), "missing mail -> mail_required")
end
for _, bad in ipairs({ "not-an-email", "a@b", "a@@b.co", "a b@c.co", "a@b..co", "a@.co", "\"x\"@b.co" }) do
    local _, errors = v.validate({ nick = "n", mail = bad, comment = "x", url = "/" })
    ok(has_error(errors, "mail", "mail_invalid"), string.format("invalid mail %q -> mail_invalid", bad))
end
do
    local cleaned, errors = v.validate({ nick = "n", mail = "first.last+tag@sub.example.co.uk", comment = "x", url = "/" })
    ok(errors == nil, "plus/dot/subdomain email accepted")
    eq(cleaned.mail, "first.last+tag@sub.example.co.uk", "email preserved")
end

-- 5. required / too long comment
do
    local _, errors = v.validate({ nick = "n", mail = "a@b.co", comment = "   ", url = "/" })
    ok(has_error(errors, "comment", "content_required"), "blank comment -> content_required")
end
do
    local _, errors = v.validate({ nick = "n", mail = "a@b.co", comment = string.rep("a", 5001), url = "/" })
    ok(has_error(errors, "comment", "content_too_long"), "5001-char comment -> content_too_long")
end
do
    local _, errors = v.validate({ nick = "n", mail = "a@b.co", comment = string.rep("a", 5000), url = "/" })
    ok(errors == nil, "5000-char comment accepted")
end

-- 6. nick length is counted in characters, not bytes
do
    local _, errors = v.validate({ nick = string.rep("林", 100), mail = "a@b.co", comment = "x", url = "/" })
    ok(errors == nil, "100 CJK chars nick accepted (code point count, not bytes)")
    local _, errors2 = v.validate({ nick = string.rep("林", 101), mail = "a@b.co", comment = "x", url = "/" })
    ok(has_error(errors2, "nick", "nick_too_long"), "101 CJK chars nick -> nick_too_long")
end

-- 7. url must be an internal path
for _, bad in ipairs({ "", "post/hello", "//evil.example", "javascript:alert(1)", "http://evil.example/x", "/a b", "/a\nb" }) do
    local _, errors = v.validate({ nick = "n", mail = "a@b.co", comment = "x", url = bad })
    ok(has_error(errors, "url", "url_required") or has_error(errors, "url", "url_invalid"),
        string.format("url %q rejected", bad))
end
do
    local _, errors = v.validate({ nick = "n", mail = "a@b.co", comment = "x", url = "/post/" .. string.rep("a", 500) })
    ok(has_error(errors, "url", "url_invalid"), "over-long url rejected")
end

-- 8. link must be http(s)
for _, bad in ipairs({ "javascript:alert(1)", "data:text/html,x", "example.com", "ftp://x" }) do
    local _, errors = v.validate({ nick = "n", mail = "a@b.co", comment = "x", url = "/", link = bad })
    ok(has_error(errors, "link", "link_invalid"), string.format("link %q -> link_invalid", bad))
end
do
    local _, errors = v.validate({ nick = "n", mail = "a@b.co", comment = "x", url = "/", link = "https://example.com/me" })
    ok(errors == nil, "https link accepted")
end

-- 9. avatar attribute-injection payload rejected
for _, bad in ipairs({ 'x" onerror="alert(1)', "/avatar.png\" onload=", "javascript:alert(1)", "/a b.png" }) do
    local _, errors = v.validate({ nick = "n", mail = "a@b.co", comment = "x", url = "/", avatar = bad })
    ok(has_error(errors, "avatar", "avatar_invalid"), string.format("avatar %q -> avatar_invalid", bad))
end
do
    local cleaned, errors = v.validate({ nick = "n", mail = "a@b.co", comment = "x", url = "/", avatar = "/avatars/abc.webp" })
    ok(errors == nil, "internal avatar path accepted")
    eq(cleaned.avatar, "/avatars/abc.webp", "avatar preserved")
end

-- 10. control characters
do
    local _, errors = v.validate({ nick = "a\0b", mail = "a@b.co", comment = "x", url = "/" })
    ok(has_error(errors, "nick", "nick_invalid"), "NUL byte in nick rejected")
end
do
    local _, errors = v.validate({ nick = "n", mail = "a@b.co", comment = "line1\nline2\ttab", url = "/" })
    ok(errors == nil, "newline/tab inside comment allowed")
end
do
    local _, errors = v.validate({ nick = "n", mail = "a@b.co", comment = "bad\0nul", url = "/" })
    ok(has_error(errors, "comment", "content_invalid"), "NUL byte in comment rejected")
end

-- 11. XSS payload is stored verbatim (escaping is a rendering concern)
do
    local payload = "<script>alert(1)</script>"
    local cleaned, errors = v.validate({ nick = "<img src=x onerror=alert(1)>", mail = "a@b.co", comment = payload, url = "/" })
    ok(errors == nil, "HTML in nick/comment accepted as text (escaped at render time)")
    eq(cleaned.comment, payload, "comment body not mangled")
end

-- 12. ua clamps without splitting UTF-8
do
    local cleaned = v.validate({ nick = "n", mail = "a@b.co", comment = "x", url = "/", ua = string.rep("林", 600) })
    ok(#cleaned.ua <= 512, "ua clamped to <= 512 bytes")
    eq(v.utf8_len(cleaned.ua), 170, "ua truncation kept only whole UTF-8 characters")
end

-- 13. multiple errors keep a stable order (first = visual order)
do
    local _, errors = v.validate({})
    eq(errors[1].field, "nick", "first error is nick")
    eq(#errors, 4, "empty payload reports all four required fields")
end

-- 14. non-table payload
do
    local _, errors = v.validate("nope")
    ok(has_error(errors, "body", "invalid_body"), "non-table body -> invalid_body")
end

print(string.format("\n%d passed, %d failed", passed, failed))
os.exit(failed == 0 and 0 or 1)
