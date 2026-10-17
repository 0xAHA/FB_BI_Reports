# Scope: TKMS Project Procurement Status (BI report)

**Client:** TKMS Sonotech · **Users:** Nick Wright; Saxon Fiori / Elena Jiang's weekly managers' meeting
**Brief:** `BRIEF_Project_Procurement_Status.md` (Yana Belichenka; rules agreed 9 Oct 2026)
**Scoped:** 9 Oct 2026 · **Status:** built 9 Oct 2026 and desk-tested on demodb (§11). **Not yet run
on the TKMS database or tested by the client.**

---

## 1. Verdict

It can be built as one read-only BI report with the brief's six tabs: no writes and no server
changes. The business rules stand. The starter SQL doesn't: §3 lists eleven corrections, each
checked on demodb. The three gaps in the rules (§4) were settled on 9 Oct. The remaining questions
have safe defaults (§5). Rough size: **~5.5 days** (§8).

---

## 2. What we build

- **File:** `Custom/Client Reports/TKMS/Project_Procurement_Status.htm`, started from `Template/Core_Dashboard_Template.htm`.
- **Identity:** key `cdx.bi.tkmsProcStatus`, name `- Purchasing - TKMS Project Procurement Status`
  (confirmed 9 Oct). The name follows the client-report convention (`- Sales - Babor SO Entry`).
- **Shared parts:** fb-lib and fb-styles directives; FBLib MultiSelect filters; saved views through
  FBLib.FilterViews; an .xlsx export of each tab through FBLib.Export, since Nick works in Excel; the debug drawer.
- **Links:** SO, MO, PO and part numbers open their modules through `openModule`.
- **Drill-down.** This is what "every number explainable" means in the UI:
  - Click a View 1 count to open View 2, filtered to that job and status.
  - Click a View 2 row to open Views 3 and 4, filtered to that job and part.
  - Click a Stock Note to open that part's row in View 5.

### Data model: five reads, with the rules in one JS function

The brief works out the status in SQL, then wraps that query again to build View 1. Instead:

| Read | Returns | Feeds |
|---|---|---|
| **R-Req** | every raw-good MO line on the selected jobs' MOs, with its stage, WO, UOM factor and built-in-house flags | View 3; View 2 Qty Required |
| **R-PO** | every PO line whose Customer Job is a selected job, in **any** status | View 4; View 2 Ordered / Received |
| **R-OH** | on hand and committed per part in the project location group(s), limited to R-Req parts | Views 2, 5 |
| **R-Dem** | open demand per part per job across all open job MOs, limited to R-Req parts | View 5, Stock Note |
| **R-Exc** | the View 6 checks | View 6 |

- `classify(job, part)` applies R2–R10 once. View 2 is its output, and View 1 is a JS group-by
  over View 2, so the brief's self-check arithmetic holds by construction. The report still asserts
  the arithmetic and shows a red banner if it ever fails; that check guards the code.
- A PO line's "Included?" in View 4 comes from the same predicate the status uses, so the excluded
  reasons can't drift from the counts.
- Every read is limited to the selected jobs (`so.customerId IN (…)`, `poitem.customerId IN (…)`,
  `tag.partId IN (…)`) and runs through `runQueryAsync`. A load token discards a stale result when
  the job filter changes mid-load.

---

## 3. Corrections to the brief

All checked on demodb. Recheck them on TKMS with the §9 queries.

