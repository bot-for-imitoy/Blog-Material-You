--[[
  serve.lua — Server-render the SPA shell (templates/pages/shell.etlua).
  Site title, slogan, avatar, sidebar menu, <title> and SEO meta are all
  filled in by the Lua backend (blog config + seo.lua) — no client-side
  JS replacement. The SPA JS keeps handling Pjax navigation only.
]]
local renderer = require("renderer")
local seo = require("seo")

ngx.header["Content-Type"] = "text/html; charset=utf-8"

local uri = ngx.var.uri or "/"
local s = seo.for_route(uri)

local html = renderer.render("pages/shell", {
    seo_title = s.title,
    seo_desc = s.desc,
    canonical = uri,
})

if not html then
    ngx.status = 500
    ngx.say("Internal Server Error")
    return
end

ngx.header["Content-Length"] = #html
ngx.print(html)
