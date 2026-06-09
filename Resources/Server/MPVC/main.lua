-- =============================================================================
-- MPVC — Proximity Voice Chat  |   Server Core
-- Version: 1.0.3               |   Author: 5DROR5
-- License: AGPL-3.0 — https://www.gnu.org/licenses/agpl-3.0.html
-- =============================================================================

local ROOT = "Resources/Server/MPVC"

-- =============================================================================
-- State
-- =============================================================================

local MAX_DISTANCE       = 100
local FADE_START         = 70
local MASTER_VOLUME      = 1.0
local FORCE_UI_LAYOUT    = false
local SERVER_ID          = "server1"
local RELAY_URL          = ""
local BRIDGE_URL         = ""
local RELAY_TOKEN        = ""
local RELAY_REGISTER_URL = ""

local mpvcPlayers = {}

-- =============================================================================
-- Utilities
-- =============================================================================

local function readFile(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local s = f:read("*a"); f:close(); return s
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
-- Config
-- =============================================================================

local function loadConfig()
    local s = readFile(ROOT .. "/config.json")
    if not s then return end
    local cfg = decodeJSON(s)
    if not cfg then return end
    if cfg.max_distance       then MAX_DISTANCE       = cfg.max_distance               end
    if cfg.fade_start         then FADE_START         = cfg.fade_start                 end
    if cfg.master_volume      then MASTER_VOLUME      = cfg.master_volume              end
    if cfg.force_ui_layout ~= nil then FORCE_UI_LAYOUT = (cfg.force_ui_layout == true) end
    if cfg.server_id          then SERVER_ID          = cfg.server_id                  end
    if cfg.relay_url          then RELAY_URL          = cfg.relay_url                  end
    if cfg.bridge_url         then BRIDGE_URL         = cfg.bridge_url                 end
    if cfg.relay_token        then RELAY_TOKEN        = cfg.relay_token                end
    if cfg.relay_register_url then RELAY_REGISTER_URL = cfg.relay_register_url        end
end

-- =============================================================================
-- Player list
-- =============================================================================

local function broadcastPlayerList()
    local list = {}
    for pid, name in pairs(mpvcPlayers) do
        table.insert(list, { id = pid, name = name })
    end
    local encoded = Util.JsonEncode(list)
    for pid in pairs(mpvcPlayers) do
        MP.TriggerClientEvent(pid, "VOICE_PlayerList", encoded)
    end
end

local function sendConfig(pid)
    MP.TriggerClientEvent(pid, "VOICE_Config", Util.JsonEncode({
        max_distance    = MAX_DISTANCE,
        fade_start      = FADE_START,
        master_volume   = MASTER_VOLUME,
        force_ui_layout = FORCE_UI_LAYOUT,
        server_id       = SERVER_ID,
        relay_url       = RELAY_URL,
        bridge_url      = BRIDGE_URL
    }))
end

-- =============================================================================
-- Bridge Token Registration
-- =============================================================================

local function httpPost(url, body)
    local safe = body:gsub("'", "'\"'\"'")
    local cmd  = "curl -s -m 5 -X POST -H 'Content-Type: application/json' -d '" .. safe .. "' '" .. url .. "'"
    local h    = io.popen(cmd)
    if not h then return nil end
    local r = h:read("*a"); h:close()
    return r ~= "" and r or nil
end

local function registerBridgeToken(pid)
    if RELAY_REGISTER_URL == "" or SERVER_ID == "" or RELAY_TOKEN == "" then return end
    local sessionId = SERVER_ID .. "_" .. tostring(pid)
    local body      = Util.JsonEncode({
        server_id    = SERVER_ID,
        master_token = RELAY_TOKEN,
        session_id   = sessionId
    })
    local response = httpPost(RELAY_REGISTER_URL, body)
    if not response then
        MP.log("WARN", "[MPVC] registerBridgeToken: no response for " .. sessionId)
        return
    end
    local data = decodeJSON(response)
    if not data or not data.token then
        MP.log("WARN", "[MPVC] registerBridgeToken: bad response: " .. tostring(response))
        return
    end
    MP.TriggerClientEvent(pid, "VOICE_BridgeToken", Util.JsonEncode({
        session_id = sessionId,
        token      = data.token
    }))
end

-- =============================================================================
-- Events
-- =============================================================================

function onInit()
    loadConfig()
    MP.RegisterEvent("onPlayerJoin",        "onPlayerJoin")
    MP.RegisterEvent("onPlayerDisconnect",  "onPlayerDisconnect")
    MP.RegisterEvent("VOICE_Hello",         "onVoiceHello")
    MP.RegisterEvent("VOICE_Signal",        "onVoiceSignal")
    MP.RegisterEvent("VOICE_RequestBridge", "onVoiceRequestBridge")
end

function onPlayerJoin(pid)
    sendConfig(pid)
end

function onPlayerDisconnect(pid)
    if mpvcPlayers[pid] then
        mpvcPlayers[pid] = nil
        broadcastPlayerList()
    end
end

function onVoiceHello(pid)
    mpvcPlayers[pid] = MP.GetPlayerName(pid)
    sendConfig(pid)
    broadcastPlayerList()
end

function onVoiceSignal(pid, data)
    local msg = decodeJSON(data)
    if not msg or not msg.to then return end
    local target = tonumber(msg.to)
    if not target then return end
    msg.from     = pid
    msg.fromName = MP.GetPlayerName(pid)
    msg.to       = nil
    MP.TriggerClientEvent(target, "VOICE_Signal", Util.JsonEncode(msg))
end

function onVoiceRequestBridge(pid, _)
    registerBridgeToken(pid)
end