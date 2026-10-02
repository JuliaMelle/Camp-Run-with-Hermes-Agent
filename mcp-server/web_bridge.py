# /// script
# requires-python = ">=3.10"
# dependencies = ["mcp>=1.2,<2"]
# ///
"""
WEB BRIDGE: serves the Suki MCP tools over local HTTP so the storefront in
main/ (a browser app) can use them. A browser cannot speak MCP over stdio, so
this calls the same Python tool functions that server.py exposes to Hermes.

    uv run mcp-server/web_bridge.py        # http://localhost:8765

    GET /api/branches
    GET /api/availability?branch=CUB&names=Fresh%20Milk%201L&names=Tomatoes%20kg
    GET /api/suppliers/late
    GET /api/admin                  (everything the admin page shows)
"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import server

PORT = 8765


def route(path: str, qs: dict) -> object:
    if path == "/api/branches":
        return server.list_branches(qs.get("city", [None])[0])
    if path == "/api/availability":
        return server.check_product_availability(qs.get("branch", [""])[0], qs.get("names", []))
    if path == "/api/admin":
        return {
            "ranking": server.rank_supplier_reliability(),
            "impact": server.get_supplier_inventory_impact(top_n=8),
            "open_orders": server.find_at_risk_open_orders(limit=10),
            "decisions": server.get_supplier_decisions(),
        }
    if path == "/api/suppliers/late":
        return server.find_chronically_late_suppliers()
    return None


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        try:
            data = route(url.path, parse_qs(url.query))
            code = 200 if data is not None else 404
            body = json.dumps(data if data is not None else {"error": "not found"}).encode()
        except Exception as exc:  # keep the demo alive; report the error to the caller
            code, body = 500, json.dumps({"error": str(exc)}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print(f"Suki web bridge on http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
