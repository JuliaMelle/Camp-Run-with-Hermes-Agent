from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent.parent
MAIN_DIR = ROOT / "main"
DB_PATH = ROOT / "data" / "store.db"
SKILL_PATH = ROOT / "skills" / "suki-team-skill" / "SKILL.md"
HERMES_COMMAND = os.environ.get("HERMES_COMMAND", "hermes")
MAX_REQUEST_BYTES = 32_768
MAX_TURNS = 12


def read_only_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH.as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def get_catalog(branch_id: str | None = None) -> dict:
    with read_only_connection() as connection:
        branches = [
            dict(row)
            for row in connection.execute(
                "SELECT id, code, name, city FROM branches "
                "WHERE has_delivery = 1 ORDER BY name"
            )
        ]
        if not branches:
            raise RuntimeError("No delivery branches are available in the Suki Mart database.")

        selected = next(
            (branch for branch in branches if str(branch["id"]) == str(branch_id)),
            next((branch for branch in branches if branch["code"] == "BGC"), branches[0]),
        )
        products = [
            dict(row)
            for row in connection.execute(
                "SELECT p.id, p.sku, p.name, p.category, p.unit, p.retail_price AS price, "
                "COALESCE(i.on_hand, 0) AS stock "
                "FROM products p "
                "LEFT JOIN inventory i ON i.product_id = p.id AND i.branch_id = ? "
                "WHERE p.is_active = 1 ORDER BY p.category, p.name",
                (selected["id"],),
            )
        ]
    return {"branches": branches, "selected_branch": selected, "products": products}


def build_prompt(messages: list[dict], context: dict) -> str:
    system = (
        "You are Suki, the helpful operations assistant for Suki Mart. "
        "Answer clearly and concisely. For supplier reliability, overdue purchase orders, "
        "and inventory-impact questions, use the configured Suki MCP tools and never invent "
        "figures. Do not create, cancel, or modify orders. For branch and basket context, "
        "use only the facts supplied below. If the configured tools cannot answer, say so."
    )
    if SKILL_PATH.is_file():
        system += "\n\nFollow this Suki Mart workflow when relevant:\n" + SKILL_PATH.read_text(encoding="utf-8")

    branch = str(context.get("branch", "Unknown branch"))[:120]
    cart = context.get("cart", [])
    cart_lines = []
    if isinstance(cart, list):
        for item in cart[:30]:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name", "Unknown item"))[:120]
            quantity = item.get("quantity", 0)
            price = item.get("unit_price", 0)
            if isinstance(quantity, int) and isinstance(price, (int, float)):
                cart_lines.append(f"- {name}: quantity {quantity}, unit price PHP {price:.2f}")
    context_text = f"Current branch: {branch}\nCurrent basket:\n" + ("\n".join(cart_lines) or "- Empty")
    transcript = "\n".join(
        f"{message['role'].capitalize()}: {message['content']}"
        for message in messages[-MAX_TURNS:]
    )
    return f"{system}\n\nCurrent storefront context:\n{context_text}\n\nConversation:\n{transcript}\n\nAssistant:"


class SukiRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(MAIN_DIR), **kwargs)

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _origin_is_local(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True
        parsed = urlparse(origin)
        return parsed.hostname in {"localhost", "127.0.0.1"} and parsed.port == self.server.server_port

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/status":
            self._send_json(200, {
                "hermes_available": bool(shutil.which(HERMES_COMMAND)),
                "catalog_available": DB_PATH.is_file(),
            })
            return
        if parsed.path == "/api/catalog":
            branch_id = parse_qs(parsed.query).get("branch_id", [None])[0]
            try:
                self._send_json(200, get_catalog(branch_id))
            except (OSError, sqlite3.Error, RuntimeError) as error:
                self._send_json(503, {"error": str(error)})
            return
        super().do_GET()

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/chat":
            self._send_json(404, {"error": "Not found."})
            return
        if not self._origin_is_local():
            self._send_json(403, {"error": "Requests must come from the local Suki Mart page."})
            return
        if self.headers.get_content_type() != "application/json":
            self._send_json(415, {"error": "Send a JSON chat request."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_REQUEST_BYTES:
                raise ValueError("Request size must be between 1 and 32 KB.")
            request = json.loads(self.rfile.read(length))
            messages = request.get("messages", [])
            context = request.get("context", {})
            if not isinstance(messages, list) or not messages:
                raise ValueError("Add a message before sending.")
            clean_messages = []
            for message in messages[-MAX_TURNS:]:
                if not isinstance(message, dict) or message.get("role") not in {"user", "assistant"}:
                    continue
                content = message.get("content")
                if isinstance(content, str) and content.strip():
                    clean_messages.append({"role": message["role"], "content": content.strip()[:1200]})
            if not clean_messages or clean_messages[-1]["role"] != "user":
                raise ValueError("The last conversation message must be from you.")
            if not isinstance(context, dict):
                context = {}
            prompt = build_prompt(clean_messages, context)
        except (ValueError, json.JSONDecodeError, TypeError) as error:
            self._send_json(400, {"error": str(error)})
            return

        if not shutil.which(HERMES_COMMAND):
            self._send_json(503, {"error": "Hermes CLI was not found. Set HERMES_COMMAND or add hermes to PATH."})
            return
        try:
            result = subprocess.run(
                [HERMES_COMMAND, "-z", prompt],
                cwd=ROOT,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=150,
                check=False,
            )
        except subprocess.TimeoutExpired:
            self._send_json(504, {"error": "Hermes took too long to respond. Please try again."})
            return
        except OSError:
            self._send_json(503, {"error": "Could not start Hermes. Check its installation and PATH."})
            return
        if result.returncode != 0 or not result.stdout.strip():
            self._send_json(502, {"error": "Hermes could not complete that request. Check the Hermes terminal for details."})
            return
        self._send_json(200, {"reply": result.stdout.strip()})

    def log_message(self, format: str, *args) -> None:
        if self.path.startswith("/api/"):
            super().log_message(format, *args)


def main() -> None:
    port = int(os.environ.get("PORT", "8765"))
    server = ThreadingHTTPServer(("127.0.0.1", port), SukiRequestHandler)
    print(f"Suki Mart with local Hermes chat: http://127.0.0.1:{port}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Suki Mart server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()