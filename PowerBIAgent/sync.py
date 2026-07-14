"""
Data sync logic — fetch from Fishbowl via SQL, transform, push to Power BI.

SQL queries run against the Fishbowl REST /api/data-query endpoint. Result
keys are normalized to lowercase by FishbowlClient.query(), so always read
columns in lowercase (row["customer_name"], not row["customerName"]).

WATERMARK / INCREMENTAL APPEND
------------------------------
Power BI streaming/push datasets only APPEND rows — with just a push URL + key
(no Azure AD OAuth) we can't truncate and reload. So we sync incrementally:
each run pushes only posted sales lines newer than the highest PostSoItem.Id we
pushed last time, then advances the watermark. Posted sales are append-only, so
this never duplicates and self-backfills over successive runs.

To re-backfill from scratch (e.g. after recreating the Power BI dataset),
delete state.json next to this agent and restart the service.
"""

import json
import logging
import os
import sys

from fishbowl_client import FishbowlClient
from powerbi_client import PowerBIClient

logger = logging.getLogger(__name__)

# Install/working dir — matches the convention in service.py / wizard.py.
BASE_DIR   = os.path.dirname(sys.executable if getattr(sys, "frozen", False)
                             else os.path.abspath(__file__))
STATE_PATH = os.path.join(BASE_DIR, "state.json")

# Only the FIRST run is bounded by this date (the watermark takes over after).
# Adjust to control how far back the initial backfill reaches. Fiscal year
# starts in July for this company, so default to the start of the current FY.
SALES_BACKFILL_FROM = "2024-07-01"

# Max line items pulled+pushed per sync. This is the backfill throttle: each
# 15-min run pushes at most this many rows, paced ~1 req/sec by powerbi_client.
# Lower = gentler on Power BI's ingestion limit but slower one-time backfill;
# raise it again once history has caught up and only new sales trickle in.
MAX_ROWS_PER_SYNC = 2000


# ----------------------------------------------------------------------
# Watermark state
# ----------------------------------------------------------------------

def _load_watermark() -> int:
    if not os.path.exists(STATE_PATH):
        return 0   # first run — legitimate fresh backfill
    try:
        with open(STATE_PATH, "r") as f:
            return int(json.load(f)["last_line_id"])
    except (ValueError, KeyError, json.JSONDecodeError) as exc:
        # Do NOT silently reset to 0 — that would re-push the entire history and
        # duplicate every row in Power BI. Fail loudly so the operator notices.
        raise RuntimeError(
            f"state.json is corrupt ({exc}); refusing to reset the watermark to 0 "
            f"(would duplicate all history). Delete {STATE_PATH} to intentionally "
            f"re-backfill, then restart."
        ) from exc


def _save_watermark(line_id: int) -> None:
    with open(STATE_PATH, "w") as f:
        json.dump({"last_line_id": line_id}, f)


# ----------------------------------------------------------------------
# Value coercion helpers (Power BI rejects NaN/Infinity in JSON)
# ----------------------------------------------------------------------

