# /// script
# requires-python = ">=3.10"
# dependencies = ["mcp>=1.2,<2"]  # pinned: v1 API (FastMCP)
# ///
"""
LAYER 1 — MCP SERVER #1 (the hands): SUPPLIER RELIABILITY

A standalone, read-only MCP server over the Suki Mart sandbox (data/store.db),
exposing exactly four supplier-reliability tools:

    get_supplier_reliability
    get_supplier_history
    get_overdue_purchase_orders
    get_inventory_impact

The problem it solves: some suppliers habitually deliver late and short-ship,
which silently turns into stockouts. These four tools let an agent go from
"who is untrustworthy?" -> "prove it" -> "what does it cost us on shelf?"
-> "what is overdue right now?".

Run standalone to check it starts (Ctrl+C to stop):
    uv run mcp-server/server1.py

Register with Hermes (use the ABSOLUTE path to this file):
    hermes mcp add suki_suppliers --command uv --args run /ABS/PATH/mcp-server/server1.py
    # restart Hermes, then:
    hermes mcp test suki_suppliers

NOTE ON NAMING: the main server (server.py) already exposes tools with these
same four names under the MCP server id "suki". Registering BOTH servers at
once gives Hermes two identically named tools and the choice becomes
ambiguous. Either run this file instead of server.py, or keep both but rename
one set of tools before registering. This file is the isolated variant so it
can be developed and tested without disturbing the main server.

READ-ONLY BY DESIGN: this file never writes. The write path (raising a
purchase order) lives in server.py's create_purchase_order, and sandbox data
can always be reset with `python data/seed.py`.
"""
import os
import sqlite3
from typing import Any

from mcp.server.fastmcp import FastMCP

# The database path is resolved relative to THIS file, not the working
# directory -- Hermes launches MCP servers from its own folder.
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "store.db")

mcp = FastMCP("suki_suppliers")

# The sandbox's "today" lives in the data, not on the wall clock. Every
# "overdue" calculation must use this, never datetime.now().
SANDBOX_NOW = "2026-10-02"


