-- =============================================================================
-- MPVC — Proximity Voice Chat  |   Client Extension
-- Version: 1.0.0               |   Author: 5DROR5
-- License: AGPL-3.0 — https://www.gnu.org/licenses/agpl-3.0.html
-- =============================================================================

local M = {}

-- =============================================================================
-- STATE
-- =============================================================================

local MAX_DISTANCE    = 150
local FADE_START      = 50
local MASTER_VOLUME   = 1.0

local prevNearby      = {}
local UPDATE_INTERVAL = 0.5
local CFG_INTERVAL    = 2.0
local timer           = 0
local cfgTimer        = 0

-- =============================================================================
-- HELPERS
-- =============================================================================

local function guiTrigger(event, data)
    if type(guihooks) == "table" and type(guihooks.trigger) == "function" then
        guihooks.trigger(event, data)
    end
end

-- =============================================================================
-- DISTANCE
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
                if not byPlayer[pid] or dist < byPlayer[pid] then
                    byPlayer[pid] = dist
                end
            end
        end
    end

    local inRange   = {}
    local nowNearby = {}

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
-- EVENTS
-- =============================================================================

local function onVoiceConfig(data)
    local c = jsonDecode(data)
    if not c then return end
    if c.max_distance  then MAX_DISTANCE  = c.max_distance  end
    if c.fade_start    then FADE_START    = c.fade_start    end
    if c.master_volume then MASTER_VOLUME = c.master_volume end
    guiTrigger("VOICE_Config", {
        max_distance  = MAX_DISTANCE,
        fade_start    = FADE_START,
        master_volume = MASTER_VOLUME
    })
end

local function onVoiceSignal(data)
    if data then guiTrigger("VOICE_Signal", data) end
end

local function tryRegister()
    if M.registered_events then return end
    if type(AddEventHandler) ~= "function" then return end
    AddEventHandler("VOICE_Config", onVoiceConfig)
    AddEventHandler("VOICE_Signal", onVoiceSignal)
    M.registered_events = true
end

-- =============================================================================
-- LIFECYCLE
-- =============================================================================

local function onExtensionLoaded()
    local origOnUpdate = MPGameNetwork.onUpdate
    MPGameNetwork.onUpdate = function(dt)
        origOnUpdate(dt)
        if not M.registered_events then tryRegister() end

        cfgTimer = cfgTimer + dt
        if cfgTimer >= CFG_INTERVAL then
            cfgTimer = 0
            guiTrigger("VOICE_Config", {
                max_distance  = MAX_DISTANCE,
                fade_start    = FADE_START,
                master_volume = MASTER_VOLUME
            })
        end

        updateDistances(dt)
    end
    tryRegister()
end

local function onExtensionUnloaded() end

-- =============================================================================
-- EXPORTS
-- =============================================================================

_G.mpvcSignal = function(json)
    if type(TriggerServerEvent) == "function" then
        TriggerServerEvent("VOICE_Signal", json)
    end
end

M.onExtensionLoaded   = onExtensionLoaded
M.onExtensionUnloaded = onExtensionUnloaded
M.onInit = function() setExtensionUnloadMode(M, "manual") end

return M