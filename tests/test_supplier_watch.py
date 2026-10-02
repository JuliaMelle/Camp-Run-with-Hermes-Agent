import importlib.util
from pathlib import Path


SERVER_PATH = Path(__file__).parents[1] / "mcp-server" / "server.py"


def load_server():
    spec = importlib.util.spec_from_file_location("suki_server", SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_find_chronically_late_suppliers_returns_expected_suppliers():
    server = load_server()

    rows = server.find_chronically_late_suppliers()

    assert [row["supplier"] for row in rows] == [
        "Visayas Canning Corp.",
        "Tropika Juice Corp.",
    ]
    assert rows[0]["supplier_id"] == 10
    assert rows[0]["delivered_pos"] == 17
    assert rows[0]["late_rate_pct"] >= 75
    assert rows[0]["avg_days_late"] >= 2


def test_get_supplier_reliability_uses_latest_signature_and_limit():
    server = load_server()

    rows = server.get_supplier_reliability(min_orders=5, limit=1)

    assert len(rows) == 1
    assert rows[0]["supplier"] == "Visayas Canning Corp."
    assert rows[0]["risk"] == "HIGH"
    assert rows[0]["orders_placed"] >= 5


def test_get_supplier_scorecard_returns_supplier_evidence():
    server = load_server()

    result = server.get_supplier_scorecard(supplier_id=10, worst_n=3)

    assert result["supplier"]["name"] == "Visayas Canning Corp."
    assert len(result["worst_pos"]) <= 3
    assert result["worst_branches"]
    assert "better_alternatives_same_category" in result


def test_overdue_purchase_orders_default_excludes_stale_records():
    server = load_server()

    rows = server.get_overdue_purchase_orders(limit=20)

    assert rows
    assert all(row["expected_at"] >= "2026-09-16" for row in rows)
    assert all(row["status"] in {"pending", "in_transit", "partially_received"} for row in rows)


def test_at_risk_and_inventory_impact_return_demo_fields():
    server = load_server()

    at_risk = server.find_at_risk_open_orders(limit=10)
    impact = server.get_supplier_inventory_impact(top_n=3)

    assert at_risk
    assert {"supplier", "branch", "product", "days_of_cover", "urgency"} <= at_risk[0].keys()
    assert impact["summary"]["late_suppliers"]
    assert impact["summary"]["total_revenue_exposure_php"] >= 0
    assert impact["worst_rows"]


def test_supplier_inventory_impact_and_parameter_validation():
    server = load_server()

    rows = server.get_inventory_impact("Visayas", limit=3)
    assert rows
    assert {"branch", "product", "days_of_cover", "severity"} <= rows[0].keys()

    rows = server.get_supplier_reliability(min_orders=0, limit=1)
    assert len(rows) == 1
