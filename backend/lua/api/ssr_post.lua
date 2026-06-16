--[[
  /ssr/post/<slug> — Server-side rendered post page for SEO.
  Nginx uses this for post page requests instead of SPA fallback.
]]
local ssr = require("ssr")

local slug = ngx.var.post_slug
if not slug then
    ngx.status = 400
    ngx.say("Bad request")
    return
end

local html = ssr.render_post(slug)
if not html then
    ngx.status = 404
    ngx.say("Not Found")
    return
end

ngx.header["Content-Type"] = "text/html; charset=utf-8"
ngx.header["X-SSR"] = "1"
ngx.say(html)
