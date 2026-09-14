# AvailableToBuild — UOM conversion + staging fixes

Fixes for Fishbowl's **stock** Available-to-Build report, taken from
`C:\Program Files\Fishbowl\server\reports\ManufactureOrder\` (file date 2026-07-16).

Four files here:

| File | What it is |
|---|---|
| `AvailableToBuild.jrxml` | stock + fixes 1–4. Minimal diff; `diff -u` against the installed stock file is the whole change set. |
| `subAvailableToBuild.jrxml` | ditto for the staged sub-assembly subreport. |
| `AvailableToBuild_v2.jrxml` | fixes 1-4, renamed + repointed for `reports/Custom/`. **This is what is deployed.** |
| `subAvailableToBuild_v2.jrxml` | ditto. |
| `cte-experiment/` | the withdrawn staging roll-up (§5) — hung the server, kept for reference. |

The non-`_v2` pair is the minimal-diff reference against stock; the `_v2` pair is
the same content renamed and repointed for `reports/Custom/`.

---

## 1. The headline bug — no UOM conversion in the ATB calculation

The number the report prints as *Available to Build* comes from a derived table:

```sql
MIN(FLOOR(COALESCE(QINVENTORY.QA,0) / bomitem.quantity))
```

`QINVENTORY.QA` is read from `QTYINVENTORYTOTALS`, which is **always in the
part's base UOM**. `bomitem.quantity` is in **`bomitem.uomId`**, a different
column and frequently a different unit. The stock query divides one by the other
with no conversion, so every BOM with a mixed-unit component line is wrong by
exactly the conversion ratio.

The report author clearly knew about the conversion — the outer query already
selects `uomconversion.FACTOR` / `MULTIPLY`, and there is a Jasper variable
`$V{AvailableToBuild}` that *does* apply it (`$F{QTYAVAILABLE} / $V{UomConversion}`).
But that variable is **dead**: nothing renders it. The printed figure is
`$F{AvailableToBuild}`, the un-converted SQL column. The conversion was lost when
the calculation moved out of the Jasper variable and into SQL.

### Measured impact

On the current database, **37 of 110 active BOMs** have at least one component
line whose authored unit differs from its part's stocking unit. All are
understated, because these BOMs are authored in `kg`/`L` while the parts are
stocked in bulk packs (`20L`, `25kg`, `12.5kg`).

| BOM | stock report | corrected |
|---|---|---|
| CM-VB | 155 | 3,109 |
| FM-NO | 138 | 3,459 |
| IM-CK | 129 | 994 |
| IM-CO | 180 | 4,503 |
| IM-DC | 140 | 1,487 |
| IM-SC | 394 | 6,600 |
| IM-VB | 132 | 3,310 |
| R&D Bench Test | 630 | 12,603 |
| SM-NC | 524 | 10,489 |
| YM-GK | 973 | 14,604 |

The binding component on CM-VB is `FOOD095`: **0.015 L** per build of a part
stocked per **20L** drum, i.e. 0.00075 drums per build. The stock report divides
the 2.332 drums on hand by `0.015` instead of `0.00075`.

### The fix

Both ATB derived tables (the report carries two identical copies — one for the
BOM, one joined by `stagebomid` for staged sub-assemblies) now convert:

```sql
MIN(FLOOR(COALESCE(QINVENTORY.QA,0) / NULLIF(
    CASE WHEN bomitem.uomid = part.uomid THEN bomitem.quantity
         WHEN sucd.id IS NOT NULL THEN bomitem.quantity * COALESCE(sucd.multiply,1) / NULLIF(COALESCE(sucd.factor,1),0)
         WHEN sucr.id IS NOT NULL THEN bomitem.quantity * COALESCE(sucr.factor,1)   / NULLIF(COALESCE(sucr.multiply,1),0)
         ELSE bomitem.quantity END
, 0))) AS qty
```

`sucd` is the direct `uomconversion` row (`bomitem.uomId` to `part.uomId`);
`sucr` is the reverse row, inverted. Fishbowl writes both directions — verified
here: all 128 conversion rows have their reverse and no duplicate pairs exist —
but a hand-built pair may only have one. `NULLIF(..., 0)` also removes the latent
divide-by-zero on a zero-quantity BOM line.

The same reverse-aware treatment is applied to the outer query's `FACTOR` /
`MULTIPLY` columns, which feed `$V{UomConversion}` and the `RestrictingAtb`
conditional style that highlights the limiting component.

### The division has to come last

The first cut of this fix pre-computed the ratio, `quantity * (multiply / factor)`.
That rounds twice and lands just **above** the true value, which flips a `FLOOR`
boundary and silently loses a whole build:

* `FOOD167` is 0.05 kg of a part stocked per 20kg = **0.0025** bags per build.
* `quantity * (multiply / factor)` gives `0.0025000000000000005`.
* 26.2225 bags on hand / 0.0025 = exactly **10489**; / the rounded value = **10488**.

So the divisor is written `quantity * multiply / factor`, one rounding, division
last. That is also the form the report's own `$V{UomConversion}` uses, so the
highlighted constraint row and the headline figure now agree. SM-NC in the table
above is 10,489 because of this.

### Unconvertible lines are flagged, not silently assumed

The stock query's `COALESCE(UOMCONVERSION.FACTOR,1)` silently assumes **1:1**
when no conversion row exists. The fix keeps that fallback — so the report still
renders — but exposes it:

* new `uomrisk` column on both derived tables,
* new fields `AvailableToBuildRisk` / `AvailableToBuildStageRisk`,
* the empty spare `staticText` slot in the BOM group header now prints a red
  **"check UOM"** beside any BOM where the fallback was used.

There are **zero** such lines on the current database, so this is defensive only.

---

## 2. Staged sub-assembly ATB was blank below the first level

In `subAvailableToBuild.jrxml`, the `availableToBuildStage` derived table was
filtered `where bom.id = $P{bomID}` and then joined
`ON availableToBuildStage.bomID = bomitem.stagebomid`.

A BOM never stages itself, so `bomID` could never equal `stagebomid`: the join
never matched, and the staged sub-assembly's own buildable quantity printed blank
at every nesting level below the first. Now scoped to the BOMs this one actually
stages:

```sql
where bom.id IN (SELECT bi2.stagebomid FROM bomitem bi2
                 WHERE bi2.bomid = $P{bomID} AND bi2.stage = 1
                   AND bi2.stagebomid IS NOT NULL AND bi2.stagebomid <> -1)
