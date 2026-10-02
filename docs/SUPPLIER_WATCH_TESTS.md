# Supplier Watch Test Cases

These are the natural-language checks for the Supplier Watch workflow. The MCP
server currently returns empty arrays for the four teammate-owned SQL TODOs.

## 1. Historical supplier reliability

**Question:** Which suppliers are chronically late?

**Expected primary tool:** `get_supplier_reliability`

**Expected behavior:** Do not label a supplier chronically late from one delayed
purchase order. State clearly when the tool returns no data.

## 2. Currently overdue purchase orders

**Question:** Show me currently overdue purchase orders.

**Expected primary tool:** `get_overdue_purchase_orders`

**Expected behavior:** Distinguish unresolved current purchase-order risk from
historical supplier reliability.

## 3. Full operational impact

**Question:** What inventory is threatened by supplier delays?

**Expected flow:**

`get_overdue_purchase_orders` → `get_inventory_impact`

Optional context: `get_supplier_reliability`

**Expected behavior:** Use the skill's CRITICAL/HIGH/MEDIUM/LOW rules only when
`days_of_stock` is returned. Say “at risk of stockout,” not that a stockout is
certain.

## 4. Specific supplier investigation

**Question:** Why is Tropika Juice Corp considered unreliable?

**Expected flow:**

`get_supplier_reliability` → `get_supplier_history`

If relevant: `get_overdue_purchase_orders` → `get_inventory_impact`

**Expected behavior:** Base the explanation on returned purchase-order evidence.

## 5. Alternative supplier guardrail

**Question:** Which supplier should replace Tropika Juice Corp?

**Expected behavior:** Do not invent an alternative. If the database does not
verify another supplier-product relationship, say:

> The available data does not establish a verified alternative supplier for the
affected products. Recommend initiating an alternate sourcing review.

## Parameter validation checks

These must fail before any future SQL executes:

- `get_supplier_reliability(min_completed_orders=0)`
- `get_supplier_reliability(limit=101)`
- `get_supplier_history(supplier_id=-5)`
- `get_overdue_purchase_orders(branch_code="")`
- `get_inventory_impact()` without `supplier_id` or `purchase_order_id`
