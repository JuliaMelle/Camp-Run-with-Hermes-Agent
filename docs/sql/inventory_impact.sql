-- Supplier Watch · Inventory Impact (Prince)
-- Currently overdue purchase orders joined to branch inventory.
-- Overdue = received_at IS NULL AND expected_at < sandbox_now AND status NOT IN ('received','cancelled')
-- "Now" comes from sandbox_info (2026-09-30 21:00:00), never the real clock.
-- Optional filter: replace :supplier_id with a supplier id, or NULL for all suppliers.

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
    WHEN days_of_stock IS NULL THEN 'LOW'      -- no sales velocity: no stockout risk
    WHEN days_of_stock <= 2 THEN 'CRITICAL'
    WHEN days_of_stock <= 4 THEN 'HIGH'
    WHEN days_of_stock <= 7 THEN 'MEDIUM'
    ELSE 'LOW'
  END AS operational_risk
FROM base
ORDER BY days_of_stock IS NULL, days_of_stock;
