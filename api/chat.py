import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _suki import MAX_REQUEST_BYTES, forward, send_json  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0 or length > MAX_REQUEST_BYTES:
            send_json(self, 400, {"error": "Request size must be between 1 and 32 KB."})
            return
        status, payload = forward("POST", "/api/chat", self.rfile.read(length))
        send_json(self, status, payload)
