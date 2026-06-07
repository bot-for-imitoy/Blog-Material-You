--[[
  password.lua — Password verification with HMAC hashing.
  Falls back to plaintext comparison for backward compatibility.
]]
local _M = {}

-- Verify a password against stored credentials.
-- Uses HMAC-SHA1 (available in all OpenResty versions) for hashed comparison.
function _M.verify(input, plaintext, hash_b64, salt)
    if not input then return false end
    -- Hashed comparison (preferred)
    if hash_b64 and #hash_b64 > 0 and salt and #salt > 0 then
        local computed = ngx.encode_base64(ngx.hmac_sha1(salt, input))
        computed = computed:gsub("\n", "")
        return computed == hash_b64
    end
    -- Fallback: plaintext comparison
    return input == plaintext
end

return _M
