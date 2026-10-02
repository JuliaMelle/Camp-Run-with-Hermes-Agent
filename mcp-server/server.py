# /// script
# requires-python = ">=3.10"
# dependencies = ["mcp>=1.2,<2"]  # pinned: v1 API (FastMCP) — what most docs & AI assistants use
# ///
"""
LAYER 1 — MCP SERVER (the hands)

Your team's MCP server over the Suki Mart sandbox (data/store.db).

Run standalone to check it starts (Ctrl+C to stop):
    uv run mcp-server/server.py

Register with Hermes (use the ABSOLUTE path to this file):
    hermes mcp add suki --command uv --args run /ABSOLUTE/PATH/TO/mcp-server/server.py
    # restart Hermes, then:
    hermes mcp test suki

Rules of thumb for good tools:
  * One tool = one business question. Name it like a verb phrase:
      find_stockout_risks, list_overdue_tickets, draft_winback_list ...
  * A generic "run any SQL" tool scores low with the judges. Keep SQL inside
    your tools; expose clear parameters (branch_code, days, limit ...).
  * Return small, structured results (lists of dicts). The agent reasons
    better over 20 clean rows than 2,000 raw ones.
  * Write the docstring for the AI: it's what Hermes reads to decide when to
    call your tool and what to pass.
"""
import os
import sqlite3
from typing import Any

from mcp.server.fastmcp import FastMCP

# The database path is resolved relative to THIS file, not the working
# directory — Hermes launches MCP servers from its own folder.
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "store.db")

mcp = FastMCP("suki")  # rename to your team's server name


