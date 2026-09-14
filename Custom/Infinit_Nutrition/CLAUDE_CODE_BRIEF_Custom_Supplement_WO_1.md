# Brief: Custom_Supplement_WO.htm — real discovery, stepped customisations, and a Setup tab

**Target file:** `Custom/Infinit_Nutrition/Custom_Supplement_WO.htm`
**Requirements from:** Zoom "Fishbowl / Infinit - Check In", 14 Aug 2026 (Andrew + Stacy Manczal); `Fishbowl Custom Base 1.xlsx` sheets `PF Custom` and `Custom Hydration Values`; the derived `Report Config` and `Open Items` sheets in the annotated copy of that workbook.

Read the whole brief before editing. The read path and the create path are sound and should not be rewritten — the work is in **how lines are discovered**, **how the part is resolved**, **the customisation contract**, and **making all of it configurable instead of hardcoded**.

Do §0 first. It is a live bug, independent of everything else.

---

## 0. Bug: the BOM is looked up by product number, not by part

`CSBuild.open()` calls `resolveBaseRecipe(row.product_num)`, and `bomHeaderSQL` matches `fgpart.num = '<that value>'`.

But the finished good on a BOM is the **part**, reached `soitem.productId → product.partId → part.id`, and that part's `num` can differ from the product's `num`. Wherever they differ, the lookup finds nothing, falls back to the fixture recipe, and reports *"No active BOM found whose finished good is part X"* — which reads as missing data rather than as a wrong lookup. The comment above `buildSQL` already documents the `product.partId` hop correctly; only the BOM call ignores it.

The main query already selects `pt.id AS part_id` and `pt.num AS part_num`. Fix:

- `resolveBaseRecipe(partId, partNum)` — pass the id, keep the num for messages only.
- `bomHeaderSQL(partId)` matches on `fgbi.partid = <int>` instead of `fgpart.num = '<string>'`. An integer id join is both correct and cheaper than a string match.
- Keep the `groupdefault = 1` and `bom.activeflag = 1` conditions exactly as they are.
- When `part_id` is null (`product.partId` is nullable), block the line with *"product X is not linked to a part"* — distinct from *"no BOM"*. These are different failures and should read differently.

Everything downstream — pack mapping, the MO payload — keys on the part, never on `product.num`.

---

## 1. Discovery: a pattern, not a list

`CUSTOM_PRODUCTS` is a hardcoded four-item `IN` list. Replace it with a pattern rule:

> Open sales orders carrying products where **`product.num` LIKE `%CUST%` OR `product.description` LIKE `%CUST%`**.

In `buildSQL()`, replace the `COALESCE(p.num, si.productNum) IN (...)` clause with an OR-ed `LIKE` group, keeping the existing `so.statusId IN (10,20,25)` and `si.typeId IN (10,12)` conditions:

```sql
AND (   COALESCE(p.num, si.productNum) LIKE '%CUST%'
     OR p.description                  LIKE '%CUST%' )
```

Notes on this:

- Keep `COALESCE(p.num, si.productNum)` for the number so lines whose product was deleted stay visible — that is why the existing query has it.
- Patterns come from config as a list, so a second range can be added without a code change. Default: `%CUST%` against both fields.
- The **product filter dropdown** should now be populated from what the query actually returned, not from a static list. `loadReferenceData()` currently does `state.products = CUSTOM_PRODUCTS.map(...)`; change it to derive from `state.rows` in `adoptRows()` the same way `state.customers` already does. When the user narrows the product filter, that becomes an additional `IN` clause **on top of** the pattern, not a replacement for it.
- Report the discovery pattern in the empty state: *"No open lines matched `%CUST%`"* is diagnosable; *"No custom-supplement lines found"* is not.

The trade for pattern discovery is that a new CUST SKU appears on its own but has no pack mapping. That must render as **unmapped and blocked**, never defaulted — see §3.

---

## 2. Everything is stepped. There are no continuous ranges.

This is the core correction to the model. Replace `MODIFIER_TABLE` with a **step table**: one row per (item, step, serves-per-pack).

