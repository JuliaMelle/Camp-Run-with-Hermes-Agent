import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _suki import ROOT, forward, send_json  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        status, payload = forward("GET", "/api/status", timeout=8)
        send_json(self, 200, {
            "hermes_available": bool(status == 200 and payload.get("hermes_available")),
            "catalog_available": (ROOT / "data" / "store.db").is_file(),
            "mode": "deployed",
        })