```

Note `stagebomid <> -1`: non-staged lines carry `-1`, not `NULL`.

This fix ships in both pairs.

---

## 3. Reorder-point / order-up-to precedence was inverted

```sql
COALESCE(COMPANYWIDERP.ORDERUPTOLEVEL, PARTREORDER.ORDERUPTOLEVEL,0)  -- company-wide first
COALESCE(PARTREORDER.REORDERPOINT,     COMPANYWIDERP.REORDERPOINT,0)  -- per-LG first
```

The two lines disagree with each other. Per-location-group now wins for both,
with company-wide as the fallback. Affects the *Qty Needed* column.

`CompanyWideRP` was also joined on `part.id` alone. Company-wide reorder rows are
the ones with `locationGroupId IS NULL`; without that predicate the join picks up
**every** `partreorder` row for the part and multiplies the detail rows.
Predicate added.

---

## 4. The v2 subreport called the stock subreport

`subAvailableToBuild` recurses into itself for nesting below the first level. The
generator only rewrote the *main* report's subreport path, so the first cut of
`subAvailableToBuild_v2.jrxml` still called
`../ManufactureOrder/subAvailableToBuild.jasper` — a staged tree deeper than one
level would have quietly fallen back to the un-converted stock numbers. Both v2
files now reference `../Custom/subAvailableToBuild_v2.jasper`.

The v2 files also got fresh UUIDs. The two stock files share one
(`a6345d00-…`), which the copies inherited; since v2 now lives alongside stock in
the same install, distinct ids remove an unknown.

---

## 5. Staged roll-up — BUILT, THEN WITHDRAWN (it hung the server)

The first `_v2` cut made a staged sub-assembly contribute what it could build,
not just its on-hand stock:

```
effective available(component) = on-hand available
                               + builds(its staged sub-BOM) x units per build
