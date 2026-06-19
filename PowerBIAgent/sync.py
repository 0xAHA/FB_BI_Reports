"""
Data sync logic — fetch from Fishbowl via SQL, transform, push to Power BI.

SQL queries work exactly like runQueryAsync in a BI report — all column name
keys in the results are lowercase regardless of how you write the alias.

This is the file you'll edit most as you add new datasets. Each function
fetches one logical dataset and pushes it to Power BI.
"""

import logging

from fishbowl_client import FishbowlClient
from powerbi_client import PowerBIClient

logger = logging.getLogger(__name__)


def sync_open_sales_orders(fb: FishbowlClient, pbi: PowerBIClient) -> None:
    """
    Sync open / issued / in-progress sales orders to Power BI.

    Power BI streaming dataset columns needed:
        OrderNumber (Text), Customer (Text), Total (Number),
        Status (Text), DateFirstShip (DateTime)
    """
    logger.info("Fetching open sales orders...")

    rows = fb.query("""
        SELECT so.num,
               c.name       AS customerName,
               so.totalPrice,
               so.statusId,
               so.dateFirstShip
        FROM so
        JOIN customer c ON so.customerId = c.id
        WHERE so.statusId IN (20, 25, 60)
        ORDER BY so.dateFirstShip ASC
        LIMIT 500
    """)

    STATUS_LABELS = {20: "Issued", 25: "In Progress", 60: "Fulfilled"}

    pbi_rows = [
        {
            # Keys from fb.query() are always lowercase
            "OrderNumber":   row["num"],
            "Customer":      row["customername"],
            "Total":         float(row["totalprice"] or 0),
            "Status":        STATUS_LABELS.get(row["statusid"], str(row["statusid"])),
            "DateFirstShip": (row["datefirstship"] or "")[:10] or None,
        }
        for row in rows
    ]

    pbi.push_rows(pbi_rows)
    logger.info("sync_open_sales_orders complete — %d row(s)", len(pbi_rows))


# Add more sync functions here as needed. Examples:
#
# def sync_low_stock(fb, pbi):
#     rows = fb.query("""
#         SELECT p.num, p.description,
#                COALESCE(SUM(t.qty), 0) AS onHand,
#                pl.reorderPoint
#         FROM part p
#         JOIN tag t ON t.partId = p.id
#         JOIN location l ON t.locationId = l.id
#         JOIN partreorder pl ON pl.partId = p.id AND pl.locationGroupId = l.locationGroupId
#         WHERE p.activeFlag = 1 AND pl.reorderPoint > 0
#         GROUP BY p.id, p.num, p.description, pl.reorderPoint
#         HAVING onHand <= pl.reorderPoint
#         LIMIT 500
#     """)
#     pbi.push_rows([{"Part": r["num"], "OnHand": float(r["onhand"]), ...} for r in rows])


def run_all(fb: FishbowlClient, pbi: PowerBIClient) -> None:
    """Run every configured sync. Called by main.py on each interval."""
    sync_open_sales_orders(fb, pbi)
    # sync_low_stock(fb, pbi)
