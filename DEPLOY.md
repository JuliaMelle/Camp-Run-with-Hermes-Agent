# Deploying Suki Mart to Vercel

```
Browser ──> Vercel (static main/ + api/*.py)
              ├─ /api/catalog, /api/admin  → read data/store.db directly
              └─ /api/chat, /api/status    → proxy ──> tunnel ──> your PC: main/chat_server.py ──> hermes -z (+ Suki MCP tools)
```

Vercel hosts the storefront, the admin page and the data. Hermes runs on **your
machine**. A serverless function can't host the agent: answers take about a
minute and need the local MCP server. So the chat works **while your PC, the
chat server and the tunnel are running**. Otherwise the widget shows "Hermes
offline" and the rest of the site still works.

## 1. Import the repo in Vercel (one time)

1. On vercel.com, go to **Add New… → Project** and import `JuliaMelle/Camp-Run-with-Hermes-Agent`.
2. Framework preset: **Other**. Leave Root Directory empty. `vercel.json` sets the rest
   (static output `main/`, Python functions in `api/`, and bundles `data/store.db`).
3. Click **Deploy**. The storefront, catalog and admin dashboard work right away.

## 2. Run Hermes + the tunnel on your PC (whenever you want live chat)

```bash
cd ~/path/to/Camp-Run-with-Hermes-Agent
export SUKI_CHAT_SECRET='pick-a-long-random-string'
# Provider/model are optional overrides. Leave them out if `hermes -z "hi"` already works.
HERMES_PROVIDER=opencode HERMES_MODEL=claude-opus-5-5 python3 main/chat_server.py   # :8765

# second terminal: expose it publicly
cloudflared tunnel --url http://127.0.0.1:8765
# prints https://<random>.trycloudflare.com
```

A quick tunnel gets a new URL every time it starts. For a stable URL, use a
named Cloudflare tunnel (`cloudflared tunnel login` / `create` / `route dns`).

## 3. Point Vercel at the tunnel

In Vercel, open **Project → Settings → Environment Variables** and add:

| Name | Value |
|---|---|
| `HERMES_CHAT_URL` | the tunnel URL, e.g. `https://xyz.trycloudflare.com` (no trailing slash) |
| `SUKI_CHAT_SECRET` | the same string you exported in step 2 |

Then go to **Deployments → ⋯ → Redeploy**, because environment variables only apply to new deployments.

## Security notes

- Requests that come through the tunnel without the matching `X-Suki-Secret`
  header are rejected (403). Only the Vercel proxy knows the secret.
- `hermes -z` auto-approves tool calls. The prompt tells Suki to stay read-only,
  but anyone with the site URL can spend your model credits while the tunnel is
  up. Stop the tunnel when you are not demoing.

## Local development (unchanged)

- Storefront + chat: `python3 main/chat_server.py`, then open http://127.0.0.1:8765
- Admin data bridge: `uv run mcp-server/web_bridge.py` (serves http://localhost:8766, used by `admin.html` on localhost)
