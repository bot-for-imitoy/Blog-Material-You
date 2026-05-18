-- /api/tags (list all tags with post counts)
local cjson = require("cjson")

ngx.header["Content-Type"] = "application/json"
ngx.header["Access-Control-Allow-Origin"] = "*"

local posts_dict = ngx.shared.blog_posts
local raw = posts_dict:get("tag_index")
if raw then
    local tags = cjson.decode(raw)
    local result = {}
    for name, count in pairs(tags) do
        table.insert(result, { name = name, count = count })
    end
    table.sort(result, function(a, b) return a.name < b.name end)
    ngx.say(cjson.encode(result))
else
    ngx.status = 500
    ngx.say(cjson.encode({ error = "Tags not loaded" }))
end
