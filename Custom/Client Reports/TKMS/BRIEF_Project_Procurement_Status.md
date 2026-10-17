# TKMS Sonotech – Project Procurement Status Report (BI) – Design Brief

**Client:** TKMS Sonotech (Fishbowl, MySQL backend, on-premise)
**Requested by:** Nick Wright (primary user), for Saxon Fiori / Elena Jiang's weekly managers' meeting
**Prepared by:** Yana Belichenka, Fishbowl
**Status:** Rules agreed 9 Oct 2026. SQL not yet tested against the TKMS database.

> Filed verbatim as received. The scope that builds on it, with the schema
> corrections, is `SCOPE_Project_Procurement_Status.md` in this folder.

---

## 1. Purpose

Nick currently builds a weekly "Project Procurement Ordering Status" table in Excel. For each project it shows how many of the parts needed are in stock, still to be ordered, ordered, and received. Now that purchasing runs in Fishbowl, the report has to come from Fishbowl data.

Management wants to see progress: **To Be Ordered** going down to 0, and **Ordered / Received** going up.

**Key requirement:** every number must be explainable. Each count on the summary must be traceable to the exact parts, MO lines and PO lines behind it, so Nick can see why a number is what it is and spot data errors. The report therefore has **several views (tabs)** that drill down from summary to source.

---

## 2. How a "job" is represented in Fishbowl (TKMS setup)

| Concept | Fishbowl record | Notes |
|---|---|---|
| **Job / project** | **Customer** | Named project number + 3-digit phase code, no dash (e.g. `P2410110`). Fishbowl has no "job" record, so every project/phase is a customer. |
| **Project order** | **Sales Order** | SO customer = the job. SO number is set to the project number before issuing. |
| **Build** | **Manufacture Order** | Created automatically from the SO (finished-good BOMs are *Build to Order*). MO number = SO number (setting *Match MO number to SO number*). The MO is linked to the SO, so **MO → SO → customer = the same job**. |
| **What the job needs** | **MO raw-good lines** | Across all stages (work orders) of the job's MO(s). Staged BOMs: each sub-assembly built in-house is a finished good of its stage **and** a raw good of the stage above. |
| **Purchasing for the job** | **PO lines with Customer Job** | Customer Job is set **per PO line** (not per PO header). One PO can hold lines for several jobs; the same part for two jobs = two lines, each with its own Customer Job. |
| **Project stock** | **Location group "Project Warehouse"** | Pickable. **Sonic Stock Program** stock is company stock and isn't counted until it's transferred into Project Warehouse. Third Party Property is never counted. |

Linking path used by the report:

```
customer (job)
  └─ so.customerId = customer.id
       └─ mo.soId = so.id            (mo.num = so.num)
            └─ moitem (raw goods = what the job needs)
  └─ poitem.customerId = customer.id  (Customer Job on the PO line)
       └─ po (status Issued / Partial / Fulfilled only)
```

---

## 3. Agreed business rules

| # | Rule | Decided |
|---|---|---|
| R1 | **Counts only, no percentages** (for now). | 9 Oct |
| R2 | Count **each unique part number once per job**, however many times it appears across BOM lines and stages. | 9 Oct |
| R3 | **Exclude sub-assemblies built in-house**: a raw good that is also a finished good on the same MO isn't something we buy. | Design |
| R4 | Only POs with status **Issued, Partial or Fulfilled** count. **Bid Requests are ignored** (not approved, no Vista number). | 9 Oct |
| R5 | PO lines are matched to the job **only** through the line-level **Customer Job**. | Setup |
| R6 | **Ignore freight**: shipping/service lines aren't counted. They're never on the BOM, so they can't match a required part anyway. | 9 Oct |
| R7 | **Metalwork:** no special handling for now. | 9 Oct |
| R8 | A part is **Received only when every job PO line for it is fully received**. A partial receipt still counts as Ordered ("it's a no until it's all available" – Nick). | 7 Oct |
| R9 | **Show on hand** (Project Warehouse only), but stock isn't reserved to a job. If the same part is needed on several open MOs, **say so in a note**, with total open demand against on hand. | 9 Oct |
| R10 | **Status precedence:** Ordered/Received (a job PO exists) wins over In Stock. A part with stock on hand that was still bought for the job shows as Ordered/Received. | Design |

### Status per part (first match wins)