| # | The brief has | What the schema actually does | Change |
|---|---|---|---|
| C1 | moitem types 10 FG / 20 raw; "check a type lookup" | There's no `moitemtype` table. The types are 10 finished good, 20 raw good and **50 build header**. A WO points at a type-50 header (`wo.moItemId`), and that build's raw lines and FG hang off the header by `parentId`. | View 3's stage = the raw line's `parentId` header → that header's type-10 child (the stage FG) and the `wo` on that header. |
| C2 | R3: exclude a raw good that is also an FG on the same MO (matched by part) | A staged sub-assembly is a type-20 line with `stage` set and its own **type-50 child header**. The part match also catches multi-build MOs where a separate, unlinked build makes the same part (9 such lines on demodb). | Keep the rule, but split the View 3 reason: *Excluded – staged sub-assembly (WO …)* or *Excluded – made by another build on this MO*. |
| C3 | Every raw-good line is a part to buy | Labour and overhead parts are raw-good lines too ("Labour Manufacturing" is on most demodb builds). They would sit at To Be Ordered forever. | Exclude part types Labor (21) and Overhead (22) by default, and list them in View 3 as *Excluded – labour/overhead* (Q5). |
| C4 | Statuses matched by name (`ps.name IN ('Issued', …)`) | The IDs are fixed. PO: 10 Bid Request, 15 Pending Approval, 20 Issued, 40 Partial, 60 Fulfilled, 70 Closed Short, 80 Void. MO: 10 Entered, 20 Issued, 50 Partial, 60 Fulfilled, 70 Closed Short, 80 Void. | Filter by ID. |
| C5 | PO lines filtered by header status only | Line-level filters are missing. A **voided line** (`poitem.statusId` 70) on an Issued PO would count as Ordered forever. Credit returns (types 20/21) and shipping lines (40) would count too. | A line is included when the header status is 20/40/60/70, the line is neither Void (70) nor Closed Short (60), and the line type is 10 Purchase or 11 Misc. Purchase. Out Sourced (30) is Q6. |
| C6 | "Fully received" = qty (correct) | Keep it qty-based. `poitem.qtyFulfilled` updates **when the goods are received**, but the line stays *Partial* until it's reconciled: 38 of 42 Partial lines on demodb are fully received. A status-based rule would undercount Received. | `received = qtyFulfilled ≥ qtyToFulfill`, on included lines only (see C11). |
| C11 | Closed Short is a PO header status | **Closing a line short rewrites `poitem.qtyToFulfill` down to the quantity received** (poitem_aud: line 325 went 20 → 18, line 340 went 152 → 100). Afterwards the line reads as fully received, so the qty rule alone would mark every short-closed part Received. The header status doesn't settle it either: a Closed Short PO also holds lines that were received in full (PO 50007 has 11 of them), and those receipts are real. | Judge at line level. A line in status 60 (Closed Short) is **neither received nor on order**: it's excluded from the status (G3). A fully received line on a Closed Short PO counts as normal. The quantity originally ordered survives only in `poitem_aud`: take the last revision before the line reached status 60. |
| C7 | `SUM(qtyToFulfill)`; View 6 flags BOM UOM ≠ part UOM | MO lines and PO lines each carry their own UOM. demodb has mm against 4.8 m stock, kg against a 20 kg bag, and pk against ea. Summing or comparing raw quantities is wrong wherever the units differ. | Convert every line to the part's stocking UOM through `uomconversion`, using the direct row or its inverse and never a chain. With no conversion found, leave the value blank and add a View 6 row; never assume 1:1. Show Required, Ordered and Received, and the Qty Note, in the stocking UOM, labelled with the unit. |
| C8 | On hand from the `qtyonhand` view | `qtyonhand` is a TEMPTABLE view. It totals every part in every location group before the filter applies. | Use `tag ⋈ location` with `tag.typeId IN (30,40)`, limited to the job's parts and the project location group. On demodb this takes single-digit ms, against ~94 ms for the qty views. |
| C9 | Shared demand = `qtyToFulfill − qtyFulfilled` on Issued/Partial MOs | A Fulfilled, Closed Short or Void line (moitem 50/60/70) can keep a residual quantity, which is phantom demand. It has the same UOM problem as C7. | Count open demand only from lines with status < 50, converted to the stocking UOM. |
| C10 | Location group matched by the name "Project Warehouse" | This works, but a rename silently zeroes On Hand. | Make the project location group(s) a setting, defaulting to the one named Project Warehouse, and warn if none match. |