```js
{
  key: 'CAF',                  // short code as it appears in soitem.note
  label: 'Caffeine',
  partNum: 'RAW-CAFFEINE',     // or 'explode' — see targets
  kind: 'quantity',            // 'quantity' | 'substitution'
  steps: [
    { label: 'None',  perServe: 0,   unit: 'mg', qtyPerPack: { 25: 0,   18: 0    } },
    { label: '25mg',  perServe: 25,  unit: 'mg', qtyPerPack: { 25: 1.3, 18: 0.93 } },
    { label: '50mg',  perServe: 50,  unit: 'mg', qtyPerPack: { 25: 2.5, 18: 1.8  } },
    { label: '75mg',  perServe: 75,  unit: 'mg', qtyPerPack: { 25: 3.8, 18: 2.74 } },
    { label: '100mg', perServe: 100, unit: 'mg', qtyPerPack: { 25: 5,   18: 3.6  } }
  ],
  materialFactor: 2.00,        // used to DERIVE a pack qty the table doesn't state, and to check the ones it does
  targets: [ { partNum: 'RAW-CAFFEINE', ratio: 1.0, uom: 'g' } ]
}
```

Why `qtyPerPack` is an explicit lookup rather than a calculation: **the conversions are not linear and the sheet states the answers directly.** Caffeine at 25 mg/serve on a 25-serve bag is 1.3 g of RAW-CAFFEINE on the sheet; deriving it gives 1.25 g. Electrolytes at Low on a 25-serve bag are 49.07 g against 35.33 g on an 18-serve bag. Where the sheet gives a figure, use the figure. `materialFactor` exists to derive the gaps and to flag disagreement, not to replace the table.

Two `kind`s cover every item:

**`quantity`** — consumes a component. Steps carry `perServe` and, where known, `qtyPerPack`. Includes the two-step items (Protein `None`/`10g`, BCAA `None`/`3g`, and each Premium Fuel Boost as `Off`/`On`) — a two-step item is not a special case, just a short step list.

**`substitution`** — changes *which* part is consumed, quantity untouched:

```js
{ key:'FLV', label:'Flavour RTU', kind:'substitution',
  substitutesPartPattern: 'FLV-RTU-%',   // the BOM line to replace
  steps: [ { label:'BAN', partNum:'FLV-RTU-BAN' }, { label:'CHOC', partNum:'FLV-RTU-CHOC' },
           { label:'ORG' }, { label:'LLM' }, { label:'GRP' }, { label:'WMN' },
           { label:'CRM' }, { label:'RASP' } ] }
```

**Roll-ups explode into components.** One step, several targets:

```js
{ key:'BCAA', label:"BCAA's", kind:'quantity',
  steps:[ {label:'None', perServe:0, unit:'g'}, {label:'3g', perServe:3, unit:'g'} ],
  materialFactor: 1.0,
  targets:[ { partNum:'TBC-LEUCINE',    ratio:0.50, uom:'g' },
            { partNum:'TBC-ISOLEUCINE', ratio:0.25, uom:'g' },
            { partNum:'TBC-VALINE',     ratio:0.25, uom:'g' } ] }
```

`ratio` must sum to 1.0 across `targets`. **Validate this and refuse to publish a config where it doesn't** — a mis-summed ratio silently under- or over-issues stock, and nothing downstream would catch it.

### The item set

Seven Premium Fuel items, from `PF Custom`. Full step tables are in the workbook's `Report Config` sheet, section 3.

