-- /api/categories (list all categories with post counts)
local cjson = require("cjson")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "http://localhost:30999"

local posts_dict = ngx.shared.blog_posts
local raw = posts_dict:get("cat_index")
if raw then
    local cats = cjson.decode(raw)
    local result = {}
    for name, count in pairs(cats) do
        table.insert(result, { name = name, count = count })
    end
    table.sort(result, function(a, b) return a.name < b.name end)
    ngx.say(cjson.encode(result))
else
    ngx.status = 500
    ngx.say(cjson.encode({ error = "Categories not loaded" }))
end