| Status | Meaning |
|---|---|
| **Received** | Has job PO lines (Issued/Partial/Fulfilled) and **all** of them are fully received. |
| **Ordered** | Has job PO lines, and at least one isn't fully received. |
| **In Stock** | No job PO line, but on hand in Project Warehouse > 0. |
| **To Be Ordered** | No job PO line and nothing on hand. |

Summary arithmetic (must always hold – use as a self-check):
- `Unique Parts = In Stock + To Be Ordered + Ordered (open) + Received`
- `Total Ordered = Ordered (open) + Received`

---

## 4. Report views (tabs)

Each view is filtered by **Job** (multi-select). Every count in View 1 must equal the number of rows in View 2 with that status.

### View 1 – Summary (one row per job)
Replaces Nick's table.

| Column | Source / rule |
|---|---|
| Job | customer.name |
| Unique Parts Required | count of rows in View 2 |
| In Stock | count where Status = In Stock |
| To Be Ordered | count where Status = To Be Ordered |
| Ordered – Not Fully Received | count where Status = Ordered |
| Received | count where Status = Received |
| Total Ordered | Ordered + Received |
| In Stock – Shared, Not Enough for All Jobs | count of In Stock parts where open demand across all jobs > on hand (warning) |

### View 2 – Part Status (one row per job + part)
Explains every summary count.

Columns: Job, Part Number, Description, Qty Required (sum of the job's MO raw-good lines), Status, **Status Reason** (plain-English text, e.g. "2 PO lines, 1 still open (PO 1043)" / "No PO for this job; 50 on hand in Project Warehouse"), PO Numbers, PO Lines, Open PO Lines, Qty Ordered, Qty Received, Last Received Date, On Hand (Project WH), **Stock Note** (shared-demand warning, R9), **Qty Note** (e.g. "Ordered 10 < required 12" – informational, doesn't change status).

### View 3 – Requirements (one row per MO raw-good line)
Explains **why a part is on the job** and why it's counted once. This is the line-level view Nick is used to from his spreadsheet.

Columns: Job, SO Number, MO Number, Work Order / Stage (finished good of the stage), Part Number, Description, Qty Required, Qty Fulfilled, UOM, **Counted?** (Yes / "Excluded – built in-house (sub-assembly)").

### View 4 – Job PO Lines (one row per PO line with a Customer Job)
Explains **Ordered / Received**.

Columns: Job (Customer Job), PO Number, PO Status, Vendor, Vista PO No. (Vendor SO), Part Number, Qty Ordered, Qty Received, Open?, Date Issued, Scheduled Date, Last Received Date, **Included?** (Yes / "Excluded – Bid Request" / "Excluded – Void" / "Excluded – Closed Short" / "Excluded – Freight/Shipping" / "Not on job's BOM").

Shows excluded lines too, so it's clear why a PO someone expects to see isn't counted.

### View 5 – Shared Stock (one row per part needed on more than one open job)
Explains **Stock Note** (R9).

Columns: Part Number, Description, On Hand (Project WH), Total Open Demand, Shortfall (demand − on hand, if > 0), Jobs Needing It (list), and per-job remaining qty (or one row per part + job).

### View 6 – Exceptions / Data Checks
Finds process mistakes that would make the summary wrong.

| Check | Why it matters |
|---|---|
| Issued PO lines **without a Customer Job** for parts needed on an open job | The part will show as To Be Ordered even though it's bought. (MO to PO / Create PO don't set Customer Job, so this will happen.) |
| Job PO lines for parts **not on the job's MO** | Wrong Customer Job, or a BOM change after ordering. |
| MOs **not linked to an SO** | Not attached to any job, so excluded from the report (e.g. demo builds raised directly). |
| Jobs with an SO but **no issued MO** | Nothing to measure yet. |
| BOM line UOM ≠ part UOM | Qty Required may be summed in mixed units. |

---

## 5. Filters & settings

- **Job** – multi-select (default: all jobs with an open MO).
- **Status** – multi-select (View 2).
- **Include fulfilled/closed MOs** – default No (finished jobs drop off). *To confirm.*
- Optional: **Vendor** (Views 2/4).

---

## 6. Schema notes – VERIFY BEFORE BUILDING

The following are assumptions about Fishbowl's MySQL schema. **Check each one on the TKMS database before writing the final queries.**

