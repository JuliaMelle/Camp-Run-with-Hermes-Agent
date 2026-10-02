---
name: supplier-watch
description: Investigate Suki Mart supplier reliability and determine whether supplier delays are creating current purchase-order, inventory, or stockout risk. Use when users ask about late suppliers, overdue purchase orders, supplier performance, or inventory threatened by delayed deliveries.
---

# Supplier Watch

## Purpose

Do not simply list suppliers. Investigate the operational consequences of chronic lateness.

## When to use this skill

Use this skill when a Suki Mart operations manager, procurement manager,
branch manager, or other user asks about:

- unreliable or chronically late suppliers
- supplier performance or reliability
- overdue purchase orders
- delayed supplier deliveries
- inventory threatened by incoming shipment delays
- products that may stock out because a supplier is late
- operational consequences of supplier lateness

Do not use this skill merely to list every supplier. Its purpose is to
connect historical supplier reliability with current operational risk.

## Tools this skill uses

1. `mcp_suki_find_chronically_late_suppliers`
   - Use first for the direct "which suppliers are chronically late?" question.
   - The current server rule is at least 75% late delivered POs, at least 2 average days late, and at least 5 delivered POs by default.

2. `mcp_suki_get_supplier_scorecard`
   - Use for a specific supplier after the chronic-lateness list identifies a concern.
   - Shows the supplier profile, worst POs, affected branches, products, and any category-level alternatives returned by the server.

3. `mcp_suki_find_at_risk_open_orders`
   - Use to find unresolved pending or in-transit POs from unreliable suppliers.
   - This is the preferred current-risk query because it includes stock coverage, expected arrival, supplier lateness, and urgency.

4. `mcp_suki_get_overdue_purchase_orders`
   - Use when the user explicitly asks for overdue PO details.
   - For this sandbox demo, pass a recent `stale_before` cutoff so stale April–June partial-delivery bookkeeping records do not dominate the results.

5. `mcp_suki_get_supplier_inventory_impact`
   - Use for the end-to-end inventory and revenue-impact analysis.
   - Returns stock coverage, stockout status, days without stock, branch/product rollups, and estimated revenue exposure.

6. `mcp_suki_get_supplier_history`
   - Use when line-by-line PO evidence is needed for a named supplier.

## Procedure

When asked about supplier reliability:

1. Call `mcp_suki_find_chronically_late_suppliers`.

2. Identify suppliers that show repeated late deliveries rather than
treating a single late order as proof of chronic unreliability.

3. If the user asks about a particular supplier, call
`mcp_suki_get_supplier_scorecard` and use `mcp_suki_get_supplier_history`
only when individual PO evidence is needed.

4. Call `mcp_suki_find_at_risk_open_orders` for suppliers of concern.

5. If the user explicitly asks for overdue PO rows, call
`mcp_suki_get_overdue_purchase_orders` with a recent `stale_before` cutoff.

6. Clearly distinguish:
   - historical supplier reliability
   - currently overdue purchase orders

7. If there are current at-risk orders or the user asks about inventory,
call `mcp_suki_get_supplier_inventory_impact`.

8. For every immediate inventory risk, explain:
   - supplier
   - overdue purchase order
   - days overdue
   - branch
   - affected product
   - current stock
   - estimated days of stock coverage
   - financial or revenue exposure, if returned by the tool

9. Assign operational urgency using the risk rules below, while also
preserving the server's `STOCKED_OUT`, `WILL_STOCK_OUT`, and `OK` statuses.

10. Recommend no more than three practical actions.

11. Never invent data that was not returned by the MCP tools.

## Inventory risk levels

### CRITICAL

If `days_of_stock <= 2`:

State:
"Immediate escalation or sourcing review is warranted."

### HIGH

If `2 < days_of_stock <= 4`:

State:
"Contact supplier and prepare contingency sourcing."

### MEDIUM

If `4 < days_of_stock <= 7`:

State:
"Monitor the delivery closely."

### LOW

If `days_of_stock > 7`:

State:
"Supplier reliability remains a concern, but immediate stockout risk is limited."

If `days_of_stock` is unavailable or cannot be calculated, do not infer
or invent the risk level. State that inventory impact could not be determined
from the available data.

## Supplier recommendation guardrail

Do not name or recommend an alternative supplier unless the MCP data
explicitly establishes that the alternative supplier can supply the affected product.

If no verified alternative supplier relationship exists, say:

"Recommend initiating an alternate sourcing review."

Do NOT say:

"Buy from XYZ Supplier instead."

unless the database explicitly supports that relationship.

## Evidence and interpretation rules

- Do not label a supplier chronically late based on one delayed PO.
- Distinguish historical supplier performance from current operational risk.
- Do not claim a delayed PO will definitely cause a stockout.
- Use "at risk of stockout" when stock coverage is low.
- Do not invent revenue exposure if the MCP tool does not return enough information to calculate it.
- Do not invent alternate suppliers.
- Do not assume an overdue PO is cancelled.
- Clearly state when data is insufficient.

## Output format

Start with a one-sentence summary of the most important finding.

Then separate the analysis into:

### Historical Supplier Risk

Show, when available:
- supplier
- completed POs
- late POs
- late rate
- average delay
- partial delivery count

### Current Operational Risk

Show, when available:
- supplier
- PO
- branch
- product
- days overdue
- days of stock
- risk level

### Recommended Actions

Give no more than three actions, ordered from most urgent to least urgent.
Recommendations must be supported by MCP data.