| key | item | steps | state |
|---|---|---|---|
| `FLV` | Flavour RTU | 8 flavour codes, substitution, 253.25 g per batch | parts TBC |
| `FLV-STR` | Flavour strength | Light / Mid / Strong | only one quantity on the sheet — see Q7 |
| `CAL` | Calories | Low / Mid / High | no part, no values — see Q8 |
| `CARB` | Carbohydrate Blend | Simple / Complex | **blocked**, values pending Infinit US |
| `ELEC` | Electrolytes | Low 400 / Mid 500 / High 1000 mg | complete: 49.07 / 61.14 / 122.28 g @25, 35.33 / 44.02 / 88.04 @18 |
| `PROT` | Protein | None / 10 g | part TBC, pack qty derived |
| `BCAA` | BCAA's | None / 3 g | parts TBC, explodes 50/25/25 |
| `CAF` | Caffeine | 0 / 25 / 50 / 75 / 100 mg | complete, but confirm the 2× factor |
| `BOOST-*` | CoQ10 / Beta-alanine / Creatine | Off / On at 0.155 / 0.725 / 0.4 g per serve | parts TBC |

The Custom Hydration range gives only nil and a maximum per item, so **its step lists don't exist yet**. Build the config slots, leave the steps empty, and block any hydration line until they're filled.

---

## 3. Pack mapping

The per-serve step and the per-pack quantity differ by pack size, so the report needs `servesPerPack` — keyed on **`part.num`**, since that is what the BOM hangs off:

```js
{ partNum:'...', family:'PF75', servesPerPack:25, packLabel:'25 serve bag' }
```

16 rows for Infinit: PF75 / PF90 at 25, 12, 5 and 1 (a 24-pack of single serves — the recipe unit is one serve); PF120 at 18, 12, 5, 1; Custom Hydration at 25, 12, 5, 1.

`recipe.outputQty` is the BOM's own output quantity and is **not** the same thing — don't reuse it for this.

A part matched by discovery with no mapping row **blocks the build** with *"part X has no pack mapping — add it in Setup"*. Never default `servesPerPack` to 1: it would post a 25× under-issue that looks like a plausible number.

---

## 4. Calculation order

Per item, in this order:

1. **Resolve the step** from the note. Reject anything not in the step list — never interpolate. `CAF: 60mg` is invalid, not rounded to 50.
2. **Pack quantity.** If `steps[i].qtyPerPack[servesPerPack]` exists, use it verbatim. Otherwise derive `perServe × servesPerPack × materialFactor` and mark the line **derived** in the drawer.
3. **× `ratio`** per target → per-component quantity.
4. **× ordered line quantity.**
5. A **zero step omits the component** rather than posting a zero line.

For `kind:'substitution'`, replace the `partNum` on the matching BOM line and leave its quantity alone.

Fixtures for the tests in §7:

> `CAF: 100mg`, 25-serve bag, qty 2 → `qtyPerPack[25]` = 5 g → **10.0 g RAW-CAFFEINE**.
> `ELEC: Low`, 18-serve bag, qty 1 → **35.33 g** — proves `servesPerPack` is driving it, not a hardcoded 25.
> `BCAA: 3g`, 25-serve bag, qty 1 → derived 75 g → **37.5 / 18.75 / 18.75 g** across three lines.

Retain from the current `resolveRecipe`: clamp-at-zero with a warning, `round6`, `effectiveQty`'s override-else-resolved contract, and quantities staying in each BOM line's own UOM. Change one behaviour — an item whose target part is **not** already a BOM line must be **added** as a new component, not merely warned about. For Infinit, optional ingredients legitimately aren't in the base BOM until chosen.

---

## 5. Note parsing

The note format isn't settled with the Shopify developer — that was Andrew's action from the call. Write to the shape he proposed (*"three-letter abbreviations… protein 1, BCAA 2.5"*) and keep the parser tolerant:

- `KEY: value` pairs separated by commas, semicolons or newlines — unchanged.
- Match `value` against the item's step list: by `label` (`Low`, `None`, `100mg`, `CHOC`), or by `perServe` with an optional unit (`100`, `100mg`, `100 mg`, `3g`, `0.4 g`). Normalise units before comparing, so `0.1g` and `100mg` both resolve to the same step.
- `Off/On`, `Yes/No`, `Y/N`, `true/false`, `1/0` all resolve on a two-step item.
- Keep prose passthrough, case-insensitivity, and the existing `unknown[]` surfacing.
- **New rejection reasons**, all blocking, all rendered as amber chips:
  - value doesn't match any step — *list the valid steps in the message*, as the current unknown-level message already does
  - value is between steps — name the two nearest steps
  - unit mismatch that can't be converted
  - the part has no pack mapping
  - the item's step list is empty (unconfigured)
  - a target part is still `TBC`

