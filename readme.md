# MPVC — Proximity Voice Chat for BeamMP

A proximity voice chat system for BeamMP multiplayer servers.  
Players hear each other based on real-time vehicle distance — the closer you are, the louder the audio.

> **Client requirements:** Windows 10/11

---

## How It Works

MPVC uses a hybrid architecture combining a local mic bridge, WebRTC peer audio, and BeamMP server-side signaling.

```
[MPVC.exe]──WebSocket──[BeamNG UI]──WebRTC audio──[Other players' BeamNG UI]
                             │                              │
                       VOICE_Signal                  VOICE_Signal
                             │                              │
                        [Lua ext.]                   [Lua ext.]
                             └─────[BeamMP Server]──────────┘
                                    (signaling relay)
```

| Component | Role |
|-----------|------|
| **MPVC.exe** (MicBridge) | Captures microphone, serves raw PCM over `ws://localhost:7777` |
| **BeamNG UI mod** | Connects to MicBridge, manages WebRTC peer connections, fades volume by distance |
| **BeamNG Lua extension** | Calculates vehicle distances every 0.5s, routes signaling events to UI |
| **BeamMP server plugin** | Relays WebRTC offer/answer/ICE between players, pushes config on join |

---

## Repository Structure

```
MPVC/
├── Resources/
│   ├── Client/
│   │   └── MPVC.zip              ← BeamNG client mod (auto-distributed by BeamMP)
│   │       ├── lua/ge/extensions/mpvc.lua
│   │       ├── scripts/MPVC/modScript.lua
│   │       └── ui/modules/apps/MPVC/
│   │           ├── app.js
│   │           ├── app.html
│   │           ├── app.css
│   │           ├── app.json
│   │           └── app.png
│   └── Server/
│       └── MPVC/
│           ├── main.lua          ← BeamMP server plugin
│           └── config.json       ← Voice range configuration
└── MicBridge/
    ├── mic_bridge.py             ← MicBridge source
    ├── requirements.txt
    ├── build.bat                 ← Builds MPVC.exe
    └── icon.png
```

---

## Releases

Each release includes two files:

| File | For | Instructions |
|------|-----|--------------|
| `Resources.zip` | Server owners | Extract into your BeamMP server's root directory |
| `MPVC.exe` | Players | Run before launching BeamMP |

> MicBridge source code is available in the `MicBridge/` directory for those who prefer to build from source.

---

## Server Installation

1. Copy `Resources/Server/MPVC/` into your BeamMP server's `Resources/Server/` directory
2. Copy `Resources/Client/` contents into your BeamMP server's `Resources/Client/` directory
3. Restart the server

### Configuration (`Resources/Server/MPVC/config.json`)

| Key | Default | Description |
|-----|---------|-------------|
| `max_distance` | `150` | Distance in meters at which audio fully fades out |
| `fade_start` | `50` | Distance in meters at which fading begins |
| `master_volume` | `1.0` | Global volume multiplier (0.0 – 1.0) |

---

## Client Setup

### 1. Download and run MPVC.exe

Download **MPVC.exe** from the [Releases](../../releases) page and run it before launching BeamMP.

- **No installation required** — portable, single executable
- Appears in the system tray (⚫ gray = idle, 🟢 green = connected to game)
- Automatically launches BeamMP Launcher on startup
- Closes automatically when BeamMP Launcher is closed

> **Windows SmartScreen warning:** MPVC.exe is unsigned, so Windows may show a security prompt on first run.  
> Click **More info → Run anyway** to proceed.  
> You can verify the file on [VirusTotal](https://www.virustotal.com) before running.

### 2. Add the in-game app

Open the BeamNG app menu and add the **MPVC** app to your UI layout.

Two buttons will appear:

| Button | Mode | Behavior |
|--------|------|----------|
| 🎤 | Talk & Listen | Sends your mic audio and receives nearby players |
| 🔊 | Listen Only | Receives nearby players, mic is muted |

Clicking an active button again deactivates that mode.

---

## Building MicBridge from Source

Requires Python 3.13+ and pip.

```bat
cd MicBridge
build.bat
```

Output: `MicBridge/dist/MPVC.exe`

**Dependencies:**

| Package | Min. Version |
|---------|-------------|
| sounddevice | ≥ 0.5.5 |
| websockets | ≥ 16.0 |
| numpy | ≥ 2.1.0 |
| pystray | ≥ 0.19.0 |
| Pillow | ≥ 9.0.0 |

---

## License

| Component | License |
|-----------|---------|
| Server plugin & client mod | [AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html) |
| MicBridge | [MIT](https://opensource.org/licenses/MIT) |