def query(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    """Read helper: returns rows as dicts."""
    con = sqlite3.connect(f"file:{os.path.abspath(DB_PATH)}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in con.execute(sql, params).fetchall()]
    finally:
        con.close()


def execute(sql: str, params: tuple = ()) -> int:
    """Write helper: returns affected row count. Use for tools that take action
    (e.g. resolve a ticket, create a purchase order). Reset data anytime with
    `python data/seed.py`."""
    con = sqlite3.connect(os.path.abspath(DB_PATH))
    try:
        cur = con.execute(sql, params)
        con.commit()
        return cur.rowcount
    finally:
        con.close()


# --------------------------------------------------------------------------
# Scaffolding — helps the agent (and you) explore. Keep or remove.
# --------------------------------------------------------------------------
@mcp.tool()
def describe_sandbox() -> dict:
    """Describe the Suki Mart sandbox: business context, the current date
    inside the data ("sandbox_now"), and every table with its columns and
    row count. Call this first when you need to understand the data."""
    info = {r["key"]: r["value"] for r in query("SELECT key, value FROM sandbox_info")}
    tables = {}
    for t in query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        name = t["name"]
        cols = [f'{c["name"]} {c["type"]}' for c in query(f"PRAGMA table_info({name})")]
        count = query(f"SELECT COUNT(*) AS n FROM {name}")[0]["n"]
        tables[name] = {"rows": count, "columns": cols}
    return {"info": info, "tables": tables}


# --------------------------------------------------------------------------
# Example domain tool — shows the pattern. Replace it with your own.
# --------------------------------------------------------------------------
@mcp.tool()
def list_branches(city: str | None = None) -> list[dict]:
    """List Suki Mart branches with their code, type, city and whether they
    offer delivery. Optionally filter by city (e.g. "Quezon City")."""
    sql = "SELECT code, name, branch_type, city, area, has_delivery FROM branches"
    if city:
        return query(sql + " WHERE city = ? ORDER BY code", (city,))
    return query(sql + " ORDER BY code")


# --------------------------------------------------------------------------
# SUPPLIER RELIABILITY tools
# "Late" = received_at later than expected_at. "Short" = received_quantity <
# quantity. Only received / partially_received POs have a delivery to judge.
# --------------------------------------------------------------------------
SANDBOX_NOW = "2026-09-30 21:00:00"  # fixed "today" inside the data

_DELIVERED = "p.received_at IS NOT NULL AND p.status IN ('received','partially_received')"
_LATE_DAYS = "(julianday(p.received_at) - julianday(p.expected_at))"


def _grade(avg_late: float, pct_late: float, fill_rate: float) -> str:
    if avg_late >= 3 or pct_late >= 50 or fill_rate < 90:
        return "D - unreliable"
    if avg_late >= 1.5 or pct_late >= 25 or fill_rate < 95:
        return "C - watch"
    if avg_late >= 0.5 or pct_late >= 10:
        return "B - ok"
    return "A - reliable"


@mcp.tool()
def rank_supplier_reliability(min_orders: int = 5, limit: int = 18) -> list[dict]:
    """Rank ALL suppliers from worst to best on delivery reliability. Per
    supplier: delivered PO count, average and worst days late, % of POs more
    than 1 day late, fill rate (% of ordered quantity actually received),
    number of short deliveries, a grade (A-D) and how many POs are still open.
    Use this first for "which suppliers are chronically late / unreliable?"."""
    rows = query(
        f"""
        SELECT s.id AS supplier_id, s.name AS supplier, s.category_focus,
               s.promised_lead_time_days AS promised_lead_days,
               COUNT(*) AS delivered_pos,
               ROUND(AVG({_LATE_DAYS}), 1) AS avg_days_late,
               ROUND(MAX({_LATE_DAYS}), 1) AS worst_days_late,
               ROUND(100.0 * SUM({_LATE_DAYS} > 1) / COUNT(*), 0) AS pct_pos_late,
               SUM(p.received_quantity < p.quantity) AS short_deliveries,
               ROUND(100.0 * SUM(p.received_quantity) / SUM(p.quantity), 1) AS fill_rate_pct
        FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id
        WHERE {_DELIVERED}
        GROUP BY s.id HAVING COUNT(*) >= ?
        ORDER BY avg_days_late DESC, fill_rate_pct ASC
        LIMIT ?
        """,
        (min_orders, limit),
    )
    open_counts = {
        r["supplier_id"]: r["n"]
        for r in query(
            "SELECT supplier_id, COUNT(*) AS n FROM purchase_orders "
            "WHERE status IN ('pending','in_transit') GROUP BY supplier_id"
        )
    }
    for r in rows:
        r["grade"] = _grade(r["avg_days_late"], r["pct_pos_late"], r["fill_rate_pct"])
        r["open_pos"] = open_counts.get(r["supplier_id"], 0)
    return rows


@mcp.tool()
def find_chronically_late_suppliers(
    min_late_rate_pct: float = 75, min_avg_days_late: float = 2, min_orders: int = 5
) -> list[dict]:
    """Return ONLY the chronically late suppliers: those whose delivered POs
    arrive after the expected date at least min_late_rate_pct % of the time
    (any lateness counts) AND average at least min_avg_days_late days late.
    Includes short-delivery counts and fill rate. Use this for a direct
    "who is chronically late?" answer; use rank_supplier_reliability to see
    every supplier."""
    return query(
        f"""
        SELECT s.id AS supplier_id, s.name AS supplier, s.category_focus,
               s.promised_lead_time_days AS promised_lead_days,
               COUNT(*) AS delivered_pos,
               ROUND(100.0 * SUM({_LATE_DAYS} > 0) / COUNT(*), 0) AS late_rate_pct,
               ROUND(AVG({_LATE_DAYS}), 1) AS avg_days_late,
               ROUND(MAX({_LATE_DAYS}), 1) AS worst_days_late,
               SUM(p.received_quantity < p.quantity) AS short_deliveries,
               ROUND(100.0 * SUM(p.received_quantity) / SUM(p.quantity), 1) AS fill_rate_pct
        FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id
        WHERE {_DELIVERED}
        GROUP BY s.id
        HAVING COUNT(*) >= ? AND late_rate_pct >= ? AND avg_days_late >= ?
        ORDER BY avg_days_late DESC
        """,
        (min_orders, min_late_rate_pct, min_avg_days_late),
    )


@mcp.tool()
def get_supplier_scorecard(supplier_id: int, worst_n: int = 5) -> dict:
    """Deep-dive on ONE supplier (use the supplier_id from
    rank_supplier_reliability). Returns the supplier profile, its worst late
    or short POs, which branches suffer most, which products are affected, and
    better-graded alternative suppliers in the same category."""
    sup = query("SELECT * FROM suppliers WHERE id = ?", (supplier_id,))
    if not sup:
        return {"error": f"No supplier with id {supplier_id}"}
    worst = query(
        f"""
        SELECT p.po_number, b.code AS branch, pr.name AS product, p.quantity,
               p.received_quantity, p.expected_at, p.received_at,
               ROUND({_LATE_DAYS}, 1) AS days_late, p.notes
        FROM purchase_orders p
        JOIN branches b ON b.id = p.branch_id JOIN products pr ON pr.id = p.product_id
        WHERE p.supplier_id = ? AND {_DELIVERED}
        ORDER BY days_late DESC, (p.quantity - p.received_quantity) DESC LIMIT ?
        """,
        (supplier_id, worst_n),
    )
    by_branch = query(
        f"""
        SELECT b.code AS branch, COUNT(*) AS delivered_pos,
               ROUND(AVG({_LATE_DAYS}), 1) AS avg_days_late,
               SUM(p.received_quantity < p.quantity) AS short_deliveries
        FROM purchase_orders p JOIN branches b ON b.id = p.branch_id
        WHERE p.supplier_id = ? AND {_DELIVERED}
        GROUP BY b.id ORDER BY avg_days_late DESC LIMIT 5
        """,
        (supplier_id,),
    )
    # Alternatives: same category_focus, graded with the same rules.
    peers = [
        r for r in rank_supplier_reliability(min_orders=5)
        if r["category_focus"] == sup[0]["category_focus"] and r["supplier_id"] != supplier_id
    ]
    alts = [
        {k: r[k] for k in ("supplier_id", "supplier", "avg_days_late", "fill_rate_pct", "grade")}
        for r in peers if r["grade"].startswith(("A", "B"))
    ][:3]
    return {
        "supplier": {k: sup[0][k] for k in ("id", "name", "category_focus", "contact_person",
                                            "phone", "email", "promised_lead_time_days",
                                            "payment_terms")},
        "worst_pos": worst,
        "worst_branches": by_branch,
        "better_alternatives_same_category": alts,
    }


@mcp.tool()
def find_at_risk_open_orders(min_avg_days_late: float = 1.5, limit: int = 20) -> list[dict]:
    """Find OPEN purchase orders (pending / in_transit) placed with unreliable
    suppliers (average lateness >= min_avg_days_late days), and show how
    exposed the branch is: current stock, days of cover, days the PO is already
    overdue as of sandbox_now, and its value in PHP. Most urgent first. Use for
    "which incoming orders should I chase today?"."""
    bad = {
        r["supplier_id"]: r["avg_days_late"]
        for r in rank_supplier_reliability(min_orders=5)
        if r["avg_days_late"] >= min_avg_days_late
    }
    if not bad:
        return []
    marks = ",".join("?" * len(bad))
    rows = query(
        f"""
        SELECT p.po_number, s.id AS supplier_id, s.name AS supplier, b.code AS branch,
               pr.name AS product, p.quantity, p.status, p.expected_at,
               ROUND(julianday(?) - julianday(p.expected_at), 1) AS days_overdue,
               ROUND(p.quantity * p.unit_cost, 0) AS po_value_php,
               i.on_hand,
               CASE WHEN i.avg_daily_sales > 0
                    THEN ROUND(i.on_hand / i.avg_daily_sales, 1) END AS days_of_cover
        FROM purchase_orders p
        JOIN suppliers s ON s.id = p.supplier_id
        JOIN branches b ON b.id = p.branch_id
        JOIN products pr ON pr.id = p.product_id
        LEFT JOIN inventory i ON i.branch_id = p.branch_id AND i.product_id = p.product_id
        WHERE p.status IN ('pending','in_transit') AND p.supplier_id IN ({marks})
        ORDER BY days_of_cover IS NULL, days_of_cover ASC, days_overdue DESC
        LIMIT ?
        """,
        (SANDBOX_NOW, *bad.keys(), limit),
    )
    for r in rows:
        r["supplier_avg_days_late"] = bad[r["supplier_id"]]
        # Realistic wait = time to the promised date (0 if already overdue) plus
        # this supplier's typical lateness. HIGH = stock runs out before that.
        wait = max(0.0, -r["days_overdue"]) + r["supplier_avg_days_late"]
        r["likely_days_until_arrival"] = round(wait, 1)
        cover = r["days_of_cover"]
        r["urgency"] = "HIGH" if cover is not None and cover < wait else "NORMAL"
    rows.sort(key=lambda r: (r["urgency"] != "HIGH", r["days_of_cover"] if r["days_of_cover"] is not None else 1e9))
    return rows


@mcp.tool()
def get_supplier_inventory_impact(supplier_id: int | None = None, top_n: int = 10) -> dict:
    """Inventory impact of late suppliers: for every product a late supplier
    provides, at every branch, compute days of stock (on_hand / avg daily
    sales), whether it is already stocked out or will run out before the
    replenishment arrives, and the revenue exposure in PHP (lost sales during
    the gap). Replenishment time = days until the open PO's expected date (or
    the supplier's promised lead time if no PO is open) PLUS the supplier's
    typical lateness. Defaults to the chronically late suppliers; pass
    supplier_id to analyse one supplier. Returns a summary, per-branch and
    per-product rollups, and the top_n worst product/branch rows. Use for
    "what is the supplier problem doing to our shelves and sales?"."""
    if supplier_id is None:
        sup = {r["supplier_id"]: r for r in find_chronically_late_suppliers()}
    else:
        sup = {r["supplier_id"]: r for r in rank_supplier_reliability(min_orders=1)
               if r["supplier_id"] == supplier_id}
    if not sup:
        return {"summary": {"suppliers": 0}, "note": "No matching late suppliers."}
    marks = ",".join("?" * len(sup))
    rows = query(
        f"""
        SELECT s.id AS supplier_id, s.name AS supplier, s.promised_lead_time_days AS lead,
               b.code AS branch, pr.name AS product, pr.retail_price, pr.cost_price,
               i.on_hand, i.reorder_point, i.avg_daily_sales,
               (SELECT MIN(po.expected_at) FROM purchase_orders po
                 WHERE po.branch_id = i.branch_id AND po.product_id = i.product_id
                   AND po.status IN ('pending','in_transit')) AS open_po_expected
        FROM inventory i
        JOIN products pr ON pr.id = i.product_id
        JOIN suppliers s ON s.id = pr.supplier_id
        JOIN branches b ON b.id = i.branch_id
        WHERE pr.supplier_id IN ({marks}) AND i.avg_daily_sales > 0
        """,
        tuple(sup.keys()),
    )
    now_days = query("SELECT julianday(?) AS d", (SANDBOX_NOW,))[0]["d"]
    out = []
    for r in rows:
        late = sup[r["supplier_id"]]["avg_days_late"]
        if r["open_po_expected"]:
            exp = query("SELECT julianday(?) AS d", (r["open_po_expected"],))[0]["d"]
            base = max(0.0, exp - now_days)
        else:
            base = float(r["lead"])
        wait = round(base + late, 1)
        cover = round(r["on_hand"] / r["avg_daily_sales"], 1)
        gap = round(max(0.0, wait - cover), 1)
        status = ("STOCKED_OUT" if r["on_hand"] <= 0
                  else "WILL_STOCK_OUT" if gap > 0 else "OK")
        out.append({
            "supplier": r["supplier"], "branch": r["branch"], "product": r["product"],
            "on_hand": r["on_hand"], "days_of_stock": cover,
            "days_until_restock": wait, "days_without_stock": gap,
            "has_open_po": bool(r["open_po_expected"]), "status": status,
            "revenue_exposure_php": round(gap * r["avg_daily_sales"] * r["retail_price"]),
            "margin_exposure_php": round(
                gap * r["avg_daily_sales"] * (r["retail_price"] - r["cost_price"])),
        })
    at_risk = [r for r in out if r["status"] != "OK"]

    def rollup(key: str) -> list[dict]:
        agg: dict[str, dict] = {}
        for r in at_risk:
            a = agg.setdefault(r[key], {key: r[key], "at_risk_rows": 0, "revenue_exposure_php": 0})
            a["at_risk_rows"] += 1
            a["revenue_exposure_php"] += r["revenue_exposure_php"]
        return sorted(agg.values(), key=lambda a: -a["revenue_exposure_php"])

    return {
        "summary": {
            "late_suppliers": [s["supplier"] for s in sup.values()],
            "product_branch_pairs_checked": len(out),
            "already_stocked_out": sum(r["status"] == "STOCKED_OUT" for r in out),
            "will_stock_out_before_restock": sum(r["status"] == "WILL_STOCK_OUT" for r in out),
            "total_revenue_exposure_php": sum(r["revenue_exposure_php"] for r in at_risk),
            "total_margin_exposure_php": sum(r["margin_exposure_php"] for r in at_risk),
        },
        "by_branch": rollup("branch")[:6],
        "by_product": rollup("product")[:6],
        "worst_rows": sorted(at_risk, key=lambda r: -r["revenue_exposure_php"])[:top_n],
    }


@mcp.tool()
def estimate_supplier_cost(supplier_id: int) -> dict:
    """Estimate what one supplier's unreliability costs: total late days,
    PHP value of quantity never delivered (short deliveries), and how many
    stock-outs at branches currently coincide with an open PO from this
    supplier. Use to put a peso figure on the problem for the pitch."""
    short = query(
        f"""
        SELECT COUNT(*) AS short_pos,
               COALESCE(SUM(p.quantity - p.received_quantity), 0) AS missing_units,
               ROUND(COALESCE(SUM((p.quantity - p.received_quantity) * p.unit_cost), 0), 0)
                   AS missing_value_php
        FROM purchase_orders p
        WHERE p.supplier_id = ? AND {_DELIVERED} AND p.received_quantity < p.quantity
        """,
        (supplier_id,),
    )[0]
    late = query(
        f"""
        SELECT COUNT(*) AS late_pos, ROUND(COALESCE(SUM({_LATE_DAYS}), 0), 0) AS total_days_late
        FROM purchase_orders p WHERE p.supplier_id = ? AND {_DELIVERED} AND {_LATE_DAYS} > 1
        """,
        (supplier_id,),
    )[0]
    waiting = query(
        """
        SELECT COUNT(*) AS n FROM purchase_orders p
        JOIN inventory i ON i.branch_id = p.branch_id AND i.product_id = p.product_id
        WHERE p.supplier_id = ? AND p.status IN ('pending','in_transit') AND i.on_hand <= 0
        """,
        (supplier_id,),
    )[0]["n"]
    return {"supplier_id": supplier_id, **late, **short, "stockouts_waiting_on_open_po": waiting}


if __name__ == "__main__":
    mcp.run()