The strictness is the report's main value — *"catching bad notes is the point of this report"*. Do not relax it while adding step matching.

---

## 6. The Setup tab

After this change, **nothing about Infinit is in the source**: `CUSTOM_PRODUCTS`, `MODIFIER_TABLE` and `BASE_RECIPES` all go.

### Where it lives

A **dedicated Setup view**, not more fields in `#setOverlay`. The drawer is right for a handful of toggles; this is table editing across four related lists and needs the width. Add a `Report` / `Setup` view switch in the topbar that swaps `#tableScroll` for `#setupScroll`, keeping the existing chrome.

### How it persists

Through the **existing** `FBLib.Settings` payload — don't invent a second mechanism:

- `userKey: 'cdx.bi.customsupp.user.v1'` — untouched, stays per-user display preferences.
- `masterKey: 'cdx.bi.customsupp.master.v1'` — the config goes here, so `publishMaster()` already distributes it org-wide and `toggleUserEditing()` already locks it. Add a `config` key to `defaults`.

Two things to verify before relying on that:

1. **Nested objects.** `defaults` is currently all scalars and arrays of scalars. Confirm `fb-lib` round-trips nested objects and arrays of objects; if it flattens them, store the config as one JSON **string** and parse on read.
2. **Size.** The master payload lands in `userproperties.userValue`. Check that column's length limit against a full config. Keep the config to *references* — patterns, part numbers, step values, ratios, serves-per-pack. **Never copy base BOM components into it**; those come from the live BOM. (Section 2 of the workbook's `Report Config` sheet is reconciliation documentation, not config the report needs.)

### What it edits

1. **Discovery patterns** — field, operator, value. Default two `%CUST%` rows.
2. **Pack mapping** — `partNum`, `family`, `servesPerPack`, `packLabel`, `enabled`. 16 rows.
3. **Adjustable items** — the step tables from §2, with `steps` and `targets` as editable sub-rows.
4. **Base-recipe overrides** — normally empty. Only for a part whose live BOM genuinely can't express something. Keep it visible so nobody re-hardcodes a recipe when the real fix is to fix the BOM.

### Requirements

- **Validate on save, not on use.** Config errors surface while editing: ratios not summing to 1.0, a `partNum` with no matching live part, duplicate keys or step labels, a `qtyPerPack` bucket with no corresponding pack mapping, an empty step list. Resolve part numbers against the database on save and show which don't exist. A failing config may save as a draft but must not be publishable.
- **Show the factor variance.** Where a step has both `qtyPerPack` and a derivable value, display both and flag the gap. This is how the caffeine 2× was found; leave the mechanism in the tool.
- **Bulk import.** Paste-TSV accepting the `Report Config` sheet's rows directly. Nobody should hand-type 16 pack mappings and ~30 step rows.
- **Export.** Dump the config as JSON to the clipboard, so a working config moves between installs and diffs.
- **Live preview.** Given a part, a note and a quantity, show the resolved component list with every arithmetic step visible (step → pack qty → ×ratio → ×qty), and whether each figure was stated or derived. This is what makes a wrong factor obvious before it reaches a work order, and it doubles as the acceptance test.
- **`TBC` parts are first-class.** Most part numbers are still unconfirmed. A config item on `TBC` must save, display as incomplete, and block any line needing it — with a message naming the item. Do not require a complete config to save.

---

## 7. Do not change

