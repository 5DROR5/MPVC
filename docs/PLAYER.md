<p align="center">
  <img src="../logo.png" alt="MPVC Logo" width="140"/>
</p>

<h1 align="center">Player Guide</h1>

<p align="center">
  How to use MPVC on a server that already has it installed.
</p>

---

MPVC requires access to your microphone. There are **three ways** to set this up — pick whichever suits you best.

---

## Option 1 — Use your browser (no install)

The simplest option. No installation required, works on any PC.

**How it works:** Each time you want to talk, press the 🎙️ button in-game. A browser window will open asking for microphone permission — click **Allow**, then minimize the tab. That's it.

> This window needs to stay open (minimized is fine) for as long as you want to talk.

**Best for:** Players who join occasionally and don't want to install anything.

---

## Option 2 — Install MPVC.exe ✅ Recommended

A lightweight app that runs in your system tray. Once installed, the game detects it automatically — no browser window, no extra steps.

### Setup

**1.** Download **MPVC.exe** from the [Releases](../../../releases) page.

**2.** Run it. On first launch, it will ask:
> *"Would you like MPVC to start automatically with Windows?"*

Click **Yes** — from then on, MPVC starts silently in the background every time you boot your PC, and BeamMP is launched automatically.

**3.** That's it. Next time you join a server with MPVC, the 🎙️ button will work instantly — no prompts, no browser.

> **Tray icon:** ⚫ gray = idle (mic off), 🟢 green = mic active

> **Windows SmartScreen warning:** MPVC.exe is unsigned and built with PyInstaller, which causes some antivirus engines to flag it. This is a known false positive. Click **More info → Run anyway**, or use Option 3 to build from source.

---

## Option 3 — Build from source

Produces the exact same MPVC.exe as Option 2. Use this if you'd rather compile the code yourself and verify what you're running.

**Requirements:** Python 3.13+

```bat
cd MicBridge
build.bat
```

Output: `MicBridge/dist/MPVC.exe` — use it exactly like Option 2.

<details>
<summary>📖 Step-by-step guide for beginners</summary>

<br>

**Step 1 — Install Python**

Download and install **Python 3.13** from [python.org](https://www.python.org/downloads/).

During installation, check **"Add Python to PATH"** before clicking Install.

**Step 2 — Download the repository**

Click the green **Code** button on this page → **Download ZIP**, then extract it anywhere.

**Step 3 — Build**

Open the extracted folder, go into `MicBridge/`, and double-click **`build.bat`**.

A terminal window will open and install everything automatically (~30 seconds). When done:

```
Build successful!  dist\MPVC.exe
```

Move `MPVC.exe` from `MicBridge/dist/` to wherever you'd like to keep it, then follow Option 2 from Step 2.

</details>

---

## In-game controls

Once you're set up, two buttons appear in your HUD:

| Button | Mode | What it does |
|--------|------|--------------|
| 🎙️ | Talk & Listen | Opens your mic and lets you hear nearby players |
| 🔊 | Listen Only | Hear nearby players without opening your mic |

Press the active button again to deactivate.

### Nearby players panel

| Indicator | Meaning |
|-----------|---------|
| 🟢 Green dot | Player's mic is open |
| **Bold** name | Player is currently speaking |
| Strikethrough | Muted by you (click to unmute) |
