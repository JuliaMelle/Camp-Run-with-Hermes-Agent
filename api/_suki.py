"""Shared helpers for the Vercel serverless functions in api/.

Vercel serves the static storefront from main/ and these functions under /api.
Data endpoints read data/store.db directly (read-only). The chat endpoint is a
thin proxy: Hermes cannot run inside a short-lived serverless function, so
/api/chat forwards to main/chat_server.py running on your own machine,
exposed through a tunnel (see DEPLOY.md).

Environment variables (set in the Vercel project settings):
    HERMES_CHAT_URL   public tunnel URL of your local chat_server.py,
                      e.g. https://suki-chat.example.com (no trailing slash)
    SUKI_CHAT_SECRET  shared secret; must match the value chat_server.py uses
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHAT_URL = os.environ.get("HERMES_CHAT_URL", "").strip().rstrip("/")
CHAT_SECRET = os.environ.get("SUKI_CHAT_SECRET", "").strip()
MAX_REQUEST_BYTES = 32_768


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def storefront():
    """main/chat_server.py: catalog queries (stdlib only)."""
    return sys.modules.get("suki_storefront") or _load("suki_storefront", ROOT / "main" / "chat_server.py")


def tools():
    """mcp-server/server.py: the same tool functions Hermes calls over MCP."""
    return sys.modules.get("suki_tools") or _load("suki_tools", ROOT / "mcp-server" / "server.py")


def send_json(handler: BaseHTTPRequestHandler, status: int, payload) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def forward(method: str, path: str, body: bytes | None = None, timeout: float = 280):
    """Call the local chat server through the tunnel. Returns (status, payload)."""
    if not CHAT_URL:
        return 503, {"error": "Hermes chat is not connected to this deployment yet (HERMES_CHAT_URL is not set)."}
    request = urllib.request.Request(f"{CHAT_URL}{path}", data=body, method=method)
    request.add_header("Content-Type", "application/json")
    request.add_header("User-Agent", "suki-vercel-proxy")
    if CHAT_SECRET:
        request.add_header("X-Suki-Secret", CHAT_SECRET)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read() or b"{}")
        except ValueError:
            return error.code, {"error": f"Hermes host answered HTTP {error.code}."}
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return 503, {"error": "Hermes is offline right now. The chat works while the team's Hermes host is running."}
