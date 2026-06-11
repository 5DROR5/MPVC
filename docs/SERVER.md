<p align="center">
  <img src="../logo.png" alt="MPVC Logo" width="140"/>
</p>

<h1 align="center">Server Guide</h1>

---

## Installation

**1.** Copy `Resources/Server/MPVC/` into your BeamMP server's `Resources/Server/` directory.

**2.** Copy `Resources/Client/` contents into your BeamMP server's `Resources/Client/` directory.

**3.** Edit `Resources/Server/MPVC/config.json` (see below).

**4.** Restart the server.

---

## Configuration (`config.json`)

| Key | Default | Description |
|-----|---------|-------------|
| `server_id` | `"server_id"` | Unique identifier for your server (used by the relay) |
| `max_distance` | `100` | Distance in meters at which audio fully fades out |
| `fade_start` | `70` | Distance in meters at which fading begins |
| `master_volume` | `1.0` | Global volume multiplier (0.0 – 1.0) |
| `force_ui_layout` | `true` | Auto-load the MPVC app into every joining player's UI layout |
| `relay_url` | — | WebSocket URL of the signaling relay |
| `bridge_url` | — | URL of the browser voice bridge page |
| `relay_token` | — | Auth token for the relay (kept server-side, never sent to clients) |
| `relay_register_url` | — | Endpoint used to issue per-session bridge tokens |
| `turn_url` | — | TURN server URL for players behind restrictive NAT |
| `turn_creds_url` | — | Endpoint used to fetch per-player TURN credentials |

---

## Relay

The browser voice bridge (Option 1 in the player guide) requires a WebRTC signaling relay — a small server that brokers the connection between the player's browser and the game.

There are two ways to provide one:

### Option A — Self-host (recommended, no key required)

The full relay source code is available in the [`Relay/`](MPVC/relay) directory. This option has no restrictions whatsoever and is the preferred approach — you stay in full control of your infrastructure and there are no dependencies on third-party availability.

Setting it up requires a Linux server with a public IP, nginx, and a valid TLS certificate. Straightforward if you're comfortable with server administration.

> **Note:** MPVC.exe (MicBridge) does **not** use the relay at all — it connects directly to the game. If all your players use MicBridge, you don't need a relay.

### Option B — Hosted relay key

Hosted relay keys are **completely free** — no payment, no strings attached.

Access is currently limited to servers with regular daily activity and an established community. The goal is to open this up to everyone — for now, it's a matter of making sure the load stays manageable first.

If your server qualifies, reach out on the official **[Discord server](https://discord.gg/HVKcvAJYpZ)** — include your server name and a short description of your community.
