import os
import sqlite3
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _suki import send_json, storefront  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        branch_id = parse_qs(urlparse(self.path).query).get("branch_id", [None])[0]
        try:
            send_json(self, 200, storefront().get_catalog(branch_id))
        except (OSError, sqlite3.Error, RuntimeError) as error:
            send_json(self, 503, {"error": str(error)})
