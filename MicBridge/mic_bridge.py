#!/usr/bin/env python3
# MPVC Mic Bridge
# Created by rtacyyv and 5DROR5
# License: MIT — https://opensource.org/licenses/MIT

import asyncio, sys, os, queue, threading, subprocess, argparse
from pathlib import Path

import numpy as np
import sounddevice as sd
from websockets.server import serve

SAMPLE_RATE = 48000
CHANNELS    = 1
CHUNK       = 960
DTYPE       = "float32"

_audio_q      = queue.Queue(maxsize=10)
_clients: set = set()
_loop         = None
_tray         = None

# ── Audio callback ────────────────────────────────────────────────────────────

def _on_audio(indata: np.ndarray, frames: int, time, status) -> None:
    if status and _tray is None:
        print(f"audio warning: {status}", file=sys.stderr)
    try:
        _audio_q.put_nowait(bytes(indata[:, 0].tobytes()))
    except queue.Full:
        pass

# ── WebSocket ─────────────────────────────────────────────────────────────────

async def _safe_send(ws, data: bytes) -> None:
    await ws.send(data)

async def _broadcast_loop() -> None:
    loop = asyncio.get_event_loop()
    while True:
        try:
            pcm = await loop.run_in_executor(
                None, lambda: _audio_q.get(timeout=0.05))
        except queue.Empty:
            continue
        if not _clients:
            continue
        dead = set()
        results = await asyncio.gather(
            *[_safe_send(ws, pcm) for ws in list(_clients)],
            return_exceptions=True,
        )
        for ws, r in zip(list(_clients), results):
            if isinstance(r, Exception):
                dead.add(ws)
        _clients.difference_update(dead)

async def _handler(ws) -> None:
    _clients.add(ws)
    _on_client_change()
    try:
        await ws.wait_closed()
    finally:
        _clients.discard(ws)
        _on_client_change()

def _on_client_change() -> None:
    if _tray is None:
        return
    n = len(_clients)
    _tray.icon  = _make_icon(n > 0)
    _tray.title = f"MPVC  ·  {n} client{'s' if n != 1 else ''} connected"

# ── BeamMP ────────────────────────────────────────────────────────────────────

def _launch_beammp() -> subprocess.Popen | None:
    for key in ("APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)"):
        p = Path(os.environ.get(key, "")) / "BeamMP-Launcher" / "BeamMP-Launcher.exe"
        if p.exists():
            return subprocess.Popen([str(p)])
    return None

def _watch_beammp(proc: subprocess.Popen, icon) -> None:
    proc.wait()
    icon.stop()
    os._exit(0)

# ── Async core ────────────────────────────────────────────────────────────────

async def _serve(device: int | None, port: int) -> None:
    with sd.InputStream(device=device, samplerate=SAMPLE_RATE,
                        channels=CHANNELS, dtype=DTYPE,
                        blocksize=CHUNK, callback=_on_audio):
        async with serve(_handler, "localhost", port):
            await _broadcast_loop()

def _run_async(device: int | None, port: int) -> None:
    global _loop
    _loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_loop)
    _loop.run_until_complete(_serve(device, port))

# ── Console mode ──────────────────────────────────────────────────────────────

def _run_console(device: int | None, port: int) -> None:
    print(f"MPVC Mic Bridge — ws://localhost:{port}")
    print("Ctrl+C to stop\n")
    print("Input devices:")
    default_in = sd.default.device[0]
    for i, dev in enumerate(sd.query_devices()):
        if dev["max_input_channels"] > 0:
            tag = " *" if i == default_in else ""
            print(f"  [{i}] {dev['name']}{tag}")
    chosen = device if device is not None else default_in
    print(f"\nUsing [{chosen}]: {sd.query_devices(chosen)['name']}\n")
    try:
        asyncio.run(_serve(chosen, port))
    except KeyboardInterrupt:
        print("\nStopped.")

# ── Tray mode ─────────────────────────────────────────────────────────────────

def _icon_path() -> str:
    base = sys._MEIPASS if getattr(sys, "frozen", False) else os.path.dirname(__file__)
    return os.path.join(base, "icon.png")

def _make_icon(active: bool):
    from PIL import Image
    img = Image.open(_icon_path()).convert("RGBA")
    return img if active else img.convert("LA").convert("RGBA")

def _make_device_action(idx: int, port: int):
    def _action(icon, item):
        _switch_device(icon, item, idx, port)
    return _action

def _switch_device(icon, item, idx: int, port: int) -> None:
    base  = [sys.executable] if getattr(sys, "frozen", False) else [sys.executable, sys.argv[0]]
    extra = [a for a in sys.argv[1:] if not a.startswith(("--device", "--no-beammp"))]
    subprocess.Popen(base + extra + [f"--device={idx}", "--no-beammp"])
    os._exit(0)

def _exit_tray(icon, item) -> None:
    icon.stop()
    os._exit(0)

def _run_tray(device: int | None, port: int, launch_beammp: bool) -> None:
    import pystray
    global _tray

    threading.Thread(target=_run_async, args=(device, port), daemon=True).start()

    current   = device if device is not None else sd.default.device[0]
    dev_items = [
        pystray.MenuItem(
            dev["name"],
            _make_device_action(i, port),
            checked=(lambda item, idx=i: idx == current),
            radio=True,
        )
        for i, dev in enumerate(sd.query_devices())
        if dev["max_input_channels"] > 0
    ]

    menu = pystray.Menu(
        pystray.MenuItem("MPVC Mic Bridge", None, enabled=False),
        pystray.MenuItem(f"Port {port}", None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Input Device", pystray.Menu(*dev_items)),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Exit", _exit_tray),
    )

    _tray = pystray.Icon("MPVC", _make_icon(False), "MPVC  ·  idle", menu)

    if launch_beammp:
        proc = _launch_beammp()
        if proc:
            threading.Thread(target=_watch_beammp, args=(proc, _tray),
                             daemon=True).start()

    _tray.run()

# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--device",    type=int,  default=None)
    parser.add_argument("--port",      type=int,  default=7777)
    parser.add_argument("--console",   action="store_true")
    parser.add_argument("--no-beammp", action="store_true")
    args = parser.parse_args()

    if not args.console:
        try:
            import pystray
            from PIL import Image  # noqa: F401
            _run_tray(args.device, args.port, not args.no_beammp)
            return
        except ImportError:
            print("pystray/Pillow not installed — falling back to console mode.")

    if not args.no_beammp:
        _launch_beammp()
    _run_console(args.device, args.port)

if __name__ == "__main__":
    main()