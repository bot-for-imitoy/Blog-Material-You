--[[
  totp.lua — TOTP (RFC 6238) verification for two-factor authentication.
  Uses HMAC-SHA1 with 30-second time steps, 6-digit codes, ±1 step skew.
]]
local _M = {}

-- Base32 decoding (RFC 4648)
local function base32_decode(str)
    local b32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
    local map = {}
    for i = 1, 32 do
        local c = b32:sub(i, i)
        map[c] = i - 1
        map[c:lower()] = i - 1
    end

    str = str:gsub("=", "")

    local buffer = 0
    local bits_left = 0
    local bytes = {}

    for i = 1, #str do
        local v = map[str:sub(i, i)]
        if not v then
            return nil, "Invalid base32 character at position " .. i
        end
        buffer = buffer * 32 + v
        bits_left = bits_left + 5
        if bits_left >= 8 then
            bits_left = bits_left - 8
            bytes[#bytes + 1] = string.char(math.floor(buffer / (2 ^ bits_left)) % 256)
            buffer = buffer % (2 ^ bits_left)
        end
    end

    return table.concat(bytes)
end

-- Pack an integer as 8 big-endian bytes
local function int64_to_bytes(n)
    return string.char(
        math.floor(n / 2 ^ 56) % 256,
        math.floor(n / 2 ^ 48) % 256,
        math.floor(n / 2 ^ 40) % 256,
        math.floor(n / 2 ^ 32) % 256,
        math.floor(n / 2 ^ 24) % 256,
        math.floor(n / 2 ^ 16) % 256,
        math.floor(n / 2 ^ 8) % 256,
        n % 256
    )
end

-- Dynamic truncation per RFC 4226 Section 5.3
local function dynamic_truncate(hmac)
    local offset = hmac:byte(#hmac) % 16
    local code = ((hmac:byte(offset + 1) % 128) * 256 ^ 3) +
                 (hmac:byte(offset + 2) * 256 ^ 2) +
                 (hmac:byte(offset + 3) * 256) +
                 hmac:byte(offset + 4)
    return code
end

-- Generate a single TOTP value for a given counter
local function generate_totp(key, counter)
    local msg = int64_to_bytes(counter)
    local hmac = ngx.hmac_sha1(key, msg)
    local code = dynamic_truncate(hmac)
    return string.format("%06d", code % 1000000)
end

-- Verify a TOTP code against a base32-encoded secret.
-- Allows ±1 time step skew (checks current, previous, next 30s windows).
function _M.verify(secret_b32, code)
    if not secret_b32 or #secret_b32 == 0 then
        return false, "No TOTP secret configured"
    end
    if not code or #code == 0 then
        return false, "No TOTP code provided"
    end

    local key, err = base32_decode(secret_b32)
    if not key then
        return false, "Invalid TOTP secret (must be base32): " .. (err or "")
    end

    code = tostring(code):gsub("%s", "")
    if #code ~= 6 or not code:match("^%d+$") then
        return false, "TOTP code must be 6 digits"
    end

    local time_step = 30
    local now = os.time()
    local counter_base = math.floor(now / time_step)

    for offset = -1, 1 do
        local totp = generate_totp(key, counter_base + offset)
        if totp == code then
            return true
        end
    end

    return false, "Invalid TOTP code"
end

-- Generate a provisioning URI for use with authenticator apps
function _M.provisioning_uri(secret_b32, user, issuer)
    issuer = issuer or "BlogMaterialYou"
    local encoded_issuer = issuer:gsub(" ", "+")
    return "otpauth://totp/" .. encoded_issuer .. ":" .. user ..
           "?secret=" .. secret_b32 ..
           "&issuer=" .. encoded_issuer
end

return _M
