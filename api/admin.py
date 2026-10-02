import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _suki import send_json, tools  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            server = tools()
            send_json(self, 200, {
                "ranking": server.rank_supplier_reliability(),
                "impact": server.get_supplier_inventory_impact(top_n=8),
                "open_orders": server.find_at_risk_open_orders(limit=10),
                "decisions": server.get_supplier_decisions(),
            })
        except Exception as error:  # keep the page alive; report the error
            send_json(self, 500, {"error": str(error)})