The brief's other assumptions hold: `mo.soId` exists (one SO can have more than one MO, which the
report handles), and so do `poitem.customerId`, `poitem.dateLastFulfillment` and `po.vendorSO`.

---

## 4. Gaps in the rules: decided 9 Oct

**G1. Parts used from stock fall back to To Be Ordered.** "In Stock" means on hand > 0 *now*. A
part taken from stock without a job PO shows In Stock until its WO consumes it. Then on hand drops,
and if none is left the part flips to **To Be Ordered**. To Be Ordered would rise as builds
progress, which is the opposite of what management is watching for.
**Decided:** a requirement counts as covered once its MO lines are issued
(`moitem.qtyFulfilled ≥ qtyToFulfill`). It shows as **In Stock**, with the reason "Already issued to
WO …". The four agreed statuses and the arithmetic stay as they are.

**G2. Sub-assemblies made on a separate MO.** R3 only excludes *staged* sub-assemblies. A part
TKMS makes on its own MO, rather than as a stage of this job's BOM, has no PO, so it would show To
Be Ordered.
**Decided:** when the part has an active BOM, keep it counted, set the Status Reason to "Made
in-house – no PO expected", and list it in View 6.

**G3. Closed Short PO lines** (brief §8 Q1). A short-closed line is **not received**, and it isn't
on order either, because nothing more is coming (C11).
**Decided:** a line in status 60 is excluded from the status. View 4 lists it as *Excluded – closed
short (received 18 of 20)*. The part's status then comes from its other job lines. With none left,
the normal rules apply:
- **In Stock** when the short receipt is on hand. The Status Reason reads "PO 1043 closed short,
  18 of 20 received; no open PO for the rest", and the Stock Note shows on hand < required.
- **To Be Ordered** otherwise.

Either way, the shortfall stays visible until someone raises a new PO for it. Fully received lines
on a Closed Short PO count as Received, as normal.

---

## 5. Open questions, with the default we build to

| # | Question | Default if unanswered |
|---|---|---|
| Q1 | G1: covering parts already issued to a build | **Decided 9 Oct:** fold into In Stock |
| Q2 | G2: sub-assemblies made on a separate MO | **Decided 9 Oct:** keep counted, flag them |
| Q3 | G3: Closed Short PO lines (brief Q1) | **Decided 9 Oct:** not received; the line is excluded and the part falls through to the normal rules |
| Q4 | Which jobs and MOs count (brief Q2/Q3)? | **As built:** the job picker lists *open* jobs, those with at least one MO in 10 Entered, 20 Issued or 50 Partial. "Finished jobs" adds the rest; it's off by default. A listed job counts **every non-void MO**, including fulfilled phases, because the job needed those parts too. An MO line closed short with nothing issued is left out. Shared demand counts only open lines (status < 50) on open MOs. |
| Q5 | Which part types count as parts? | Everything except Labor and Overhead. Service and Non-Inventory parts count; they're bought on a PO and never show In Stock. |
| Q6 | Out Sourced PO lines (type 30): does TKMS use them, and does one order the part? | Excluded, with the reason *Excluded – outsourced line* |
| Q7 | Is Third Party Property its own location group, or locations inside Project Warehouse? | Its own group, so C10 excludes it. If it's inside, the report needs a location exclusion setting. |
| Q8 | Is the Vista PO number in `po.vendorSO` or in a PO custom field? | `vendorSO` |
| Q9 | Project Warehouse stock committed to another job's pick: does it count as on hand? (Brief R9: stock isn't reserved.) | Yes; View 5 shows Committed as its own column |
| Q10 | Credit-return lines (brief Q4) | Excluded |
| Q11 | Week-on-week trend (§7) | Not in v1 |
| Q12 | Report name (§2) | **Decided 9 Oct:** `- Purchasing - TKMS Project Procurement Status` |

