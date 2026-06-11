-- =============================================================================
-- MPVC — Proximity Voice Chat  |   Client Extension
-- Version: 1.0.4               |   Author: 5DROR5
-- License: AGPL-3.0 — https://www.gnu.org/licenses/agpl-3.0.html
-- =============================================================================

local M = {}

-- =============================================================================
-- State
-- =============================================================================

local MAX_DISTANCE    = 150
local FADE_START      = 50
local MASTER_VOLUME   = 1.0
local FORCE_LAYOUT    = false
local SERVER_ID       = ""
local RELAY_URL       = ""
local BRIDGE_URL      = ""
local RELAY_TOKEN     = ""
local TURN_URL        = ""
local TURN_USERNAME   = ""
local TURN_CREDENTIAL = ""

local prevNearby      = {}
local UPDATE_INTERVAL = 0.5
local CFG_INTERVAL    = 2.0
local timer           = 0
local cfgTimer        = 0
local layoutApplied   = false
local layoutTimer     = 0
local LAYOUT_DELAY    = 1.0

-- =============================================================================
-- Helpers
-- =============================================================================

local function guiTrigger(event, data)
    if type(guihooks) == "table" and type(guihooks.trigger) == "function" then
        guihooks.trigger(event, data)
    end
end

local function tryForceLayout(dt)
    if not FORCE_LAYOUT or layoutApplied then return end
    layoutTimer = layoutTimer + dt
    if layoutTimer < LAYOUT_DELAY then return end
    local inMP = MPCoreNetwork
                 and type(MPCoreNetwork.isMPSession) == "function"
                 and MPCoreNetwork.isMPSession()
    if inMP and core_gamestate and type(core_gamestate.setGameState) == "function" then
        pcall(function() core_gamestate.setGameState('multiplayer', 'MPVC', 'multiplayer') end)
        layoutApplied = true
    end
end

local function sendConfig()
    guiTrigger("VOICE_Config", {
        max_distance    = MAX_DISTANCE,
        fade_start      = FADE_START,
        master_volume   = MASTER_VOLUME,
        server_id       = SERVER_ID,
        relay_url       = RELAY_URL,
        bridge_url      = BRIDGE_URL,
        relay_token     = RELAY_TOKEN,
        turn_url        = TURN_URL,
        turn_username   = TURN_USERNAME,
        turn_credential = TURN_CREDENTIAL
    })
end

-- =============================================================================
-- Distance tracking
-- =============================================================================

local function updateDistances(dt)
    timer = timer + dt
    if timer < UPDATE_INTERVAL then return end
    timer = 0

    local myId = extensions.MPConfig.getPlayerServerID()
    if myId == -1 then return end

    local distances = extensions.MPVehicleGE.getDistanceMap()
    if not distances then return end

    local byPlayer = {}
    for gvid, dist in pairs(distances) do
        if not extensions.MPVehicleGE.isOwn(gvid) then
            local veh = extensions.MPVehicleGE.getVehicleByGameID(gvid)
            if veh and veh.ownerID ~= myId then
                local pid = veh.ownerID
                if not byPlayer[pid] or dist < byPlayer[pid] then byPlayer[pid] = dist end
            end
        end
    end

    local inRange, nowNearby = {}, {}
    for pid, dist in pairs(byPlayer) do
        if dist <= MAX_DISTANCE then
            table.insert(inRange, { id = pid, distance = dist })
            nowNearby[pid] = true
        end
    end

    local left = {}
    for pid in pairs(prevNearby) do
        if not nowNearby[pid] then table.insert(left, pid) end
    end

    guiTrigger("VOICE_DistanceUpdate", { myId = myId, players = inRange })
    if #left > 0 then guiTrigger("VOICE_PlayersLeft", left) end
    prevNearby = nowNearby
end

-- =============================================================================
-- Event handlers
-- =============================================================================

