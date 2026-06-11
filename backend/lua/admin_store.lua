--[[
  admin_store.lua — Encrypted admin credentials store.
  Stored in DB config table (key: "admin_creds") instead of admin.json.
  Uses AES-256-CBC: password-derived key encrypts a fixed verification token.
  If no entry exists, the blog is in "uninitialized" state.
]]
local cjson = require("cjson")
local aes = require("resty.aes")
local db = require("db")
local _M = {}

local CONFIG_KEY = "admin_creds"
local VERIFY_TEXT = "BLOG-ADMIN-VERIFIED"

-- Encrypt password -> store entry
function _M.encrypt(user, password)
    local salt = ngx.encode_base64(ngx.hmac_sha1(tostring(os.time()) .. tostring(math.random()), "salt-gen"))
    salt = salt:gsub("\n", ""):sub(1, 8)

    local cipher, err = aes:new(password, salt, aes.cipher(256, "cbc"), aes.hash.sha256, 600000, 16)
    if not cipher then ngx.log(ngx.ERR, "aes:new failed: ", err); return nil, "Failed to create cipher" end

    local encrypted, err = cipher:encrypt(VERIFY_TEXT)
    if not encrypted then return nil, err or "Encryption failed" end

    return {
        user = user,
        setup_done = true,
        data = ngx.encode_base64(encrypted):gsub("\n", ""),
        salt = salt,
    }
end

-- Verify a password against stored entry
function _M.verify(stored, input_password)
    if not stored or not stored.setup_done then return false end
    if not input_password or input_password == "" then return false end

    local encrypted = ngx.decode_base64(stored.data)
    if not encrypted then return false end

    local cipher = aes:new(input_password, stored.salt, aes.cipher(256, "cbc"), aes.hash.sha256, 600000, 16)
    if not cipher then return false end

    local decrypted, err = cipher:decrypt(encrypted)
    if not decrypted then return false end

    -- Remove padding (PKCS7) - resty.aes may include padding in output
    decrypted = decrypted:gsub("%z*$", "")
    -- Check the verification text prefix (exact match after removing null padding)
    return decrypted == VERIFY_TEXT
end

-- Read store from DB
function _M.read()
    local res, err = db.query("SELECT `value` FROM config WHERE `key` = ?", {CONFIG_KEY})
    if not res or #res == 0 then return nil end
    local ok, data = pcall(cjson.decode, res[1].value)
    if not ok then return nil end
    return data
end

-- Write store to DB
function _M.write(data)
    local value = cjson.encode(data)
    local now = os.time()
    local res, err = db.query(
        "REPLACE INTO config (`key`, `value`, updated_at) VALUES (?, ?, ?)",
        {CONFIG_KEY, value, now}
    )
    if not res then return nil, "Cannot write store: " .. (err or "unknown") end
    return true
end

function _M.is_setup_done()
    local data = _M.read()
    return data ~= nil and data.setup_done == true
end

function _M.get_user()
    local data = _M.read()
    if data then return data.user end
    return nil
end

return _M