def _num(v):
    """Float or None. Guards against NULLs and divide-by-zero NaN/Inf results."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):
        return None
    return f


def _dt(v):
    """ISO-8601 string Power BI accepts as DateTime, or None."""
    if not v:
        return None
    return str(v).replace(" ", "T")


# ----------------------------------------------------------------------
# Sales history sync
# ----------------------------------------------------------------------

def sync_sales_history(fb: FishbowlClient, pbi: PowerBIClient) -> None:
    """
    Push posted (shipped/invoiced) sales line items to Power BI, incrementally.

    Power BI streaming dataset columns required (create with "Historic data
    analysis" turned ON so rows are retained):

        Order Number (Text)        Vendor (Text)
        Date (DateTime)            Qty (Number)
        Day (Number)               Unit COGS (Number)
        Month (Number)             Unit Price (Number)
        Year (Number)              Total Price (Number)
        Order Taken By (Text)      Margin $ (Number)
        Customer Group (Text)      Margin % (Number)
        Account Manager (Text)     Batch Number (Text)
        Customer Name (Text)       Expiry Date (DateTime)
        Product Category (Text)
        Product Number (Text)
        Product Description (Text)
        UOM (Text)

    Column names must match the Power BI dataset exactly. (Total COGS is not
    pushed — the dataset has no such column; derive it in Power BI as
    [Qty] * [Unit COGS] if needed.)
    """
    watermark = _load_watermark()
    logger.debug("Fetching posted sales lines newer than id %d...", watermark)

    rows = fb.query(f"""
        SELECT
          PostSoItem.Id                                                       AS line_id,
          So.Num                                                              AS order_number,
          PostSo.PostDate                                                     AS post_date,
          DATE_FORMAT(PostSo.PostDate, '%d')                                  AS day,
          DATE_FORMAT(PostSo.PostDate, '%m')                                  AS month,
          DATE_FORMAT(PostSo.PostDate, '%Y')                                  AS year,
          So.salesman                                                         AS order_taken_by,
          COALESCE(AccountGroup.Name, 'No Group')                             AS customer_group,
          COALESCE(CONCAT(SysUser.FirstName, ' ', SysUser.LastName),
                   'Head Office')                                             AS account_manager,
          Customer.Name                                                       AS customer_name,
          COALESCE(ProductTree.Name, 'No Category')                           AS product_category,
          Product.Num                                                         AS product_number,
          Product.Description                                                 AS product_description,
          Uom.Code                                                            AS uom,
          COALESCE(Vendor.Name, 'No Default')                                 AS vendor,
          IF(SoItem.TypeId IN (20,21), (PostSoItem.Qty*-1), PostSoItem.Qty)   AS qty,
          (PostSoItem.PostedTotalCost/PostSoItem.Qty)                         AS unit_cogs,
          PostSoItem.PostedTotalCost                                          AS total_cogs,
          COALESCE((SoItem.UnitPrice)-(SoItem.UnitPrice*PSI.AdjustPercent),
                   SoItem.UnitPrice)                                          AS unit_price,
          COALESCE(((PostSoItem.TotalPrice/PostSoItem.Qty)-((PostSoItem.TotalPrice/PostSoItem.Qty)*PSI.AdjustPercent)),
                   PostSoItem.TotalPrice/PostSoItem.Qty) * PostSoItem.Qty     AS total_price,
          (((COALESCE(((PostSoItem.TotalPrice/PostSoItem.Qty)-((PostSoItem.TotalPrice/PostSoItem.Qty)*PSI.AdjustPercent)),
                      PostSoItem.TotalPrice/PostSoItem.Qty) * PostSoItem.Qty)-PostSoItem.PostedTotalCost)) AS margin_dollar,
          (((COALESCE(((PostSoItem.TotalPrice/PostSoItem.Qty)-((PostSoItem.TotalPrice/PostSoItem.Qty)*PSI.AdjustPercent)),
                      PostSoItem.TotalPrice/PostSoItem.Qty) * PostSoItem.Qty)-PostSoItem.PostedTotalCost)
           / (COALESCE(((PostSoItem.TotalPrice/PostSoItem.Qty)-((PostSoItem.TotalPrice/PostSoItem.Qty)*PSI.AdjustPercent)),
                       PostSoItem.TotalPrice/PostSoItem.Qty) * PostSoItem.Qty)) AS margin_pct,
          Batch.Info                                                          AS batch_no,
          Expiry.InfoDate                                                     AS expiry_date
        FROM PostSo
        JOIN PostSoItem ON PostSoItem.PostSoId = PostSo.Id
        LEFT JOIN ShipItem ON ShipItem.Id = PostSoItem.ShipItemId
        LEFT JOIN TrackingInfo Batch  ON Batch.RecordId  = ShipItem.Id AND Batch.TableId  = 1555030112 AND Batch.PartTrackingId  = 1
        LEFT JOIN TrackingInfo Expiry ON Expiry.RecordId = ShipItem.Id AND Expiry.TableId = 1555030112 AND Expiry.PartTrackingId = 3
        JOIN SoItem ON SoItem.Id = PostSoItem.SoItemId
        JOIN Uom ON Uom.Id = SoItem.UomId
        JOIN So ON So.Id = SoItem.SoId
        LEFT JOIN PostSoItem PSI ON PSI.SoItemId = COALESCE(
            (SELECT K.Id FROM SoItem K
              WHERE K.SoLineItem = SoItem.SoLineItem+1
                AND K.TypeId = 30 AND SoItem.TypeId != 30 AND K.SoId = SoItem.SoId
              ORDER BY K.SoLineItem ASC LIMIT 1),
            (SELECT K.Id FROM SoItem K
              WHERE K.SoLineItem > SoItem.SoLineItem
                AND EXISTS (SELECT * FROM SoItem J WHERE J.TypeId = 40 AND J.SoId = K.SoId AND J.SoLineItem >= K.SoLineItem-1 ORDER BY J.SoLineItem ASC)
                AND K.TypeId = 30 AND SoItem.TypeId != 30 AND K.SoId = SoItem.SoId
              ORDER BY K.SoLineItem ASC LIMIT 1)
          ) AND PSI.PostSoId = PostSo.Id
        LEFT JOIN Product ON Product.Id = SoItem.ProductId
        LEFT JOIN ProductTree ON ProductTree.Id = (
            SELECT ProductToTree.ProductTreeId FROM ProductToTree
              WHERE ProductToTree.ProductId = Product.Id
              ORDER BY ProductToTree.Id ASC LIMIT 1)
        LEFT JOIN Customer ON Customer.Id = So.CustomerId
        LEFT JOIN SysUser ON SysUser.Id = Customer.DefaultSalesManId
        LEFT JOIN AccountGroup ON AccountGroup.Id = (
            SELECT AccountGroupRelation.GroupId FROM AccountGroupRelation
              WHERE AccountGroupRelation.AccountId = Customer.AccountId
              ORDER BY AccountGroupRelation.AccountId ASC LIMIT 1)
        LEFT JOIN part ON product.partid = part.id
        LEFT JOIN vendorparts ON vendorparts.partid = part.id AND vendorparts.defaultflag = 1
        LEFT JOIN vendor ON vendorparts.vendorid = vendor.id
        WHERE SoItem.TypeId NOT IN (30,40)
          AND PostSoItem.Id > {watermark}
          AND PostSo.PostDate >= '{SALES_BACKFILL_FROM}'
        ORDER BY PostSoItem.Id ASC
        LIMIT {MAX_ROWS_PER_SYNC}
    """)

    if not rows:
        logger.info("sync ok — no new rows (watermark %d)", watermark)
        return

    pbi_rows = [
        {
            "Order Number":        r["order_number"],
            "Date":                _dt(r["post_date"]),
            "Day":                 _num(r["day"]),
            "Month":               _num(r["month"]),
            "Year":                _num(r["year"]),
            "Order Taken By":      r["order_taken_by"],
            "Customer Group":      r["customer_group"],
            "Account Manager":     r["account_manager"],
            "Customer Name":       r["customer_name"],
            "Product Category":    r["product_category"],
            "Product Number":      r["product_number"],
            "Product Description": r["product_description"],
            "UOM":                 r["uom"],
            "Vendor":              r["vendor"],
            "Qty":                 _num(r["qty"]),
            "Unit COGS":           _num(r["unit_cogs"]),
            # Total COGS intentionally not pushed — dataset has no such column.
            "Unit Price":          _num(r["unit_price"]),
            "Total Price":         _num(r["total_price"]),
            "Margin $":            _num(r["margin_dollar"]),
            "Margin %":            _num(r["margin_pct"]),
            "Batch Number":        r["batch_no"],
            "Expiry Date":         _dt(r["expiry_date"]),
        }
        for r in rows
    ]

    # Push first; only advance the watermark once Power BI has accepted the rows,
    # so a failed push is retried on the next interval instead of being skipped.
    pbi.push_rows(pbi_rows)

    max_id = max(int(r["line_id"]) for r in rows)
    _save_watermark(max_id)
    logger.info("sync ok — pushed %d line(s), watermark now %d",
                len(pbi_rows), max_id)


def run_all(fb: FishbowlClient, pbi: PowerBIClient) -> None:
    """Run every configured sync. Called by service.py on each interval."""
    sync_sales_history(fb, pbi)
