---
name: suki-team-skill
description: >-
  Supplier Reliability Agent for Suki Mart. Use when someone asks which
  suppliers are late, unreliable or sending incomplete orders, which incoming
  purchase orders to chase, or what a supplier problem is costing. Triggers:
  "supplier report", "late suppliers", "who should we stop ordering from",
  "which POs are at risk", "supplier scorecard".
---

# Supplier Reliability Agent

Audience: the procurement / operations head. Goal: find chronically late or
short-shipping suppliers, show the damage, and say what to do about it.

## Tools this skill uses

0. `mcp_suki_find_chronically_late_suppliers` — the headline list: late on 75%+ of orders AND 2+ days late on average.
1. `mcp_suki_rank_supplier_reliability` — all suppliers ranked worst to best (grade A-D).
2. `mcp_suki_get_supplier_scorecard` — one supplier: worst POs, worst branches, better alternatives.
3. `mcp_suki_find_at_risk_open_orders` — open POs from unreliable suppliers, with branch stock cover.
3b. `mcp_suki_get_supplier_inventory_impact` — days of stock, affected branches/products, revenue exposure (PHP) for the late suppliers.
4. `mcp_suki_estimate_supplier_cost` — peso / unit impact for one supplier.
5. `mcp_suki_describe_sandbox` — only if the data model is unclear.

## Procedure

1. Call `find_chronically_late_suppliers` for the headline list, then
   `rank_supplier_reliability` for context. Treat the chronically late
   suppliers as the focus (and grade **C** ones only as "watch").
2. For each of the worst 1-2 suppliers, call `get_supplier_scorecard` and
   `estimate_supplier_cost`.
3. Call `find_at_risk_open_orders`. Focus on rows with `urgency = HIGH`
   (stock will run out before the order is likely to arrive).
3b. Call `get_supplier_inventory_impact` to quantify the shelf impact: how
   many branch/product pairs are stocked out or will run out before restock,
   which branches and products are hit hardest, and the total revenue exposure.
   Rows with `has_open_po = false` and a stock-out mean **nobody has reordered**:
   call these out first.
4. Recommend, using these rules:
   - Grade D: escalate to the supplier contact, ask for a corrective plan, and
     move new orders to a `better_alternatives_same_category` supplier if one exists.
   - Grade C: put on watch, no change yet.
   - HIGH-urgency open PO: chase the supplier today (use the contact in the
     scorecard) and, if cover is under 3 days, suggest an emergency order from
     an alternative supplier.
5. Do not place or cancel any order. Only suggest. Ask before taking any action.

## Output format

- **Headline:** one sentence with the worst supplier and its main number
  (e.g. "Visayas Canning is late on 88% of orders, 6.3 days on average").
- **Table:** `supplier | grade | avg days late | % late | fill rate | open POs`.
- **Cost:** the peso/unit impact for the worst supplier(s).
- **Shelf impact:** total revenue exposure in PHP, the top 3 branches and top 3
  products, and a table `branch | product | days of stock | days until restock | exposure PHP`.
  State that exposure = lost sales during the gap, an estimate from average daily sales.
- **Chase today:** a table of HIGH-urgency POs: `PO | branch | product | cover days | likely arrival`.
- **Next actions:** max 3, each tied to a number from the data.

## Pitfalls

- "Today" is **2026-09-30** (sandbox). Never use the real date.
- Late = received after `expected_at`; short = received less than ordered.
  Cancelled POs and POs not yet received are not counted in the scores.
- A supplier with few delivered POs (under 5) is not graded; don't call it reliable or unreliable.
- A high fill rate does not make a supplier good if it is also very late; report both.