def query(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    """Read helper: returns rows as dicts. Opens the DB read-only."""
    con = sqlite3.connect(f"file:{os.path.abspath(DB_PATH)}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in con.execute(sql, params).fetchall()]
    finally:
        con.close()


def _resolve_supplier(supplier: str | None) -> int | None:
    """Accept a supplier name fragment (case-insensitive) and return its id."""
    if not supplier:
        return None
    row = query(
        "SELECT id FROM suppliers WHERE name LIKE ? ORDER BY name LIMIT 1",
        (f"%{supplier}%",),
    )
    return row[0]["id"] if row else None


def _sandbox_now() -> str:
    """Read the sandbox's current date from the data itself.

    Falls back to the module constant if the key is missing, so the server
    still starts against a database without sandbox_info.
    """
    try:
        return query("SELECT value FROM sandbox_info WHERE key = 'sandbox_now'")[0]["value"]
    except (IndexError, KeyError):
        return SANDBOX_NOW


# --------------------------------------------------------------------------
# 1. Who can't be trusted?
# --------------------------------------------------------------------------
@mcp.tool()
def get_supplier_reliability(
    min_orders: int = 10,
    category: str | None = None,
    limit: int = 15,
) -> list[dict]:
    """Score every supplier on delivery reliability and rank the worst offenders.

    This is the entry point for "which suppliers can't be trusted to deliver
    on time?", "who keeps delaying us?", or "which vendors should we put on a
    watchlist / renegotiate with?".

    For each supplier, from closed purchase orders:
      - late_rate       = share of received orders that arrived AFTER the
                          promised expected_at date
      - avg_days_late / worst_days_late -- how far past due, in days
      - incomplete_rate = share of orders closed as partially_received (short-shipped)
      - avg_fill_rate   = units received / units ordered, on those short orders
      - short_value_php = peso value of units that never arrived

    Results are sorted worst-first, and each row carries a `risk` verdict of
    HIGH / MEDIUM / LOW so the agent can triage without re-deriving thresholds.

    A high late_rate alone is not damning if the lateness is small -- read
    avg_days_late and short_value_php together to judge real exposure. A
    supplier can be HIGH on punctuality, on fill rate, or on peso exposure;
    the three are independent failure modes.

    Args:
        min_orders: Only score suppliers with at least this many purchase orders
                    (default 10) to filter out one-off noise. Use 1 for all.
        category: Restrict to a category the supplier focuses on (e.g. "Produce").
        limit: Maximum suppliers to return.
    """
    sql = """
        WITH perf AS (
            SELECT
                s.id, s.name, s.category_focus, s.promised_lead_time_days,
                s.payment_terms, s.is_active,
                COUNT(po.id) AS orders_placed,
                SUM(CASE WHEN po.status = 'received' THEN 1 ELSE 0 END) AS orders_received,
                SUM(CASE WHEN po.status = 'partially_received' THEN 1 ELSE 0 END) AS orders_incomplete,
                SUM(CASE WHEN po.status = 'cancelled' THEN 1 ELSE 0 END) AS orders_cancelled,
                SUM(CASE WHEN po.status IN ('pending','in_transit','partially_received')
                         THEN 1 ELSE 0 END) AS orders_still_open,
                SUM(CASE WHEN po.status = 'received' AND po.received_at > po.expected_at
                         THEN 1 ELSE 0 END) AS orders_late,
                ROUND(AVG(CASE WHEN po.status = 'received' AND po.received_at > po.expected_at
                               THEN julianday(po.received_at) - julianday(po.expected_at) END), 1)
                    AS avg_days_late,
                ROUND(MAX(CASE WHEN po.status = 'received'
                               THEN julianday(po.received_at) - julianday(po.expected_at) END), 1)
                    AS worst_days_late,
                ROUND(AVG(CASE WHEN po.status = 'partially_received'
                               THEN 1.0 * po.received_quantity / po.quantity END), 2)
                    AS avg_fill_rate,
                ROUND(SUM(CASE WHEN po.status = 'partially_received'
                               THEN (po.quantity - po.received_quantity) * po.unit_cost ELSE 0 END), 0)
                    AS short_value_php
            FROM suppliers s
            LEFT JOIN purchase_orders po ON po.supplier_id = s.id
            GROUP BY s.id
        )
        SELECT
            name AS supplier,
            category_focus,
            promised_lead_time_days AS promised_lead_days,
            payment_terms,
            is_active,
            orders_placed,
            orders_received,
            orders_incomplete,
            orders_cancelled,
            orders_still_open,
            orders_late,
            ROUND(1.0 * orders_late / NULLIF(orders_received, 0), 2) AS late_rate,
            avg_days_late,
            worst_days_late,
            ROUND(1.0 * orders_incomplete / NULLIF(orders_placed, 0), 2) AS incomplete_rate,
            avg_fill_rate,
            short_value_php,
            CASE
                WHEN avg_days_late >= 2 OR (short_value_php >= 20000 AND avg_fill_rate < 0.7)
                    THEN 'HIGH'
                WHEN avg_days_late >= 0.7 OR short_value_php >= 10000 THEN 'MEDIUM'
                ELSE 'LOW'
            END AS risk
        FROM perf
        WHERE orders_placed >= ?
    """
    params: list[Any] = [min_orders]
    if category:
        sql += " AND category_focus = ?"
        params.append(category)
    sql += " ORDER BY avg_days_late DESC, short_value_php DESC LIMIT ?"
    params.append(limit)
    return query(sql, tuple(params))


# --------------------------------------------------------------------------
# 2. Show me the proof.
# --------------------------------------------------------------------------
@mcp.tool()
def get_supplier_history(
    supplier: str,
    only_late: bool = False,
    only_incomplete: bool = False,
    limit: int = 25,
) -> list[dict]:
    """Show one supplier's purchase order history with the delivery evidence,
    so a reliability score can be defended line by line.

    Use after get_supplier_reliability flags a supplier, to answer "show me
    the proof" / "which orders did they mess up?" before calling the supplier
    or switching away from them.

    Each row shows ordered vs received units, the promised `expected_at` vs the
    actual `received_at`, days_late (negative = early), and
    `supplier_avg_days_late` -- that supplier's own average lateness across all
    their orders -- so one bad PO is judged in context.

    Args:
        supplier: Supplier name or distinctive fragment (e.g. "Visayas",
                  "Tropika"). Case-insensitive partial match.
        only_late: Keep only orders that arrived after their expected date.
        only_incomplete: Keep only orders closed as partially_received.
        limit: Maximum rows to return.
    """
    sid = _resolve_supplier(supplier)
    if sid is None:
        return [{"error": f"No supplier matching '{supplier}'. Retry with part of the name."}]
    supplier_avg = query(
        "SELECT ROUND(AVG(CASE WHEN status = 'received' AND received_at > expected_at"
        " THEN julianday(received_at) - julianday(expected_at) END), 1) AS a"
        " FROM purchase_orders WHERE supplier_id = ? AND status = 'received'",
        (sid,),
    )[0]["a"]
    sql = """
        SELECT
            po.po_number,
            b.code AS branch,
            p.name AS product,
            p.category,
            po.quantity AS units_ordered,
            po.received_quantity AS units_received,
            (po.quantity - COALESCE(po.received_quantity, 0)) AS units_short,
            ROUND((po.quantity - COALESCE(po.received_quantity, 0)) * po.unit_cost, 0)
                AS short_value_php,
            po.unit_cost,
            po.status,
            po.ordered_at,
            po.expected_at,
            po.received_at,
            ROUND(julianday(po.received_at) - julianday(po.expected_at), 1) AS days_late,
            ? AS supplier_avg_days_late,
            po.notes
        FROM purchase_orders po
        JOIN branches b ON b.id = po.branch_id
        JOIN products p ON p.id = po.product_id
        WHERE po.supplier_id = ?
    """
    params: list[Any] = [supplier_avg, sid]
    if only_late:
        sql += " AND po.status = 'received' AND po.received_at > po.expected_at"
    if only_incomplete:
        sql += " AND po.status = 'partially_received'"
    sql += " ORDER BY po.ordered_at DESC LIMIT ?"
    params.append(limit)
    return query(sql, tuple(params))


# --------------------------------------------------------------------------
# 3. What should I chase today?
# --------------------------------------------------------------------------
@mcp.tool()
def get_overdue_purchase_orders(
    supplier: str | None = None,
    min_days_overdue: int = 0,
    stale_before: str | None = None,
    limit: int = 25,
) -> list[dict]:
    """Find restock orders still open and already past their promised date --
    the deliveries that are late RIGHT NOW, not historically.

    Use for "what should I chase today?", "which orders are overdue?", or
    "what is the branch waiting on?".

    Because a late inbound PO is what causes a stockout, each row also reports
    the affected branch+product's current days_of_cover, so the agent can
    separate an urgent chase from a cosmetic one. NULL days_of_cover means the
    item is comfortably stocked and the chase is not urgent.

    DATA QUIRK: the seed data contains stale `partially_received` orders from
    April 2026 that were never closed out. They are genuinely overdue but are
    bookkeeping leftovers, not live supply problems. Pass `stale_before`
    (e.g. "2026-06-01") to exclude them and see only recent, actionable delays.

    Args:
        supplier: Optional supplier name filter (partial match, case-insensitive).
        min_days_overdue: Only POs at least this many days past expected_at.
        stale_before: Ignore open POs whose expected_at is before this date
                      (YYYY-MM-DD) -- the standard way to skip stale records.
        limit: Maximum rows to return.
    """
    now = _sandbox_now()
    sql = """
        SELECT
            po.po_number,
            s.name AS supplier,
            b.code AS branch,
            b.name AS branch_name,
            p.name AS product,
            p.category,
            po.quantity AS units_ordered,
            po.received_quantity AS units_received,
            (po.quantity - COALESCE(po.received_quantity, 0)) AS units_short,
            po.status,
            po.expected_at,
            ROUND(julianday(?) - julianday(po.expected_at), 1) AS days_overdue,
            i.on_hand,
            ROUND(i.on_hand / NULLIF(i.avg_daily_sales, 0), 1) AS days_of_cover,
            i.avg_daily_sales,
            s.promised_lead_time_days AS promised_lead_days,
            po.notes
        FROM purchase_orders po
        JOIN suppliers s ON s.id = po.supplier_id
        JOIN branches  b ON b.id = po.branch_id
        JOIN products  p ON p.id = po.product_id
        LEFT JOIN inventory i ON i.branch_id = po.branch_id AND i.product_id = po.product_id
        WHERE po.status IN ('pending', 'in_transit', 'partially_received')
          AND julianday(?) - julianday(po.expected_at) >= ?
    """
    params: list[Any] = [now, now, min_days_overdue]
    sid = _resolve_supplier(supplier)
    if sid is not None:
        sql += " AND po.supplier_id = ?"
        params.append(sid)
    if stale_before:
        sql += " AND po.expected_at >= ?"
        params.append(stale_before)
    sql += " ORDER BY days_overdue DESC LIMIT ?"
    params.append(limit)
    return query(sql, tuple(params))


# --------------------------------------------------------------------------
# 4. So what actually breaks?
# --------------------------------------------------------------------------
@mcp.tool()
def get_inventory_impact(
    supplier: str,
    max_days_of_cover: float = 7.0,
    limit: int = 25,
) -> list[dict]:
    """Show the shelf damage caused by one unreliable supplier: which products
    it supplies are at or below reorder point, and how long they will last.

    This is the bridge from a supplier metric to a business consequence -- use
    it to answer "if we keep Tropika, what actually breaks?" or to build the
    case for switching vendors. `severity` flags OUT OF STOCK vs
    AT REORDER POINT, and `has_open_restock` says whether a late PO is already
    inbound, so you don't recommend a reorder that's on its way.

    IMPORTANT SCHEMA FACT: in this sandbox every product has exactly ONE
    supplier, so there is no drop-in substitute product. The business lever
    is the category, not the SKU.

    Args:
        supplier: Supplier name or distinctive fragment (e.g. "Tropika").
        max_days_of_cover: Only show items with at most this many days of stock.
        limit: Maximum rows.
    """
    sid = _resolve_supplier(supplier)
    if sid is None:
        return [{"error": f"No supplier matching '{supplier}'. Retry with part of the name."}]
    sql = """
        SELECT
            b.code AS branch,
            b.name AS branch_name,
            p.name AS product,
            p.category,
            i.on_hand,
            i.reorder_point,
            i.reorder_qty,
            i.avg_daily_sales,
            ROUND(i.on_hand / NULLIF(i.avg_daily_sales, 0), 1) AS days_of_cover,
            CASE WHEN i.on_hand = 0 THEN 'OUT OF STOCK'
                 WHEN i.on_hand <= i.reorder_point THEN 'AT REORDER POINT'
                 ELSE 'LOW' END AS severity,
            EXISTS (
                SELECT 1 FROM purchase_orders po
                WHERE po.branch_id = i.branch_id AND po.product_id = i.product_id
                  AND po.status IN ('pending','in_transit','partially_received')
            ) AS has_open_restock,
            (SELECT MAX(po2.received_at) FROM purchase_orders po2
              WHERE po2.product_id = i.product_id AND po2.supplier_id = ?
                AND po2.status = 'received') AS last_fulfilled_at
        FROM inventory i
        JOIN products p ON p.id = i.product_id
        JOIN branches b ON b.id = i.branch_id
        WHERE p.supplier_id = ?
          AND p.is_active = 1
          AND i.avg_daily_sales > 0
          AND i.on_hand <= i.reorder_point
          AND (i.on_hand / NULLIF(i.avg_daily_sales, 0)) <= ?
        ORDER BY days_of_cover ASC, i.on_hand ASC
        LIMIT ?
    """
    return query(sql, (sid, sid, max_days_of_cover, limit))


if __name__ == "__main__":
    mcp.run()