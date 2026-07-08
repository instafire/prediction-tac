import http.server
import os
import socketserver

PORT = int(os.environ.get("PORT", "8080"))
DIRECTORY = "/home/workspace/Projects/tac-prediction-pool/frontend/dist"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def log_message(self, format, *args):
        print(f"[{self.address_string()}] {format % args}")

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving Prediction Pool on port {PORT}")
    httpd.serve_forever()
