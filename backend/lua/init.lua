--[[
  init.lua — Initialize blog data in shared dicts at worker startup.
  Cannot use resty.mysql in init_worker_by_lua context, so this only loads
  config. DB data is lazy-loaded on first request by the API handlers.
]]
local config = require("config")
local cjson = require("cjson")

local cache = ngx.shared.blog_cache
local init_flag = cache:get("initialized")
if init_flag then return end

ngx.log(ngx.NOTICE, "Blog Material You: Initializing config...")

-- Load config (static, no DB needed)
local cfg = config.get()
ngx.shared.blog_config:set("data", cjson.encode(cfg))

cache:set("initialized", 1, 0)
ngx.log(ngx.NOTICE, "Blog Material You: Config loaded (data will be lazy-loaded from DB on first request)")