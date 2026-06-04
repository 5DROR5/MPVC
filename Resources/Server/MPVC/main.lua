-- =============================================================================
-- MPVC — Proximity Voice Chat  |   Server Core
-- Version: 1.0.0               |   Author: 5DROR5
-- License: AGPL-3.0 — https://www.gnu.org/licenses/agpl-3.0.html
-- =============================================================================

local ROOT = "Resources/Server/MPVC"

-- =============================================================================
-- STATE
-- =============================================================================

local MAX_DISTANCE  = 100
local FADE_START    = 70
local MASTER_VOLUME = 1.0

-- =============================================================================
-- FILE I/O
-- =============================================================================

local function readFile(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local s = f:read("*a")
    f:close()
    return s
end

local function decodeJSON(str)
    if type(str) ~= "string" then return nil end
    if type(Util) == "table" and Util.JsonDecode then
        local ok, t = pcall(Util.JsonDecode, str)
        if ok and type(t) == "table" then return t end
    end
    if json and json.decode then
        local ok, t = pcall(json.decode, str)
        if ok and type(t) == "table" then return t end
    end
    return nil
end

-- =============================================================================
-- CONFIG
-- =============================================================================

local function loadConfig()
    local s = readFile(ROOT .. "/config.json")
    if not s then
        print("[MPVC] config.json not found, using defaults")
        return
    end
    local cfg = decodeJSON(s)
    if not cfg then
        print("[MPVC] Failed to parse config.json, using defaults")
        return
    end
    if cfg.max_distance  then MAX_DISTANCE  = cfg.max_distance  end
    if cfg.fade_start    then FADE_START    = cfg.fade_start    end
    if cfg.master_volume then MASTER_VOLUME = cfg.master_volume end
    print("[MPVC] Config loaded")
end

-- =============================================================================
-- EVENTS
-- =============================================================================

function onInit()
    loadConfig()
    MP.RegisterEvent("onPlayerJoin",  "onPlayerJoin")
    MP.RegisterEvent("VOICE_Signal", "onVoiceSignal")
end

function onPlayerJoin(pid)
    MP.TriggerClientEvent(pid, "VOICE_Config", Util.JsonEncode({
        max_distance  = MAX_DISTANCE,
        fade_start    = FADE_START,
        master_volume = MASTER_VOLUME
    }))
end

function onVoiceSignal(pid, data)
    local msg = decodeJSON(data)
    if not msg or not msg.to then return end
    local target = tonumber(msg.to)
    if not target then return end
    msg.from = pid
    msg.to   = nil
    MP.TriggerClientEvent(target, "VOICE_Signal", Util.JsonEncode(msg))
end