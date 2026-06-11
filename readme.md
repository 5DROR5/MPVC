<p align="center">
  <img src="logo.png" alt="MPVC Logo" width="180"/>
</p>

<h1 align="center">MPVC — Proximity Voice Chat for BeamMP</h1>

<p align="center">
  Players hear each other based on real-time vehicle distance — the closer you are, the louder the audio.
</p>

---

## Getting Started

| I want to… | |
|---|---|
| 🎮 Join a server that uses MPVC | [Player Guide →](docs/PLAYER.md) |
| 🖥️ Install MPVC on my server | [Server Guide →](docs/SERVER.md) |

---

## How It Works

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
| **MPVC.exe** (MicBridge) | Captures microphone on demand, serves raw PCM over `ws://localhost:7777` — mic only active while Talk is pressed |
| **BeamNG UI mod** | Manages WebRTC peer connections, fades volume by distance |
| **BeamNG Lua extension** | Calculates vehicle distances every 0.5s, routes signaling events to UI |
| **BeamMP server plugin** | Relays WebRTC offer/answer/ICE between players, pushes config on join |

---

## Repository Structure

```
MPVC/
├── Resources/
│   ├── Client/
│   │   └── MPVC.zip              ← BeamNG client mod (auto-distributed by BeamMP)
│   └── Server/
│       └── MPVC/
│           ├── main.lua          ← BeamMP server plugin
│           └── config.json
├── MicBridge/
│   ├── mic_bridge.py
│   ├── requirements.txt
│   ├── build.bat
│   └── icon.png
└── Relay/
    ├── voice_relay.py            ← WebRTC signaling relay (self-host)
    ├── relay_servers.json
    └── bridge.html               ← Browser voice bridge page (served alongside the relay)
```

---

## Credits

| | |
|-|-|
| **MicBridge & voice relay** | rtacyyv |

## License

| Component | License |
|-----------|---------|
| Server plugin & client mod | [AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html) |
| MicBridge & voice relay | [MIT](https://opensource.org/licenses/MIT) |