- The runtime guards and the three "not running inside Fishbowl / fb-lib / fb-mfg not loaded" failure screens.
- `installPreviewSafeMasterSettings` and its report-id-(-1) workaround.
- Every Create-MO gate: `enableCreateMO` off by default, `createMOGroupId`, `moCreateDryRun` **on** by default, create-as-Entered → verify `moitem` rows → then issue → delete on mismatch.
- The refusal of fixture-sourced and `SAMPLE_ROWS`-sourced rows.
- `MO_MARKER` / `moNote` / `findExistingBuilds` duplicate detection.
- `bomComponentSQL`'s deliberate absence of a `typeid` filter, and the stage / sub-BOM refusal.
- The single `POST /api/manufacture-orders` with the full `configurations[].items[]`, and never patching an issued MO.

Keep `SAMPLE_ROWS`, with product numbers containing `CUST` so they exercise the new discovery, and notes in the step format. Cover: clean parse, unknown key, value between steps, value not in the step list, empty note, prose alongside attributes, a line that already has an MO, a part with no pack mapping, a product with a null `partId`, a part whose num differs from the product num, and an item still on `TBC`.

---

## 8. Acceptance criteria

1. Grep for `CUSTOM-PROTEIN-BLEND`, `WPI-ISOLATE`, `Strength`, `Sweetness` — zero hits outside `SAMPLE_ROWS` and comments.
2. A product numbered `WIDGET-01` whose **description** contains `CUST` is discovered; one with neither is not.
3. A product whose `part.num` differs from `product.num` resolves its BOM correctly (this is §0 — write the test first, against a real pair on the install).
4. A product with a null `product.partId` blocks with "not linked to a part", not with "no BOM found".
5. `CAF: 100mg`, 25-serve, qty 2 → 10.0 g RAW-CAFFEINE.
6. `ELEC: Low`, 25-serve, qty 1 → 49.07 g RTU-ELECTROLYTE-MIX.
7. `ELEC: Low`, 18-serve, qty 1 → 35.33 g.
8. `BCAA: 3g`, 25-serve, qty 1 → 37.5 / 18.75 / 18.75 g on three lines, marked derived.
9. `CAF: 60mg` → blocked, message naming 50mg and 75mg as the nearest steps.
10. `CAF: 150mg` → blocked, not in the step list, valid steps listed.
11. `FLV: CHOC` → the `FLV-RTU-*` BOM line's part is substituted, quantity unchanged at 253.25 g.
12. `CAF: None` → no RAW-CAFFEINE line at all, not a zero-quantity line.
13. A discovered part with no pack mapping → blocked, names the part, tells the user to map it in Setup.
14. An item whose target is `TBC` → line blocked, names the item; the config still saves.
15. A config with `targets` ratios summing to 0.9 → refuses to publish.
16. Config published by an admin is picked up by a non-admin on reload; a locked config isn't editable by them.
17. Dry run on → payload in the debug console, nothing posted.
18. Empty config on a fresh deploy → the report loads, says the config is empty, creates nothing.

---

## 9. To resolve outside the code

Full list in the workbook's `Open Items` sheet. The ones that block:

- **Part numbers** for every `????` on `PF Custom` — 48 cells. Stacy's action from 14 Aug.
- **Custom Hydration step lists** — the tab gives only nil and each maximum. With no continuous ranges, the intermediate steps are required before anything in that range works.
- **The electrolyte roll-up doesn't reconcile** — components total 1.669 g against 0.949 g stated. A 76% discrepancy, and the components are what a work order consumes.
- **The caffeine 2× factor** — confirm whether RAW-CAFFEINE is ~50% caffeine or the mg labels are half the true dose. Wrong either way is a 2× error on a stimulant.
- **Carbohydrate blend values** — still with Infinit US as of 14 Aug. Build the slot, leave it `PENDING`, block the item.

And the open commercial decision: Stacy on 14 Aug — *"I don't want to create anything in Fishbowl for that… we need to hire a whole person for that."* Andrew's counter is that without an MO there is no cost of goods against the sale. This report is the answer to her objection, provided creating the MO is one click from a pre-resolved queue. If the decision lands on weekly reconciliation instead, that needs a **second mode**: total ingredients across everything shipped in a date window, for one scrap transaction with notes. Different query, not a variation on this one.
