-- End-to-end tests for backend/lua/api/comments.lua with a fake ngx.
-- Exercises HTTP status codes, the structured error contract and the
-- argument mapping into the data layer (comments.add).
-- Run: lua tests/lua/test_comments_api.lua
local root = (arg and arg[0] or ""):match("^(.*)/tests/lua/") or "."
package.path = root .. "/backend/lua/?.lua;" .. root .. "/tests/lua/?.lua;" .. package.path

local json = require("json")
local fake = require("fake_ngx")

-- cjson is provided by the test shim; never used in production tests
package.loaded["cjson"] = json

-- Fake data layer: records calls, returns a canned row.
local calls = { add = {}, load = {}, count = {} }
local fake_comments = {
    load = function(path)
        calls.load[#calls.load + 1] = path
        return { { id = 1, nick = "Alice", comment = "hi", create_time = 1 } }
    end,
    count = function(path)
        calls.count[#calls.count + 1] = path
        return 7
    end,
    add = function(nick, mail, comment, url, link, ua, avatar)
        calls.add[#calls.add + 1] = { nick = nick, mail = mail, comment = comment,
                                      url = url, link = link, ua = ua, avatar = avatar }
        return { id = 42, nick = nick, mail = mail, comment = comment, url = url,
                 link = link, ua = ua, avatar = avatar, create_time = 1700000000 }
    end,
}
package.loaded["comments"] = fake_comments

local API = root .. "/backend/lua/api/comments.lua"

local passed, failed = 0, 0
local function eq(actual, expected, msg)
    if actual == expected then
        passed = passed + 1
        print("  PASS  " .. msg)
    else
        failed = failed + 1
        print(string.format("  FAIL  %s (expected %s, got %s)", msg, tostring(expected), tostring(actual)))
    end
end

--- Run one request through the real endpoint file.
local function request(method, opts)
    opts = opts or {}
    fake.reset({ method = method, var = opts.var or {}, body = opts.body })
    dofile(API)
    local body = fake.body()
    local decoded
    if body ~= "" then
        decoded = json.decode(body)
    end
    return fake.status(), decoded, body, _G.ngx.header
end

print("== api/comments.lua ==")

-- POST: valid
do
    calls.add = {}
    local status, res = request("POST", { body = json.encode({
        nick = "  Alice ", mail = " alice@example.com ", comment = " hello ",
        url = "/post/x", link = "https://example.com", ua = "ua", avatar = "/avatars/a.webp",
    }) })
    eq(status, 201, "valid POST -> 201")
    eq(res.ok, true, "valid POST -> ok=true")
    eq(res.errno, 0, "valid POST -> errno=0")
    eq(calls.add[1].nick, "Alice", "nick trimmed before insert")
    eq(calls.add[1].mail, "alice@example.com", "mail trimmed before insert")
    eq(calls.add[1].comment, "hello", "comment trimmed before insert")
end

-- POST: missing everything -> first error is nick, HTTP 422
do
    calls.add = {}
    local status, res = request("POST", { body = "{}" })
    eq(status, 422, "empty object -> 422")
    eq(res.ok, false, "empty object -> ok=false")
    eq(res.error, "nick_required", "empty object -> error=nick_required")
    eq(res.field, "nick", "empty object -> field=nick")
    eq(#res.errors, 4, "all four missing fields reported")
    eq(#calls.add, 0, "nothing inserted on validation failure")
end

-- POST: missing comment -> field=comment (the card's main requirement)
do
    local status, res = request("POST", { body = json.encode({
        nick = "Bob", mail = "bob@example.com", url = "/post/x",
    }) })
    eq(status, 422, "missing comment -> 422")
    eq(res.error, "content_required", "missing comment -> content_required")
    eq(res.field, "comment", "missing comment -> field=comment")
end

-- POST: invalid email
do
    local status, res = request("POST", { body = json.encode({
        nick = "Bob", mail = "not-an-email", comment = "hi", url = "/post/x",
    }) })
    eq(status, 422, "invalid email -> 422")
    eq(res.error, "mail_invalid", "invalid email -> mail_invalid")
    eq(res.field, "mail", "invalid email -> field=mail")
end

-- POST: length limits
do
    local status, res = request("POST", { body = json.encode({
        nick = "Bob", mail = "bob@example.com", comment = string.rep("x", 5001), url = "/post/x",
    }) })
    eq(status, 422, "over-long comment -> 422")
    eq(res.error, "content_too_long", "over-long comment -> content_too_long")
end

-- POST: XSS payloads are accepted as text (escaping is a render concern)
do
    local status, res = request("POST", { body = json.encode({
        nick = "<script>alert(1)</script>", mail = "bob@example.com",
        comment = "<img src=x onerror=alert(1)>", url = "/post/x",
    }) })
    eq(status, 201, "HTML payload accepted (stored as text) -> 201")
    eq(res.data.nick, "<script>alert(1)</script>", "payload stored verbatim for render-time escaping")
end

-- POST: avatar attribute injection rejected at the API boundary
do
    local status, res = request("POST", { body = json.encode({
        nick = "Bob", mail = "bob@example.com", comment = "hi", url = "/post/x",
        avatar = 'x" onerror="alert(1)',
    }) })
    eq(status, 422, "avatar injection -> 422")
    eq(res.error, "avatar_invalid", "avatar injection -> avatar_invalid")
end

-- POST: broken JSON / empty body
do
    local status, res = request("POST", { body = "{not json" })
    eq(status, 400, "invalid JSON -> 400")
    eq(res.error, "invalid_json", "invalid JSON -> error=invalid_json")
end
do
    local status, res = request("POST", { body = nil })
    eq(status, 400, "empty body -> 400")
    eq(res.error, "empty_body", "empty body -> error=empty_body")
end

-- GET: missing path
do
    local status, res = request("GET", { var = {} })
    eq(status, 400, "GET without path -> 400")
    eq(res.error, "path_required", "GET without path -> path_required")
end

-- GET: count shape (comment.js reads data.count)
do
    local status, res = request("GET", { var = { arg_path = "%2Fpost%2Fx", arg_type = "count" } })
    eq(status, 200, "GET count -> 200")
    eq(res.data.count, 7, "GET count -> data.count (not data[0])")
end

-- GET: list
do
    local status, res = request("GET", { var = { arg_path = "%2Fpost%2Fx" } })
    eq(status, 200, "GET list -> 200")
    eq(res.data.data[1].nick, "Alice", "GET list -> rows")
end

-- method handling
do
    local status, _, _, header = request("PUT")
    eq(status, 405, "PUT -> 405")
    eq(header["Allow"], "GET, POST, OPTIONS", "405 advertises Allow header")
end
do
    local status = request("OPTIONS")
    eq(status, 204, "OPTIONS -> 204")
end

print(string.format("\n%d passed, %d failed", passed, failed))
os.exit(failed == 0 and 0 or 1)
