"""
Production static server for the TAC Prediction Pool build (dist/).

Two roles, selected by the ADMIN env var:
  * PUBLIC (default)  — open, serves the app in public mode. Bind :8791.
  * ADMIN  (ADMIN=1) — HTTP Basic Auth required, serves the app in admin mode
                       (admin console visible). Bind :8792.

Both roles serve /app-config.json dynamically from deploy-config.json so the
site goes live for everyone once real values are filled in and the servers are
restarted — no rebuild needed.

Features:
  - Correct MIME types (Windows registry can mislabel .js, breaking ES modules).
  - SPA fallback: unknown non-asset paths serve index.html.
  - Telegram-Mini-App-safe security headers (no X-Frame-Options; permissive
    connect-src for user-configurable RPC + TON Connect).
  - Binds 127.0.0.1 only: reachable exclusively through the Cloudflare Tunnel.

Usage:
  python serve_prod.py                         # public, PORT=8791
  set ADMIN=1 && set PORT=8792 && python serve_prod.py   # admin, Basic Auth
"""
import base64
import http.server
import json
import os
import posixpath
import secrets
import socketserver
from urllib.parse import unquote, urlsplit

PORT = int(os.environ.get("PORT", "8791"))
HOST = os.environ.get("HOST", "127.0.0.1")
ADMIN = os.environ.get("ADMIN", "0") == "1"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DIRECTORY = os.path.join(BASE_DIR, "dist")
DEPLOY_CONFIG = os.path.join(BASE_DIR, "deploy-config.json")
AUTH_FILE = os.path.join(BASE_DIR, "admin-auth.json")
VALID_CHAINS = {"testnet", "mainnet", "local"}

EXT_MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".wasm": "application/wasm",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
}

# Telegram-Mini-App-safe CSP: permissive on connect/frame/wasm (wallets, TON
# Connect, user-configurable RPC); no frame-ancestors so Telegram can embed it.
#
# Cloudflare Web Analytics is auto-injected at the edge on the chaty.lol zone.
# static.cloudflareinsights.com lets its beacon.min.js load, and the RUM POST to
# cloudflareinsights.com is already covered by connect-src https:. CF ALSO
# injects a tiny inline bootstrap whose content (and therefore sha256) changes
# on every injection, so it can't be statically hash-allow-listed and we refuse
# to open 'unsafe-inline' for a finance dApp. That one inline snippet stays
# blocked — a harmless console warning, no app impact. For a fully clean console
# turn off Web Analytics "automatic setup" (and Rocket Loader) in the Cloudflare
# dashboard, or add the beacon manually via a first-party /assets script.
CSP = (
    "default-src 'self'; "
    "script-src 'self' 'wasm-unsafe-eval' https://telegram.org "
    "https://static.cloudflareinsights.com; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com data:; "
    "img-src 'self' data: blob: https:; "
    "connect-src 'self' https: wss:; "
    "frame-src 'self' https:; "
    "worker-src 'self' blob:; "
    "manifest-src 'self'; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self'"
)


def load_admin_creds():
    user = os.environ.get("ADMIN_USER")
    pw = os.environ.get("ADMIN_PASS")
    if user and pw:
        return user, pw
    try:
        with open(AUTH_FILE, encoding="utf-8") as fh:
            data = json.load(fh)
        return str(data.get("user", "")), str(data.get("pass", ""))
    except Exception:
        return "", ""


def load_app_config():
    """Read deploy-config.json fresh each request so a restart (or edit) goes
    live without a rebuild. Validates before trusting any value."""
    cfg = {"contract": "", "rpc": "", "chain": "testnet"}
    try:
        with open(DEPLOY_CONFIG, encoding="utf-8") as fh:
            data = json.load(fh)
        contract = str(data.get("contract", "")).strip()
        rpc = str(data.get("rpc", "")).strip()
        chain = str(data.get("chain", "testnet")).strip()
        if len(contract) == 42 and contract.startswith("0x"):
            try:
                int(contract, 16)
                cfg["contract"] = contract
            except ValueError:
                pass
        if rpc.startswith("http://") or rpc.startswith("https://"):
            cfg["rpc"] = rpc
        if chain in VALID_CHAINS:
            cfg["chain"] = chain
    except FileNotFoundError:
        pass
    except Exception:
        pass
    cfg["admin"] = ADMIN
    return cfg


ADMIN_USER, ADMIN_PASS = ("", "")
if ADMIN:
    ADMIN_USER, ADMIN_PASS = load_admin_creds()
    if not ADMIN_USER or not ADMIN_PASS:
        raise SystemExit(
            "ADMIN=1 but no credentials found. Set ADMIN_USER/ADMIN_PASS env "
            f"vars or create {AUTH_FILE} with {{\"user\": ..., \"pass\": ...}}."
        )


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    # ── auth ──
    def _authorized(self):
        if not ADMIN:
            return True
        header = self.headers.get("Authorization", "")
        if not header.startswith("Basic "):
            return False
        try:
            decoded = base64.b64decode(header[6:]).decode("utf-8", "replace")
            user, _, pw = decoded.partition(":")
        except Exception:
            return False
        # constant-time compare on both fields
        ok_user = secrets.compare_digest(user, ADMIN_USER)
        ok_pw = secrets.compare_digest(pw, ADMIN_PASS)
        return ok_user and ok_pw

    def _deny(self):
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Prediction Tac Admin", charset="UTF-8"')
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        body = b"401 Unauthorized"
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    # ── helpers ──
    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        return EXT_MIME.get(ext) or super().guess_type(path)

    def _resolve(self, path):
        parts = urlsplit(path)
        rel = unquote(parts.path)
        rel = posixpath.normpath(rel).lstrip("/")
        full = os.path.normpath(os.path.join(DIRECTORY, rel))
        if not full.startswith(os.path.normpath(DIRECTORY)):
            return None
        return full

    def _serve_app_config(self, head_only=False):
        body = json.dumps(load_app_config()).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def _apply_spa_fallback(self):
        full = self._resolve(self.path)
        if full is None or (not os.path.isfile(full) and not os.path.isdir(full)):
            _, ext = os.path.splitext(full or "")
            if not ext:
                self.path = "/index.html"

    # ── request handling ──
    def do_GET(self):
        if not self._authorized():
            return self._deny()
        parts = urlsplit(self.path)
        if parts.path == "/app-config.json":
            return self._serve_app_config()
        self._apply_spa_fallback()
        return super().do_GET()

    def do_HEAD(self):
        if not self._authorized():
            return self._deny()
        parts = urlsplit(self.path)
        if parts.path == "/app-config.json":
            return self._serve_app_config(head_only=True)
        self._apply_spa_fallback()
        return super().do_HEAD()

    def end_headers(self):
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        path = urlsplit(self.path).path
        if path.endswith((".html", "/")) or path == "/index.html" or path == "/app-config.json":
            self.send_header("Cache-Control", "no-store")
        elif "/assets/" in path:
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        super().end_headers()

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {self.address_string()} {fmt % args}")


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    if not os.path.isdir(DIRECTORY):
        raise SystemExit(f"dist/ not found at {DIRECTORY} - run the build first.")
    role = "ADMIN (Basic Auth)" if ADMIN else "PUBLIC"
    with Server((HOST, PORT), Handler) as httpd:
        print(f"[{role}] serving {DIRECTORY} on http://{HOST}:{PORT}")
        httpd.serve_forever()
