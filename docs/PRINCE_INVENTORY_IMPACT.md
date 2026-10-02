## Inventory Impact SQL (Prince)

**Main Objective:** Build the data intelligence behind Hermes that shows which currently overdue purchase orders actually threaten branch stock, so a manager knows what to act on first.

**Workflow & Stack:** Suki Mart DB -> purchase_orders + inventory + products + branches + suppliers -> Our SQL -> Days of stock + risk level per overdue PO -> MCP (`get_inventory_impact`) -> Hermes

**Main Problem Question:** Of the POs that are overdue right now, which ones could leave a branch without stock?

**Secondary Problem Question:** How many days of stock is left? How long has the PO been overdue? How much daily revenue is exposed? Which branches and products?

**Wanted Results:** `get_inventory_impact(supplier_id=None)`

---

## Definitions

| Term | Rule |
|---|---|
| Sandbox now | `sandbox_info.sandbox_now` = 2026-09-30 21:00:00 (never the real clock) |
| Overdue PO | `received_at IS NULL AND expected_at < sandbox_now AND status NOT IN ('received','cancelled')` |
| days_overdue | `sandbox_now - expected_at`, in days, 1 decimal |
| days_of_stock | `on_hand / avg_daily_sales`. If `avg_daily_sales = 0` then `null` (no divide) |
| daily_revenue_exposure_php | `avg_daily_sales x retail_price`. This is *potential* exposure, not guaranteed loss |

**Operational risk (separate from supplier history risk):**

| Days of stock | Risk |
|---|---|
| <= 2 | CRITICAL |
| > 2 and <= 4 | HIGH |
| > 4 and <= 7 | MEDIUM |
| > 7 (or null) | LOW |

A supplier can be historically bad while a specific late PO is LOW risk because the shelf is still stocked. That distinction is the point of this tool.

---

## Real results from the DB (sandbox now)

Only **7 POs** are overdue, and **none is CRITICAL or HIGH**.

| PO | Supplier | Branch | Product | Days overdue | On hand | Avg daily sales | Days of stock | Exposure / day | Risk |
|---|---|---|---|---:|---:|---:|---:|---:|---|
| PO-2026-00211 | Tropika Juice Corp. (8) | Marikina | Mango Juice 1L | 7.4 | 28 | 4.64 | 6.03 | P417.60 | MEDIUM |
| PO-2026-00071 | Visayas Canning Corp. (10) | Cubao | Instant Pancit Canton 60g | 1.0 | 54 | 5.05 | 10.69 | P85.85 | LOW |
| PO-2026-00678 | Kusina Bakeshop Supply (6) | Kapitolyo | Spanish Bread 6pc | 0.8 | 55 | 3.66 | 15.03 | P201.30 | LOW |
| PO-2026-00770 | Kusina Bakeshop Supply (6) | Kapitolyo | Spanish Bread 6pc | 0.8 | 55 | 3.66 | 15.03 | P201.30 | LOW |
| PO-2026-00541 | Metro Beverage Distributors (7) | Parañaque BF | Bottled Water 6L | 1.6 | 156 | 1.51 | 103.31 | P143.45 | LOW |
| PO-2026-00768 | Metro Beverage Distributors (7) | Parañaque BF | Bottled Water 6L | 1.6 | 156 | 1.51 | 103.31 | P143.45 | LOW |
| PO-2026-00771 | Metro Beverage Distributors (7) | Parañaque BF | Bottled Water 6L | 1.6 | 156 | 1.51 | 103.31 | P143.45 | LOW |

### What this tells us

- **Tropika Juice Corp.** (chronically late per MJ: 84.6% late, 3.42 days avg) has the only PO with real pressure: Mango Juice 1L at Marikina, 7.4 days overdue, ~6 days of stock left. Watch closely, not an emergency.
- **Visayas Canning Corp.** (the worst supplier: 88.2% late, 7.14 days avg) has an overdue PO, but Cubao still has 10.7 days of stock. This is the "poor reliability, no immediate stockout risk" case. Hermes must say that and not overclaim.
- **Duplicate POs:** Kapitolyo has 2 POs for Spanish Bread and Parañaque BF has 3 for Bottled Water. The SQL keeps one row per PO. The MCP/skill should mention it so the same risk isn't read as several separate ones.
- Many POs are under 2 days overdue (they only just passed expected_at).

---

## END-GAME: SQL

File: `docs/sql/inventory_impact.sql` (parameter `:supplier_id`, NULL = all suppliers)

```sql
WITH now AS (SELECT value AS n FROM sandbox_info WHERE key = 'sandbox_now'),
base AS (
  SELECT
    po.po_number,
    s.id   AS supplier_id,
    s.name AS supplier_name,
    b.name AS branch,
    p.name AS product,
    po.status,
    ROUND(julianday((SELECT n FROM now)) - julianday(po.expected_at), 1) AS days_overdue,
    i.on_hand,
    i.avg_daily_sales,
    CASE WHEN i.avg_daily_sales > 0
         THEN ROUND(i.on_hand * 1.0 / i.avg_daily_sales, 2) END AS days_of_stock,
    ROUND(i.avg_daily_sales * p.retail_price, 2) AS daily_revenue_exposure_php
  FROM purchase_orders po
  JOIN suppliers s ON s.id = po.supplier_id
  JOIN branches  b ON b.id = po.branch_id
  JOIN products  p ON p.id = po.product_id
  LEFT JOIN inventory i ON i.branch_id = po.branch_id AND i.product_id = po.product_id
  WHERE po.received_at IS NULL
    AND po.status NOT IN ('received', 'cancelled')
    AND po.expected_at < (SELECT n FROM now)
    AND (:supplier_id IS NULL OR po.supplier_id = :supplier_id)
)
SELECT *,
  CASE
    WHEN days_of_stock IS NULL THEN 'LOW'
    WHEN days_of_stock <= 2 THEN 'CRITICAL'
    WHEN days_of_stock <= 4 THEN 'HIGH'
    WHEN days_of_stock <= 7 THEN 'MEDIUM'
    ELSE 'LOW'
  END AS operational_risk
FROM base
ORDER BY days_of_stock IS NULL, days_of_stock;
```

Design notes: `LEFT JOIN inventory` so a PO with no inventory row is not silently dropped. Sorted most-at-risk first.

**Output fields (shared contract):** `po_number, supplier_id, supplier_name, branch, product, status, days_overdue, on_hand, avg_daily_sales, days_of_stock, daily_revenue_exposure_php, operational_risk`

---

## Handoff / Next steps

1. Dio: confirm the product/branch/revenue columns match your part (or take over `daily_revenue_exposure_php`).
2. Rykiel/Lance: wrap the SQL as MCP tool `get_inventory_impact(supplier_id: int | None = None)`. Return JSON-friendly rows.
3. Lance: skill should NOT invent an alternate supplier (each product has one `supplier_id`). Say "initiate an alternate sourcing review".
4. Julia: spec still says "chronic = 30% late rate". MJ's rule is **>=75% late AND avg delay >= 2 days**. Update `docs/SUPPLIER_WATCH_SPEC.md` to one definition.
5. Everyone: demo expectation. No CRITICAL rows exist. Best live example is Tropika / Mango Juice at Marikina (MEDIUM). Best "no immediate risk" example is Visayas Canning / Cubao (LOW).
