<p align="center">
  <img src="logo.png" alt="MPVC Logo" width="180"/>
</p>

<h1 align="center">MPVC — Proximity Voice Chat Extension for BeamMP</h1>

<p align="center">
  Players hear each other based on real-time vehicle distance — the closer you are, the louder the audio.
</p>

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
| **MPVC.exe** (MicBridge) | Captures microphone on demand and serves raw PCM over `ws://localhost:7777` — mic is only active while Talk is pressed |
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
| `MPVC.exe` | Players | Run before or alongside BeamMP |

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
| `force_ui_layout` | `true` | Automatically load the MPVC app into every joining player's UI layout |

---

## Client Setup

> **Came here from an in-game prompt?**  
> The app is already loaded — skip to [Step 1](#1-download-and-run-mpvcexe), download MPVC.exe, close the game, run MPVC.exe and it will relaunch BeamMP automatically.

### 1. Download and run MPVC.exe

Download **MPVC.exe** from the [Releases](../../releases) page and run it before launching BeamMP.

- **No installation required** — portable, single executable
- Appears in the system tray (⚫ gray = idle, 🟢 green = mic active)
- **Microphone is only active while Talk is pressed in-game** — silent at all other times
- On first launch, a setup dialog will ask if you'd like MPVC to start automatically with Windows
- Automatically launches BeamMP Launcher on startup
- Closes automatically when BeamMP Launcher is closed

> **Windows SmartScreen / antivirus warning:** MPVC.exe is unsigned and built with PyInstaller,
> which causes some antivirus engines to flag it as suspicious — this is a known false positive.
> Click **More info → Run anyway** to proceed, or build from source to verify the code yourself.

#### Optional — Run automatically with Windows

On first launch, MPVC will ask if you'd like it to start automatically with Windows. Click **Yes** and it will add itself to your startup folder automatically.

> This takes effect after the next Windows restart.

### 2. In-game setup

Open the BeamNG app menu and add the **MPVC** app to your UI layout.

> If the server has `force_ui_layout` enabled, this step is done automatically on join.

### 3. Controls

Two buttons will appear in your HUD:

| Button | Mode | Behavior |
|--------|------|----------|
| 🎙️ | Talk & Listen | Activates microphone, sends your audio and receives nearby players |
| 🔊 | Listen Only | Receives nearby players without activating your microphone |

Clicking an active button again deactivates that mode.

### 4. Nearby players panel

While connected, a live panel shows all players on the server running MPVC:

- 🟢 **Green name** — player has their mic open
- **Bold white** — player is currently speaking near you
- **Strikethrough** — player is muted by you locally (click their name to mute/unmute)

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
| sounddevice | ≥ 0.5.0 |
| websockets | ≥ 12.0 |
| numpy | ≥ 2.0.0 |
| pystray | ≥ 0.19.0 |
| Pillow | ≥ 10.0.0 |

> Never built a Python project before? See the [step-by-step guide for beginners](#) below.

<details>
<summary>📖 Step-by-step guide for beginners</summary>

<br>

Building from source produces **the exact same MPVC.exe** as the one in the Releases page — no difference whatsoever.
This option exists for players who prefer to compile the code themselves and verify what they're running rather than downloading a pre-built executable.

**Step 1 — Install Python**

Download and install **Python 3.13** from [python.org](https://www.python.org/downloads/).

During installation, make sure to check **"Add Python to PATH"** before clicking Install.  
This is required — without it, the next steps will not work.

**Step 2 — Download the repository**

On this page, click the green **Code** button → **Download ZIP**, then extract the ZIP anywhere on your computer.

**Step 3 — Build**

Open the extracted folder, go into `MicBridge/`, and double-click **`build.bat`**.

A terminal window will open and install everything automatically. This takes about 30 seconds. When it's done you'll see:

```
Build successful!  dist\MPVC.exe
Press any key to continue...
```

Close the terminal window.

A `dist\` folder has been created inside `MicBridge/` — move `MPVC.exe` from there to wherever you'd like to keep it.
> Note: Running MPVC.exe creates a Resources folder next to it. This is separate from the Resources folder created by a normal BeamMP launch

The build folder you downloaded from GitHub is no longer needed and can be deleted.

</details>
---

## Credits

| | |
|-|-|
| **MicBridge** | rtacyyv |
---

## License

| Component | License |
|-----------|---------|
| Server plugin & client mod | [AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html) |
| MicBridge | [MIT](https://opensource.org/licenses/MIT) |