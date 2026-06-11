-- =============================================================================
-- MPVC — Proximity Voice Chat  |   Server Core
-- Version: 1.0.4               |   Author: 5DROR5
-- License: AGPL-3.0 — https://www.gnu.org/licenses/agpl-3.0.html
-- =============================================================================

local ROOT = "Resources/Server/MPVC"

-- =============================================================================
-- State
-- =============================================================================

local MAX_DISTANCE       = 150
local FADE_START         = 75
local MASTER_VOLUME      = 1.0
local FORCE_UI_LAYOUT    = false
local SERVER_ID          = "server1"
local RELAY_URL          = ""
local BRIDGE_URL         = ""
local RELAY_TOKEN        = ""
local RELAY_REGISTER_URL = ""
local TURN_URL           = ""
local TURN_CREDS_URL     = ""

local mpvcPlayers   = {}
local mpvcTurnCreds = {}
local mpvcStates    = {}

-- =============================================================================
-- Utilities
-- =============================================================================

local function readFile(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local s = f:read("*a"); f:close(); return s
end

local _reqIdx = 0
local function httpPost(url, body)
    _reqIdx = _reqIdx + 1
    local tmp = ROOT .. "/._req" .. tostring(_reqIdx) .. ".json"
    local f = io.open(tmp, "w")
    if not f then return nil end
    f:write(body); f:close()
    local cmd = 'curl -s -m 5 -X POST -H "Content-Type: application/json" -d @"' .. tmp .. '" "' .. url .. '"'
    local h   = io.popen(cmd)
    if not h then FS.Remove(tmp); return nil end
    local r = h:read("*a"); h:close()
    FS.Remove(tmp)
    return r ~= "" and r or nil
end

-- =============================================================================
-- Config
-- =============================================================================

local function loadConfig()
    local s = readFile(ROOT .. "/config.json")
    if not s then return end
    local cfg = Util.JsonDecode(s)
    if not cfg then return end
    if cfg.max_distance       then MAX_DISTANCE       = cfg.max_distance               end
    if cfg.fade_start         then FADE_START         = cfg.fade_start                 end
    if cfg.master_volume      then MASTER_VOLUME      = cfg.master_volume              end
    if cfg.force_ui_layout ~= nil then FORCE_UI_LAYOUT = (cfg.force_ui_layout == true) end
    if cfg.server_id          then SERVER_ID          = cfg.server_id                  end
    if cfg.relay_url          then RELAY_URL          = cfg.relay_url                  end
    if cfg.bridge_url         then BRIDGE_URL         = cfg.bridge_url                 end
    if cfg.relay_token        then RELAY_TOKEN        = cfg.relay_token                end
    if cfg.relay_register_url then RELAY_REGISTER_URL = cfg.relay_register_url         end
    if cfg.turn_url           then TURN_URL           = cfg.turn_url                   end
    if cfg.turn_creds_url     then TURN_CREDS_URL     = cfg.turn_creds_url             end
end

-- =============================================================================
-- TURN credentials
-- =============================================================================

local function generateTurnCredentials(pid)
    if TURN_CREDS_URL == "" or SERVER_ID == "" or RELAY_TOKEN == "" then return nil, nil end
    local body = Util.JsonEncode({
        server_id    = SERVER_ID,
        master_token = RELAY_TOKEN,
        player_id    = tostring(pid)
    })
    local response = httpPost(TURN_CREDS_URL, body)
    if not response then return nil, nil end
    local data = Util.JsonDecode(response)
    if not data or not data.turn_username then return nil, nil end
    return data.turn_username, data.turn_credential
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

local function broadcastStates()
    local map = {}
    for pid, st in pairs(mpvcStates) do
        map[tostring(pid)] = st
    end
    local encoded = Util.JsonEncode(map)
    for pid in pairs(mpvcPlayers) do
        MP.TriggerClientEvent(pid, "VOICE_StateUpdate", encoded)
    end
end

local function sendConfig(pid)
    local creds = mpvcTurnCreds[pid] or {}
    MP.TriggerClientEventJson(pid, "VOICE_Config", {
        max_distance    = MAX_DISTANCE,
        fade_start      = FADE_START,
        master_volume   = MASTER_VOLUME,
        force_ui_layout = FORCE_UI_LAYOUT,
        server_id       = SERVER_ID,
        relay_url       = RELAY_URL,
        bridge_url      = BRIDGE_URL,
        relay_token     = RELAY_TOKEN,
        turn_url        = TURN_URL,
        turn_username   = creds.username,
        turn_credential = creds.credential
    })
end

-- =============================================================================
-- Bridge Token Registration
-- =============================================================================

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
        Util.LogWarn("[MPVC] registerBridgeToken: no response for " .. sessionId)
        return
    end
    local data = Util.JsonDecode(response)
    if not data or not data.token then
        Util.LogWarn("[MPVC] registerBridgeToken: bad response: " .. tostring(response))
        return
    end
    MP.TriggerClientEventJson(pid, "VOICE_BridgeToken", {
        session_id = sessionId,
        token      = data.token
    })
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
    MP.RegisterEvent("VOICE_State",         "onVoiceState")
end

function onPlayerJoin(pid)
    sendConfig(pid)
end

function onPlayerDisconnect(pid)
    if mpvcPlayers[pid] then
        mpvcPlayers[pid]   = nil
        mpvcTurnCreds[pid] = nil
        mpvcStates[pid]    = nil
        broadcastPlayerList()
        broadcastStates()
    end
end

function onVoiceHello(pid)
    mpvcPlayers[pid] = MP.GetPlayerName(pid)
    local ok, u, c = pcall(generateTurnCredentials, pid)
    if ok and u then mpvcTurnCreds[pid] = { username = u, credential = c } end
    sendConfig(pid)
    broadcastPlayerList()
    broadcastStates()
end

function onVoiceSignal(pid, data)
    local msg = Util.JsonDecode(data)
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

function onVoiceState(pid, data)
    local s = tostring(data)
    if s ~= "talk" and s ~= "listen" and s ~= "idle" then return end
    mpvcStates[pid] = s
    broadcastStates()
end