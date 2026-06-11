#!/usr/bin/env python3
# =============================================================================
# MPVC Voice Relay | WebRTC Signaling + TURN Credential Service
# Version: 1.0.4   | Created by rtacyyv and 5DROR5
# License: MIT — https://opensource.org/licenses/MIT
# =============================================================================
import asyncio, websockets, logging, json, os, hmac, hashlib, base64, time
import threading, secrets as _secrets
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

logging.basicConfig(level=logging.INFO, format='[MPVC] %(message)s')

SERVERS_FILE = os.path.join(os.path.dirname(__file__), 'relay_servers.json')
TURN_SECRET  = os.environ.get('MPVC_TURN_SECRET', '')
TURN_URL     = os.environ.get('MPVC_TURN_URL', 'turn:mpvc.ddns.net:3478')
HTTP_PORT    = int(os.environ.get('MPVC_HTTP_PORT', '8766'))

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

def gen_turn_creds(session_id):
    expiry     = str(int(time.time()) + 86400)
    username   = expiry + ':' + session_id
    credential = base64.b64encode(
        hmac.new(TURN_SECRET.encode(), username.encode(), hashlib.sha1).digest()
    ).decode()
    return username, credential

_session_tokens: dict = {}
_tokens_lock = threading.Lock()

class _Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            n    = int(self.headers.get('Content-Length', 0))
            data = json.loads(self.rfile.read(n))
        except Exception:
            return self._send(400, {'error': 'bad request'})

        servers      = load_servers()
        server_id    = data.get('server_id', '')
        master_token = data.get('master_token', '')
        expected     = servers.get(server_id)

        if not expected or master_token != expected:
            return self._send(401, {'error': 'unauthorized'})

        if self.path == '/register':
            session_id = data.get('session_id', '')
            if not session_id:
                return self._send(400, {'error': 'missing session_id'})
            token = _secrets.token_urlsafe(32)
            with _tokens_lock:
                _session_tokens[session_id] = token
            self._send(200, {'token': token})

        elif self.path == '/turn-creds':
            if not TURN_SECRET:
                return self._send(503, {'error': 'TURN not configured'})
            player_id = data.get('player_id', '')
            u, c = gen_turn_creds(f"{server_id}_{player_id}")
            self._send(200, {'turn_username': u, 'turn_credential': c, 'turn_url': TURN_URL})

        else:
            self._send(404, {'error': 'not found'})

    def _send(self, status, body):
        b = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(b))
        self.end_headers()
        self.wfile.write(b)

    def log_message(self, *_):
        pass

def _start_http():
    HTTPServer(('127.0.0.1', HTTP_PORT), _Handler).serve_forever()

sessions = {}
buffers  = {}

async def handler(websocket):
    path       = websocket.request.path
    params     = parse_qs(urlparse(path).query)
    session_id = (params.get('id')    or [None])[0]
    role       = (params.get('role')  or [None])[0]
    token      = (params.get('token') or [None])[0]

    if not session_id or role not in ('chrome', 'game'):
        await websocket.close(1008, "Missing id or role")
        return

    server_id = session_id.rsplit('_', 1)[0]
    servers   = load_servers()
    expected  = servers.get(server_id)
    one_time  = _session_tokens.get(session_id)

    if not expected or (token != expected and token != one_time):
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
                with _tokens_lock:
                    _session_tokens.pop(session_id, None)
            if other:
                close_code = 1000 if role == 'game' else 1001
                try:
                    await other.close(close_code)
                except Exception:
                    pass
        logging.info(f"- {role} sid={session_id}")

async def main():
    threading.Thread(target=_start_http, daemon=True).start()
    logging.info(f"MPVC HTTP on http://127.0.0.1:{HTTP_PORT}")
    async with websockets.serve(handler, "127.0.0.1", 8765):
        logging.info(f"MPVC Signaling on ws://127.0.0.1:8765")
        logging.info(f"Servers file: {SERVERS_FILE}")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