Carried over from the brief unchanged: no percentages (R1), metalwork parked (R7), and ordered < required shown as a note only (brief Q5).

---

## 6. Views: changes to the brief only

The brief's column lists stand. These are the additions and changes.

- **View 1 Summary:** add the job's SO/MO count and MO status, a totals footer and the self-check
  banner. Every count cell links to View 2.
- **View 2 Part Status:** add a stocking-UOM column. The Status Reason comes from the same facts as
  the status: "2 PO lines, 1 still open (PO 1043)", "No PO for this job; 50 on hand in Project
  Warehouse", or "Already issued to WO …" (G1).
- **View 3 Requirements:** "Counted?" is one of Yes, *Excluded – staged sub-assembly*, *Excluded –
  made by another build on this MO*, *Excluded – labour/overhead* or *Excluded – MO void*. Show the
  quantity in both the line UOM (as on the MO) and the stocking UOM.
- **View 4 Job PO Lines:** "Included?" adds *Pending Approval*, *Void line*, *Credit return*,
  *Shipping* and *Outsourced* to the brief's reasons. *Closed Short* becomes a line-level reason
  that shows the shortfall: *Excluded – closed short (received 18 of 20)*. Qty Ordered on that
  line is the original quantity from `poitem_aud` (C11). Bid Request lines stay visible, so a buyer
  can see the line exists but isn't issued yet.
- **View 5 Shared Stock:** one row per part, which expands to one row per job. Add a Committed column.
- **View 6 Exceptions:** the brief's five checks, with two changes. "BOM line UOM ≠ part UOM"
  becomes "no UOM conversion" (C7), and G2's made-in-house parts are added. For "issued PO lines
  without a Customer Job", point TKMS at the existing `- Purchasing - Bid Request Customer Job`
  report. It sets Customer Job on Bid Requests before they're issued, the one place to fix this in bulk.

---

## 7. Out of scope (v1)

- **A week-on-week trend.** Fishbowl keeps no history of these counts. If management wants a line
  over time, phase 2 could add an admin "Save this week's snapshot" that stores View 1 per job
  through FBLib.SharedData and shows it as a sparkline.
- **Writes of any kind**, such as setting Customer Job or creating POs.
- **Percentages and a metalwork bucket** (R1, R7).

---

## 8. Plan and size

| Stage | Work | Days |
|---|---|---|
| 0 | Run the §9 checks on the TKMS training DB; get answers to Q4–Q12 | 0.5 |
| 1 | Shell and settings (project location group, part types, finished jobs); R-Req, R-PO and R-OH; `classify()`; Views 2 and 1 | 1.5 |
| 2 | Views 3 and 4 with their reasons; drill-down wiring | 1 |
| 3 | R-Dem and View 5; R-Exc and View 6 | 1 |
| 4 | Filters, saved views, .xlsx export, help drawer | 0.5 |
| 5 | Desk test on demodb with the live-SQL harness, then check job P2515 part by part against Nick's spreadsheet; fixes | 1 |
| | **Total** | **~5.5** |

**demodb test jobs:**
- "BB Cycles": 28 parts, 4 job PO lines.
- "Allan's Raceway": 12 parts, 7 job PO lines. It includes PO 167, a Partial PO whose line is fully received (C6).

Together they cover every status. demodb has no closed-short line with a Customer Job. To test G3
and C11, set a Customer Job on PO 19's LED001 line (closed short at 18 of 20).

---

## 9. Checks to run on TKMS before the build

These replace brief §6. Run them one at a time.

