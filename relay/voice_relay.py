#!/usr/bin/env python3
# =============================================================================
# MPVC Voice Relay — WebRTC Signaling Server
# =============================================================================
import asyncio
import websockets
import logging
import json
import os
from urllib.parse import urlparse, parse_qs

logging.basicConfig(level=logging.INFO, format='[MPVC] %(message)s')

SERVERS_FILE = os.path.join(os.path.dirname(__file__), 'relay_servers.json')

def load_servers():
    try:
        with open(SERVERS_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        logging.warning("relay_servers.json not found — no servers authorized")
        return {}
    except Exception as e:
        logging.warning(f"Failed to load relay_servers.json: {e}")
        return {}

sessions = {}
buffers  = {}

async def handler(websocket):
    path       = websocket.request.path
    params     = parse_qs(urlparse(path).query)
    session_id = (params.get('id')     or [None])[0]
    role       = (params.get('role')   or [None])[0]
    token      = (params.get('token')  or [None])[0]

    if not session_id or role not in ('chrome', 'game'):
        await websocket.close(1008, "Missing id or role")
        return

    server_id = session_id.rsplit('_', 1)[0]
    servers   = load_servers()
    expected  = servers.get(server_id)
    if not expected or token != expected:
        logging.warning(f"Rejected {role} sid={session_id} (invalid token)")
        await websocket.close(1008, "Unauthorized")
        return

    other_role = 'game' if role == 'chrome' else 'chrome'

    if session_id not in sessions:
        sessions[session_id] = {}
        buffers[session_id]  = {'chrome': [], 'game': []}

    sessions[session_id][role] = websocket
    logging.info(f"+ {role} sid={session_id}")

    for msg in buffers[session_id][other_role]:
        try:
            await websocket.send(msg)
        except Exception:
            pass
    buffers[session_id][other_role] = []

    try:
        async for msg in websocket:
            other = sessions.get(session_id, {}).get(other_role)
            if other:
                try:
                    await other.send(msg)
                except Exception:
                    sessions[session_id].pop(other_role, None)
            else:
                buffers[session_id][role].append(msg)
    except Exception:
        pass
    finally:
        if session_id in sessions:
            sessions[session_id].pop(role, None)
            other = sessions[session_id].pop(other_role, None)
            if not sessions[session_id]:
                del sessions[session_id]
                buffers.pop(session_id, None)
            if other:
                close_code = 1000 if role == 'game' else 1001
                await other.close(close_code)
        logging.info(f"- {role} sid={session_id}")

async def main():
    async with websockets.serve(handler, "127.0.0.1", 8765):
        logging.info(f"MPVC Signaling Relay on ws://127.0.0.1:8765")
        logging.info(f"Servers file: {SERVERS_FILE}")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