```

applied unconditionally — `bom.autoCreateTypeId` deliberately *not* consulted,
because whether Fishbowl would raise the sub-assembly's work order automatically
is a workflow preference, not a statement about what can physically be built.
Both figures were carried (staging-aware total, plus an "on hand N" portion).

**It is not deployed. Running it hung Fishbowl.**

### Why it hung

Two things, and the first is almost certainly fatal on its own:

* **`stagetree`, the recursive depth probe.** It enumerated every **path** from
  **every** BOM down to depth 12, with **no root filter**:

  ```sql
  stagetree AS (
    SELECT bi.bomid AS rootbom, bi.stagebomid AS child, 1 AS depth
    FROM bomitem bi WHERE bi.groupdefault = 1 AND bi.stage = 1 AND bi.stagebomid > 0
    UNION ALL
    SELECT t.rootbom, bi.stagebomid, t.depth + 1
    FROM stagetree t JOIN bomitem bi ON bi.bomid = t.child ...
    WHERE t.depth < 12
  )
  ```

  Path enumeration is **exponential in branching factor** — a BOM set branching
  ~3 ways yields on the order of 3^12 (~500k) rows *per root*, times every root.
  A staging **cycle** never converges either; it just fans out to the depth bound.
  All of that existed to print a cosmetic **"staged >3 deep"** warning.

* **Four unindexed temp-table joins bolted onto an already-huge plan.** The outer
  query gained `LEFT JOIN`s to the materialised `lvl3`/`lvl0` CTEs on
  `(bomid, lgid)`. The stock report's own plan already estimates ~418M rows (its
  `qtyonhand` / `qtyallocated` / … sub-selects are grouped over the whole company
  with no predicate), so adding per-row lookups into unindexed temp tables on top
  of that is a bad multiplier.

This is exactly the risk flagged as unverified before deploying: MySQL returned
its **2^64 overflow sentinel** as the row estimate for the chained-CTE plan, so
the MCP's guard blocked execution and the plan could never be inspected. An
uncostable plan was the warning.

### What is deployed instead

The validated **single-level** fix, expressed as the stock report's own two
derived tables. `diff -u` of the query against stock is 68 lines: the corrected
divisor, four `uomconversion` lookups (a 128-row table), the `uomrisk` flag, and
the ROP/OUL corrections. **No CTEs, no recursion, no extra joins in the outer
query** — the plan shape Fishbowl already ran.

The withdrawn CTE pair is kept under `cte-experiment/` for reference.

### If the staged roll-up is wanted later

* Drop `stagetree` entirely. Depth is not worth a recursive path enumeration; if
  a warning is really needed, bound it per-root or compute it client-side.
* Fold the level chain into the existing derived tables rather than adding CTE
  joins to the outer query, so the outer plan is unchanged.
* Fix the stock report's unfiltered `qty*` sub-selects first — a plan that
  already estimates 418M rows has no headroom for anything else.
* Validate on a database that **has** nested BOMs, and confirm MySQL can cost the
  plan (a real row estimate, not the overflow sentinel) before deploying.

---

## Deploying

Deployed to `C:\Program Files\Fishbowl\server\reports\Custom\` as
`AvailableToBuild_v2.jrxml` + `subAvailableToBuild_v2.jrxml`. Custom rather than
`ManufactureOrder/` so a Fishbowl upgrade cannot overwrite them and the stock
report stays available for comparison.

**Fishbowl runs the compiled `.jasper`, not the `.jrxml`.** After replacing a
`.jrxml`, its stale `.jasper` must be removed or Fishbowl keeps running the old
query. The `.jasper` pair Fishbowl built from the withdrawn CTE version has been
moved to `Custom/_stale_cte_jasper/` for exactly this reason — delete that folder
once the new build is confirmed good.

Remaining manual step: add **both** files through the Fishbowl client's report
module so it compiles each and writes a fresh `.jasper`. The subreport in
particular must be compiled, or the staged detail band will fail to resolve
(the main report references it by compiled path).

---

## Verification status

Validated against the live database:

* the corrected ATB figures for all 10 affected BOMs in the table above, matching
  independently hand-computed SQL — including the 10,489/10,488 boundary case;
* the full patched stock query passes MySQL `EXPLAIN` with every alias resolving;
* both new Jasper expressions and the new field classes **compile clean** against
  JasperReports 5.6.0.1 + Fishbowl 26.5 jars on Java 21 — an exact match for this
  install (`Fishbowl/lib/jasperreports-5.6.0.1.jar`, Zulu 21.0.11);
* the deployed query's `diff -u` against stock is 68 lines and adds **no** new
  join to the outer query beyond two `uomconversion` lookups (a 128-row table),
  so the plan shape is the one Fishbowl already ran.

**Not** validated:

* **Not yet rendered end to end on the corrected build.** The numbers are
  DB-verified; the report itself needs one run.
* **The figures were validated on a different database from the one the client
  runs.** The validation DB (behind the iReport MCP) is a food-manufacturing set
  with **zero** staged BOM lines; the desktop client points elsewhere. The UOM
  arithmetic is data-independent, but the §2 staged-scope fix could not be
  exercised — it needs a run against nested BOMs.
* **The withdrawn CTE version was never costable and hung the server** — see §5.
  Treat any future addition to this query with that as the precedent: if MySQL
  returns the 2^64 overflow sentinel for the row estimate, do not deploy it.

---

## Known, NOT changed

* **A build count is labelled with a component's UOM.** The BOM group header
  prints `$F{AvailableToBuild}` (a count of builds) beside `$F{BOMITEMUOM}` (the
  UOM of whichever detail row sorted first). It reads correctly only because
  `BOMITEMTYPE.NAME` sorts "Finished Good" ahead of "Raw Good", so the first row
  is usually the finished good. It misreads for co-product BOMs and for the
  `Note` / `Bill of Materials` item types. Fixing it means changing the group's
  sort — riskier than the benefit.
* **The report is expensive by construction.** The `qtyonhand` / `qtyallocated` /
  `qtynotavailable` / `qtyDropship` sub-selects are grouped over the whole company
  with no part or location-group predicate. MySQL EXPLAIN estimates ~418M rows for
  a single-BOM run — that is stock behaviour, untouched here.
* **Shared components are not allocated between staged sub-assemblies.** If a
  parent and its sub-assembly both consume the same raw part, §5 credits the
  sub-assembly's buildable quantity without reserving that shared stock, so a
  tree with overlapping components can be optimistic. Doing it properly needs an
  allocation pass, not a fold.
