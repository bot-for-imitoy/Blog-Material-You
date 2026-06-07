--[[
  admin_store.lua — Encrypted admin credentials store.
  File: blog/data/admin.json
  Uses AES-256-CBC: password-derived key encrypts a fixed verification token.
  If the file doesn't exist, the blog is in "uninitialized" state.
]]
local cjson = require("cjson")
local aes = require("resty.aes")
local _M = {}

local STORE_DIR = ngx.config.prefix() .. "../blog/data"
local STORE_FILE = STORE_DIR .. "/admin.json"
local VERIFY_TEXT = "BLOG-ADMIN-VERIFIED"

-- Encrypt password -> store entry
function _M.encrypt(user, password)
    local salt = ngx.encode_base64(ngx.hmac_sha1(tostring(os.time()) .. tostring(math.random()), "salt-gen"))
    salt = salt:gsub("\n", ""):sub(1, 8)

    local cipher, err = aes:new(password, salt, aes.cipher(256, "cbc"), aes.hash.sha256, 1000, 16)
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

    local cipher = aes:new(input_password, stored.salt, aes.cipher(256, "cbc"), aes.hash.sha256, 1000, 16)
    if not cipher then return false end

    local decrypted, err = cipher:decrypt(encrypted)
    if not decrypted then return false end

    -- Remove padding (PKCS7) - resty.aes may include padding in output
    decrypted = decrypted:gsub("%z*$", "")
    -- Check the verification text prefix (exact match after removing null padding)
    return decrypted == VERIFY_TEXT
end

-- Read store from disk
function _M.read()
    local f = io.open(STORE_FILE, "r")
    if not f then return nil end
    local content = f:read("*all")
    f:close()
    local ok, data = pcall(cjson.decode, content)
    if not ok then return nil end
    return data
end

-- Write store to disk
function _M.write(data)
    os.execute("mkdir -p " .. STORE_DIR)
    local f = io.open(STORE_FILE, "w")
    if not f then return nil, "Cannot write store" end
    f:write(cjson.encode(data))
    f:close()
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
