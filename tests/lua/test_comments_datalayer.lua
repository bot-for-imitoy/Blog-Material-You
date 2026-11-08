-- Tests for backend/lua/comments.lua: every user value must travel as a
-- bound parameter, never interpolated into the SQL string.
-- Run: lua tests/lua/test_comments_datalayer.lua
local root = (arg and arg[0] or ""):match("^(.*)/tests/lua/") or "."
package.path = root .. "/backend/lua/?.lua;" .. root .. "/tests/lua/?.lua;" .. package.path

require("fake_ngx").reset({})

local queries = {}
local next_result = { { cnt = 3 } }
package.loaded["db"] = {
    query = function(sql, params)
        queries[#queries + 1] = { sql = sql, params = params }
        if sql:match("^%s*INSERT") then return { insert_id = 9, affected_rows = 1 } end
        if sql:match("^%s*DELETE") then return { insert_id = 0, affected_rows = 1 } end
        return next_result
    end,
}

local comments = require("comments")

local passed, failed = 0, 0
local function ok(cond, msg)
    if cond then passed = passed + 1; print("  PASS  " .. msg)
    else failed = failed + 1; print("  FAIL  " .. msg) end
end
local function eq(a, b, msg)
    if a == b then passed = passed + 1; print("  PASS  " .. msg)
    else failed = failed + 1; print(string.format("  FAIL  %s (expected %q, got %q)", msg, tostring(b), tostring(a))) end
end

print("== comments.lua data layer ==")

local payload = "x' OR 1=1 -- \\ ; DROP TABLE comments"

comments.load(payload)
eq(queries[1].params[1], payload, "load(): user path passed as a bound parameter")
ok(queries[1].sql:find("?", 1, true) ~= nil, "load(): SQL uses a placeholder")
ok(queries[1].sql:find(payload, 1, true) == nil, "load(): payload is NOT present in the SQL text")
ok(queries[1].sql:find("mail", 1, true) == nil, "load(): public list does not select mail")

comments.count(payload)
eq(queries[2].params[1], payload, "count(): bound parameter")
eq(comments.count("/x"), 3, "count(): returns COUNT(*) as a number")

comments.add("nick", "mail@example.com", payload, "/post/x", "", "", "")
eq(queries[4].params[3], payload, "add(): comment body bound, not interpolated")
ok(queries[4].sql:find(payload, 1, true) == nil, "add(): payload absent from SQL text")
eq(queries[4].params[8] ~= nil, true, "add(): create_time is bound")

local ok_del = comments.delete_by_id("12")
eq(ok_del, true, "delete_by_id('12') deletes")
eq(queries[5].params[1], 12, "delete_by_id(): numeric id bound")
local bad = comments.delete_by_id("1 OR 1=1")
eq(bad, false, "delete_by_id('1 OR 1=1') rejected without querying")

print(string.format("\n%d passed, %d failed", passed, failed))
os.exit(failed == 0 and 0 or 1)
