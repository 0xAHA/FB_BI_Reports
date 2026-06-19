"""
Data sync logic — fetch from Fishbowl, transform, push to Power BI.

This is the file you'll edit most as you add new datasets.
Each function fetches one logical dataset and pushes it to Power BI.
"""

import logging

from fishbowl_client import FishbowlClient
from powerbi_client import PowerBIClient

logger = logging.getLogger(__name__)


def sync_open_sales_orders(fb: FishbowlClient, pbi: PowerBIClient) -> None:
    """
    Example sync: open sales orders.

    TODO:
    1. Confirm the correct REST endpoint path from http://<server>:2456/apidocs
    2. Adjust the field names below to match what the API actually returns
    3. In Power BI, create a streaming dataset with these columns:
           OrderNumber (Text), Customer (Text), Total (Number),
           Status (Text), DateCreated (DateTime)
    4. Paste the push URL into config.py
    """
    logger.info("Fetching open sales orders from Fishbowl...")

    # TODO: replace with the verified endpoint + params from your apidocs
    data = fb.get("/api/sales-orders", params={"statusId": 20, "pageSize": 500})

    # API may return {"results": [...]} or a bare list — handle both
    orders = data.get("results", data) if isinstance(data, dict) else data

    rows = [
        {
            # TODO: adjust key names to match the actual API response fields
            "OrderNumber":  order.get("number"),
            "Customer":     order.get("customerName"),
            "Total":        order.get("totalPrice"),
            "Status":       order.get("status"),
            "DateCreated":  order.get("dateCreated"),
        }
        for order in orders
    ]

    pbi.push_rows(rows)
    logger.info("sync_open_sales_orders complete — %d row(s)", len(rows))


# Add more sync functions here as needed, e.g.:
# def sync_inventory_levels(fb, pbi): ...
# def sync_open_purchase_orders(fb, pbi): ...


def run_all(fb: FishbowlClient, pbi: PowerBIClient) -> None:
    """Run every configured sync. Called by main.py on each interval."""
    sync_open_sales_orders(fb, pbi)
    # sync_inventory_levels(fb, pbi)