| Assumption | Check |
|---|---|
| `moitem.typeId` 10 = Finished Good, 20 = Raw Good | `SELECT typeId, COUNT(*) FROM moitem GROUP BY typeId;` (and/or a type lookup table) |
| `mo.soId` links MO to SO | `SHOW COLUMNS FROM mo LIKE 'soId';` |
| How stages / work orders relate to `moitem` (needed for View 3's stage column) | inspect `moitem`, `wo`, `woitem` for one test MO |
| `poitem.customerId` = Customer Job | `SHOW COLUMNS FROM poitem LIKE 'customerId';` |
| `poitem.qtyToFulfill` / `qtyFulfilled`, `poitem.dateLastFulfillment` | `SHOW COLUMNS FROM poitem;` |
| PO status names Issued / Partial / Fulfilled / Bid Request / Void / Closed Short | `SELECT id, name FROM postatus;` |
| MO status names (Issued, Partial, Fulfilled, Void…) | `SELECT id, name FROM mostatus;` |
| `poitem.typeId` – purchase vs credit return vs shipping | `SELECT typeId, COUNT(*) FROM poitem GROUP BY typeId;` |
| On hand per location group: `qtyonhand` view (partId, locationGroupId, qty), otherwise sum `tag` by location → location group | `SHOW COLUMNS FROM qtyonhand;` |
| Vendor SO (Vista number) on `po` (e.g. `po.vendorSO`) | `SHOW COLUMNS FROM po;` |
| Location group name is exactly `Project Warehouse` | `SELECT id, name FROM locationgroup;` |

---

## 7. Starter SQL – View 2 (Part Status) – UNTESTED

Views 1, 5 and 6 build on this; View 1 is a `GROUP BY Job` over it.

```sql
SELECT
    d.*,
    CASE
        WHEN d.Status = 'In Stock' AND d.OpenJobsNeedingPart > 1 THEN
            CONCAT('Shared - needed on ', d.OpenJobsNeedingPart, ' open jobs (', d.OpenJobsList, '). ',
                   'Open demand ', d.TotalOpenDemand, ' vs on hand ', d.OnHandProjectWH,
                   IF(d.TotalOpenDemand > d.OnHandProjectWH, ' - NOT enough for all jobs', ' - enough for all jobs'))
        WHEN d.Status = 'In Stock' AND d.OnHandProjectWH < d.QtyRequired THEN
            CONCAT('On hand ', d.OnHandProjectWH, ' is less than required ', d.QtyRequired)
        ELSE ''
    END AS StockNote
FROM (
    SELECT
        job.name                         AS Job,
        req.partNum                      AS PartNumber,
        req.partDesc                     AS Description,
        req.qtyRequired                  AS QtyRequired,
        CASE
            WHEN pol.lineCount > 0 AND pol.openLines = 0 THEN 'Received'
            WHEN pol.lineCount > 0                       THEN 'Ordered'
            WHEN COALESCE(oh.qty, 0) > 0                 THEN 'In Stock'
            ELSE 'To Be Ordered'
        END                              AS Status,
        COALESCE(pol.poNums, '')         AS PONumbers,
        COALESCE(pol.lineCount, 0)       AS POLines,
        COALESCE(pol.openLines, 0)       AS OpenPOLines,
        COALESCE(pol.qtyOrdered, 0)      AS QtyOrdered,
        COALESCE(pol.qtyReceived, 0)     AS QtyReceived,
        pol.lastReceived                 AS LastReceived,
        COALESCE(oh.qty, 0)              AS OnHandProjectWH,
        COALESCE(sh.jobCount, 0)         AS OpenJobsNeedingPart,
        COALESCE(sh.jobList, '')         AS OpenJobsList,
        COALESCE(sh.openDemand, 0)       AS TotalOpenDemand
    FROM (
        -- What the job needs: unique raw-good parts on the job's MO(s), excluding in-house sub-assemblies
        SELECT so.customerId, mi.partId, p.num AS partNum, p.description AS partDesc,
               SUM(mi.qtyToFulfill) AS qtyRequired
        FROM so
        JOIN mo          ON mo.soId = so.id
        JOIN mostatus ms ON ms.id = mo.statusId AND ms.name <> 'Void'
        JOIN moitem mi   ON mi.moId = mo.id AND mi.typeId = 20           -- raw good
        JOIN part p      ON p.id = mi.partId
        WHERE NOT EXISTS (SELECT 1 FROM moitem fg
                          WHERE fg.moId = mo.id AND fg.typeId = 10 AND fg.partId = mi.partId)
        GROUP BY so.customerId, mi.partId, p.num, p.description
    ) req
    JOIN customer job ON job.id = req.customerId
    LEFT JOIN (
        -- Job PO lines: Issued / Partial / Fulfilled only, matched by line-level Customer Job
        SELECT pi.customerId, pi.partId,
               COUNT(*) AS lineCount,
               SUM(pi.qtyFulfilled < pi.qtyToFulfill) AS openLines,
               SUM(pi.qtyToFulfill) AS qtyOrdered,
               SUM(pi.qtyFulfilled) AS qtyReceived,
               GROUP_CONCAT(DISTINCT po.num ORDER BY po.num SEPARATOR ', ') AS poNums,
               MAX(pi.dateLastFulfillment) AS lastReceived
        FROM poitem pi
        JOIN po          ON po.id = pi.poId
        JOIN postatus ps ON ps.id = po.statusId
        WHERE ps.name IN ('Issued', 'Partial', 'Fulfilled')
          AND pi.customerId IS NOT NULL
        GROUP BY pi.customerId, pi.partId
    ) pol ON pol.customerId = req.customerId AND pol.partId = req.partId
    LEFT JOIN (
        -- On hand, Project Warehouse only
        SELECT q.partId, SUM(q.qty) AS qty
        FROM qtyonhand q
        JOIN locationgroup lg ON lg.id = q.locationGroupId
        WHERE lg.name = 'Project Warehouse'
        GROUP BY q.partId
    ) oh ON oh.partId = req.partId
    LEFT JOIN (
        -- Shared demand across all open MOs
        SELECT mi2.partId,
               COUNT(DISTINCT so2.customerId) AS jobCount,
               GROUP_CONCAT(DISTINCT c2.name ORDER BY c2.name SEPARATOR ', ') AS jobList,
               SUM(mi2.qtyToFulfill - mi2.qtyFulfilled) AS openDemand
        FROM so so2
        JOIN customer c2  ON c2.id = so2.customerId
        JOIN mo mo2       ON mo2.soId = so2.id
        JOIN mostatus ms2 ON ms2.id = mo2.statusId AND ms2.name IN ('Issued', 'Partial')
        JOIN moitem mi2   ON mi2.moId = mo2.id AND mi2.typeId = 20
        WHERE mi2.qtyToFulfill > mi2.qtyFulfilled
          AND NOT EXISTS (SELECT 1 FROM moitem fg2
                          WHERE fg2.moId = mo2.id AND fg2.typeId = 10 AND fg2.partId = mi2.partId)
        GROUP BY mi2.partId
    ) sh ON sh.partId = req.partId
) d
ORDER BY d.Job, FIELD(d.Status, 'To Be Ordered', 'Ordered', 'In Stock', 'Received'), d.PartNumber;
```

**View 1 (Summary) from View 2:**

```sql
SELECT Job,
       COUNT(*)                               AS UniquePartsRequired,
       SUM(Status = 'In Stock')               AS InStock,
       SUM(Status = 'To Be Ordered')          AS ToBeOrdered,
       SUM(Status = 'Ordered')                AS OrderedNotFullyReceived,
       SUM(Status = 'Received')               AS Received,
       SUM(Status IN ('Ordered','Received'))  AS TotalOrdered,
       SUM(Status = 'In Stock' AND OpenJobsNeedingPart > 1
           AND TotalOpenDemand > OnHandProjectWH) AS InStockSharedShort
FROM ( /* View 2 query */ ) v
GROUP BY Job
ORDER BY Job;
```

---

## 8. Open questions (not yet decided)

1. **Closed Short POs:** R4 excludes them, so a short-closed line no longer counts as ordered. OK, or count the received part?
2. **Finished jobs:** keep jobs whose MO is Fulfilled in the report, or drop them by default?
3. **Entered (not yet issued) MOs:** include their requirements, or only Issued/Partial MOs?
4. **Credit return / vendor return PO lines:** exclude (assumed).
5. **Ordered qty less than required:** currently status is by PO line only (Nick: "we don't look at the quantity"). Shown as a note only – confirm.
6. **Percentages:** removed for now (R1). Easy to add back to View 1 later.
7. **Metalwork:** parked (R7) – revisit if it needs its own bucket.

---

## 9. Build & test checklist

1. Run the Section 6 checks on the TKMS **training** database and correct table/column names.
2. Build View 2 first. Pick one real job (e.g. P2515) and compare against Nick's spreadsheet part by part. Expect small differences from R2 (unique parts vs BOM lines).
3. Check the self-check arithmetic in View 1.
4. Build Views 3–6 and confirm every View 1 count can be traced to rows.
5. Publish as a BI report (Reporting › BI Editor › Import › Publish), give the Full access group permission, and walk Nick through how each view explains the summary.