```sql
SELECT typeId, stage+0 AS stg, COUNT(*) AS n FROM moitem GROUP BY typeId, stage+0;            -- C1: expect 10 / 20 / 50
SELECT id, name FROM postatus;                                                               -- C4
SELECT id, name FROM poitemstatus;                                                           -- C5
SELECT id, name FROM poitemtype;                                                             -- C5, Q6
SELECT id, name FROM mostatus;                                                               -- C4
SELECT id, name FROM locationgroup;                                                          -- C10, Q7
SELECT COUNT(*) AS n, SUM(soId IS NOT NULL) AS linked FROM mo WHERE statusId IN (10,20,50);
SELECT po.statusId, COUNT(*) AS n, SUM(pi.customerId IS NOT NULL) AS withjob
  FROM poitem pi JOIN po ON po.id = pi.poId GROUP BY po.statusId;
SELECT p.typeId, COUNT(*) AS n FROM moitem mi JOIN part p ON p.id = mi.partId
  WHERE mi.typeId = 20 GROUP BY p.typeId;                                                    -- C3, Q5
SELECT COUNT(*) AS n FROM moitem mi JOIN part p ON p.id = mi.partId
  WHERE mi.typeId = 20 AND mi.uomId <> p.uomId;                                              -- C7
SELECT COUNT(*) AS n FROM poitem pi JOIN part p ON p.id = pi.partId WHERE pi.uomId <> p.uomId; -- C7
SELECT typeId, COUNT(*) AS n FROM poitem GROUP BY typeId;                                    -- Q6
SELECT num, vendorSO, customFields FROM po WHERE statusId IN (20,40,60) ORDER BY id DESC LIMIT 20; -- Q8
```

---

## 10. Reference SQL (tested on demodb)

**R-Req**: 131 lines in 104 ms on demodb, with no job filter.

```sql
SELECT c.id AS jobid, c.name AS job, so.num AS sonum, mo.num AS monum, mo.statusid AS mostatus,
       mi.id AS lineid, mi.partid, p.num AS partnum, p.typeid AS parttype, mi.statusid AS linestatus,
       mi.qtytofulfill AS qty, mi.qtyfulfilled AS qtydone, u.code AS uom, pu.code AS baseuom,
       COALESCE(cf.multiply / cf.factor, cr.factor / cr.multiply,
                CASE WHEN mi.uomid = p.uomid THEN 1 END) AS tobase,           -- NULL = no conversion (C7)
       (SELECT GROUP_CONCAT(fp.num SEPARATOR ', ') FROM moitem fg JOIN part fp ON fp.id = fg.partid
         WHERE fg.parentid = mi.parentid AND fg.typeid = 10) AS stagefg,      -- C1
       (SELECT GROUP_CONCAT(w.num SEPARATOR ', ') FROM wo w WHERE w.moitemid = mi.parentid) AS wonum,
       EXISTS (SELECT 1 FROM moitem s WHERE s.parentid = mi.id AND s.typeid = 50) AS stagedsub,   -- C2
       EXISTS (SELECT 1 FROM moitem k WHERE k.moid = mo.id AND k.typeid = 10
                                        AND k.partid = mi.partid) AS madeonmo                     -- C2
FROM so
JOIN customer c ON c.id = so.customerid
JOIN mo ON mo.soid = so.id AND mo.statusid <> 80
JOIN moitem mi ON mi.moid = mo.id AND mi.typeid = 20
JOIN part p ON p.id = mi.partid
LEFT JOIN uom u  ON u.id = mi.uomid
LEFT JOIN uom pu ON pu.id = p.uomid
LEFT JOIN uomconversion cf ON cf.fromuomid = mi.uomid AND cf.touomid = p.uomid
LEFT JOIN uomconversion cr ON cr.fromuomid = p.uomid AND cr.touomid = mi.uomid
WHERE so.customerid IN (/* selected jobs */)
```

**R-PO**: 24 lines in 15 ms on demodb. It returns every status; `classify()` decides what's included.

