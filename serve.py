import http.server
import os
import socketserver

PORT = int(os.environ.get("PORT", "8080"))

# Serve the built frontend. Default is resolved relative to this file so the
# server runs on any host; override with SERVE_DIR when the layout differs.
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DIRECTORY = os.environ.get("SERVE_DIR", os.path.join(BASE_DIR, "frontend", "dist"))

# Security headers.
#
# Intentionally permissive where the dApp needs it:
#   - No X-Frame-Options / frame-ancestors: the app runs as a Telegram Mini App
#     embedded in a Telegram iframe/webview, so framing must NOT be blocked.
#   - connect-src allows any https/wss host: the RPC endpoint is user-configurable
#     and TON Connect talks to many wallet/bridge origins.
#   - script-src allows the Telegram SDK; 'wasm-unsafe-eval' covers wallet/TON
#     crypto that compiles WebAssembly. style-src 'unsafe-inline' is required by
#     the app's dynamic inline styles and Google Fonts.
# The tightened bits (object-src, base-uri, form-action) are safe wins.
# NOTE: validate this CSP against a real Telegram + wallet session before relying
# on it; loosen a directive here if a legitimate resource is blocked.
CSP = (
    "default-src 'self'; "
    # static.cloudflareinsights.com lets Cloudflare's auto-injected Web Analytics
    # beacon.min.js load. CF's inline bootstrap has a per-injection hash so it
    # can't be statically allow-listed; it stays blocked (harmless console
    # warning). Disable CF "automatic setup"/Rocket Loader for a clean console.
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

SECURITY_HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        for name, value in SECURITY_HEADERS.items():
            self.send_header(name, value)
        super().end_headers()

    def log_message(self, format, *args):
        print(f"[{self.address_string()}] {format % args}")


with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving Prediction Pool on port {PORT} from {DIRECTORY}")
    httpd.serve_forever()