local function onVoiceConfig(data)
    local c = jsonDecode(data)
    if not c then return end
    if c.max_distance    then MAX_DISTANCE    = c.max_distance     end
    if c.fade_start      then FADE_START      = c.fade_start       end
    if c.master_volume   then MASTER_VOLUME   = c.master_volume    end
    if c.server_id       then SERVER_ID       = c.server_id        end
    if c.relay_url       then RELAY_URL       = c.relay_url        end
    if c.bridge_url      then BRIDGE_URL      = c.bridge_url       end
    if c.relay_token     then RELAY_TOKEN     = c.relay_token      end
    if c.turn_url        then TURN_URL        = c.turn_url         end
    if c.turn_username   then TURN_USERNAME   = c.turn_username    end
    if c.turn_credential then TURN_CREDENTIAL = c.turn_credential  end
    if c.force_ui_layout ~= nil then
        FORCE_LAYOUT = (c.force_ui_layout == true)
        layoutTimer  = 0; layoutApplied = false
    end
    sendConfig()
end

local function onVoiceSignal(data)      if data                then guiTrigger("VOICE_Signal", data)      end end
local function onVoicePlayerList(data)  if data                then guiTrigger("VOICE_PlayerList", data)  end end
local function onPitPlayerList(data)    if data and data ~= "" then guiTrigger("VOICE_PitNames", data)    end end
local function onVoiceBridgeToken(data) if data                then guiTrigger("VOICE_BridgeToken", data) end end
local function onVoiceStateUpdate(data) if data                then guiTrigger("VOICE_StateUpdate", data) end end

local function tryRegister()
    if M.registered_events then return end
    if type(AddEventHandler) ~= "function" then return end
    AddEventHandler("VOICE_Config",        onVoiceConfig,      "mpvc_cfg")
    AddEventHandler("VOICE_Signal",        onVoiceSignal,      "mpvc_sig")
    AddEventHandler("VOICE_PlayerList",    onVoicePlayerList,  "mpvc_plist")
    AddEventHandler("VOICE_BridgeToken",   onVoiceBridgeToken, "mpvc_btok")
    AddEventHandler("ECON_PlayerListData", onPitPlayerList,    "mpvc_econ")
    AddEventHandler("PIT_AUTH_NamesList",  onPitPlayerList,    "mpvc_pit")
    AddEventHandler("VOICE_StateUpdate",   onVoiceStateUpdate, "mpvc_state")
    M.registered_events = true
end

-- =============================================================================
-- Lifecycle
-- =============================================================================

local _origUpdate = nil

local function onExtensionLoaded()
    _origUpdate = MPGameNetwork.onUpdate
    MPGameNetwork.onUpdate = function(dt)
        _origUpdate(dt)
        if not M.registered_events then tryRegister() end
        cfgTimer = cfgTimer + dt
        if cfgTimer >= CFG_INTERVAL then cfgTimer = 0; sendConfig() end
        tryForceLayout(dt)
        updateDistances(dt)
    end
    tryRegister()
end

local function onExtensionUnloaded()
    if _origUpdate then
        MPGameNetwork.onUpdate = _origUpdate
        _origUpdate = nil
    end
    RemoveEventHandler("VOICE_Config",        "mpvc_cfg")
    RemoveEventHandler("VOICE_Signal",        "mpvc_sig")
    RemoveEventHandler("VOICE_PlayerList",    "mpvc_plist")
    RemoveEventHandler("VOICE_BridgeToken",   "mpvc_btok")
    RemoveEventHandler("ECON_PlayerListData", "mpvc_econ")
    RemoveEventHandler("PIT_AUTH_NamesList",  "mpvc_pit")
    RemoveEventHandler("VOICE_StateUpdate",   "mpvc_state")
    M.registered_events = false
    guiTrigger("VOICE_Disconnect", {})
end

-- =============================================================================
-- Exports
-- =============================================================================

_G.mpvcRequestBridge  = function()     if type(TriggerServerEvent) == "function" then TriggerServerEvent("VOICE_RequestBridge", "")  end end
_G.mpvcSignal         = function(json) if type(TriggerServerEvent) == "function" then TriggerServerEvent("VOICE_Signal", json)       end end
_G.mpvcHello          = function()     if type(TriggerServerEvent) == "function" then TriggerServerEvent("VOICE_Hello", "")          end end
_G.mpvcState          = function(s)    if type(TriggerServerEvent) == "function" then TriggerServerEvent("VOICE_State", tostring(s)) end end

M.onExtensionLoaded   = onExtensionLoaded
M.onExtensionUnloaded = onExtensionUnloaded

M.onInit = function() setExtensionUnloadMode(M, "manual") end

return M