```sql
SELECT pi.id AS lineid, pi.customerid AS jobid, po.num AS ponum, po.statusid AS postatus,
       pi.statusid AS linestatus, pi.typeid AS linetype, v.name AS vendor, po.vendorso,
       pi.partid, pi.partnum, pi.qtytofulfill AS qty, pi.qtyfulfilled AS qtydone,
       COALESCE(cf.multiply / cf.factor, cr.factor / cr.multiply,
                CASE WHEN pi.uomid = p.uomid THEN 1 END) AS tobase,
       po.dateissued, pi.datescheduledfulfillment, pi.datelastfulfillment
FROM poitem pi
JOIN po ON po.id = pi.poid
JOIN vendor v ON v.id = po.vendorid
LEFT JOIN part p ON p.id = pi.partid
LEFT JOIN uomconversion cf ON cf.fromuomid = pi.uomid AND cf.touomid = p.uomid
LEFT JOIN uomconversion cr ON cr.fromuomid = p.uomid AND cr.touomid = pi.uomid
WHERE pi.customerid IN (/* selected jobs */)
```

**R-OH** (C8):

```sql
SELECT t.partid, SUM(t.qty) AS onhand, SUM(t.qtycommitted) AS committed
FROM tag t JOIN location l ON l.id = t.locationid
WHERE t.typeid IN (30, 40) AND l.locationgroupid IN (/* project LGs */) AND t.partid IN (/* R-Req parts */)
GROUP BY t.partid
```

---

## 11. Build notes and desk test (9 Oct 2026)

**Built:** `Project_Procurement_Status.htm` in this folder. It's read-only and needs fb-styles and
fb-lib saved under those names.

**How it differs from §2–§6:**
- **Company config is set by an administrator.** The project location group(s) and the part types
  left out decide every count, so an admin saves them for everyone. They're stored in the report's
  master settings record (`userproperties`), so no saved report is needed. Other users can try
  other choices for the session, but those aren't saved. With nothing saved, the report uses the
  group named Project Warehouse and leaves out Labor and Overhead.
- **The "PO line without a Customer Job" check is narrowed.** The first desk run listed every old
  stock PO for every part. It now flags:
  - for a part showing **To Be Ordered**, an open line, or one issued since the job's first MO;
  - for a part **In Stock from the shelf**, open lines only;
  - for a part **already issued to its build**, nothing.
- **Shared Stock** has one row per part and job, rather than an expandable part row (FBLib.Table has
  no row grouping).
- **Saved views** store a job selection plus the Finished-jobs toggle, under FilterViews tile `JOBS`.
- **Excel** downloads one workbook with a sheet per tab. Each sheet holds the rows its tab shows, with
  any drill filter named in the subtitle.

**Desk test (live-SQL harness against demodb, project stock = Brisbane):**
- **Real data:** jobs Allan's Raceway and BB Cycles, 35 unique parts, 76 MO lines and 11 job PO lines.
  The Summary self-check passes for both jobs, and an independent recount of the Part Status rows
  matches every Summary count.
- **Drill-down:** Summary count → Part Status filtered to that job, and Part Status PO Lines → that
  job and part's PO lines, including the Bid Request line that isn't counted. Record links call
  `openModule('Purchase Order', '122')` etc. The Excel workbook downloads.
- **Synthetic rows layered over the query results** (nothing written to the database):
  - **Closed short:** a line closed short at 18 of 20 is excluded. View 4 shows "received 18 of 20",
    using the original 20 from `poitem_aud`, and the part falls back to To Be Ordered with that reason.
  - **Open line:** gives Ordered, with "Ordered 100 < required 255 kg".
  - **Void line:** excluded.
  - **Fully received line on a Closed Short PO:** counts as Received.
  - **Shared stock:** on hand 3 against open demand 6 on two jobs is flagged on the part and counted
    on Summary.
- **No project location group set:** a banner explains it, On Hand is blank, and the counts still
  add up.

**Not tested:**
- Anything inside the Fishbowl client: `openModule('Work Order', …)` and `('Manufacture Order', …)`,
  FilterViews publishing, and the admin Save.
- The TKMS database itself. Run the §9 checks there first. Then check job P2515 part by part against
  Nick's spreadsheet.
