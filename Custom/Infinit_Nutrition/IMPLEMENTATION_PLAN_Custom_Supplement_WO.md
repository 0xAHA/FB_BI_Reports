# Implementation plan: Custom_Supplement_WO.htm

**Target:** `Custom/Infinit_Nutrition/Custom_Supplement_WO.htm`
**Derived from:** `CLAUDE_CODE_BRIEF_Custom_Supplement_WO_1.md` + `Fishbowl_Custom_Base_1_annotated_1.xlsx`
(`PF Custom`, `Custom Hydration Values` from the customer; `Report Config`, `Open Items` added from the 14 Aug Zoom).

## Settled scope

Infinit **will create the work orders through this tool**. The per-order queue → one-click MO is the
design. The weekly-reconciliation alternative in the brief's §9 / `Open Items` D is **out of scope** —
no second mode, no shipped-window ingredient totals, no scrap-transaction path. Everything below
assumes per-SO-line MO creation, which is what the report already does.

## Sheet scope: `PF Custom` columns past G are ignored

Confirmed with Andrew. Only the first column block of each batch — **B–H, the 25-serve column** — is
authoritative. Everything from column I rightward (the 12-serve, 5-serve and 24×SS blocks) is noise:
labels with no quantities behind them.

Consequences: the caffeine `200mg` question below is closed; the pack-mapping rows for PF75/PF90 at
12, 5 and 1 serve have **no source figures at all** and are derive-only
(`perServe × servesPerPack × materialFactor`, flagged derived in the drawer); and any bulk import
from this tab must stop at column H.

## The caffeine 200 mg label — checked, not a blocker

`Open Items` Q6 asks whether caffeine's top step is 100 mg or 200 mg. Resolved by inspection:
`200mg per serving` appears in 9 cells (`O21`, `W21`, `AE22` and the same pattern at rows 43/44 and
66/67), all in the **12-serve, 5-serve and 24×SS** column blocks. Those blocks contain **no numeric
values whatsoever** — rows 5–23 across columns I–P are labels only. Every caffeine quantity in the
workbook (`0 / 1.3 / 2.5 / 3.8 / 5`) lives in the 25-serve block at `C22:G22`; the 18-serve figures
come from the `Custom Hydration Values` tab.

So the 200 mg is a label in an unpopulated block, not a step definition. **Build one step list per
item, per serve**, as §2 of the brief has it — no per-pack step scoping, no `validFor` field. Keep the
question on the open list for Stacy (a 2× difference on a stimulant is worth confirming) but it does
not gate any stage, and PF75 25-serve is unaffected.

## Settled: the PF-CUSTOM note contract (10 Sep)

Confirmed with Andrew. PF-CUSTOM has **exactly three** customisable items; every other BOM line —
maltodextrin, fructose, dextrose — is a fixed base ingredient. A note naming one of those is a
mistake, so it is an unknown attribute and blocks.

| attribute | scale | effect |
|---|---|---|
| Flavour | open list | substitution — never changes a quantity |
| Electrolyte Mix | `Low` / `Med` / `High` | ×0.5 / ×1 / ×1.5 off the BOM quantity, so `Med` **is** the BOM figure |
| Caffeine | `0` / `25` / `50` / `75` / `100` mg **per serve** | absolute: `mg × servesPerPack`, which **replaces** the BOM quantity |

Implemented ahead of Stage 3, because the note contract is what the customer is testing against and
it does not depend on the config plumbing. Built into `MODIFIER_TABLE` with two new ops —
`setPerServe` (absolute per-serve, mass-converted into the BOM line's UOM) and `substitute` — plus
`SERVES_PER_PACK` (`PF-CUSTOM-75G` → 25), `slotPrefix` (any `FLV-*` BOM line is the flavour slot) and
`openLevels` (Flavour accepts any level; the two scaled attributes are closed). Covered by
`tools/custom-supplement-tests/note_contract.js`.

**Closed vs open, deliberately.** Caffeine and Electrolyte Mix are *closed*: Infinit specified the
exact scales, so a value off the scale is a bad note and blocks. Flavour is *open*: the range is
large and only banana has a part number so far, so an unmapped flavour keeps the BOM's own flavour
line and **warns**. Same reasoning for a pack with no `SERVES_PER_PACK` row — it warns and keeps the
BOM quantity rather than guessing, and never defaults the serving count.

This tightens the Stage 3 plan below rather than replacing it: the step engine still arrives (it is
what makes the scales editable in Setup instead of hardcoded, and what covers the other items in the
range), but the *shape* of the contract is now fixed.

One consequence for Stage 3: **an unmapped pack must warn, not block.** The earlier plan said block.
Andrew's instruction — the resolved list is "the basis for the list of ingredients from which to
manually create the mo/wo items" — makes blocking the wrong call: it withholds a list that is right
except for one flagged line. The under-issue risk the plan worried about is handled by *not* applying
the configured figure at all and saying so, rather than by refusing.

## Settled: the recipe configuration owns the variable quantities (10 Sep)

Confirmed with Andrew: **ignore the Fishbowl BOM's quantity for the variable items** and take it
from the report's own saved configuration instead — the thing a built-in recipe-configuration tool
will edit, sitting alongside the base BOM rather than inside it.

Implemented as `DEFAULT_RECIPE_CONFIG` (seed) resolved through
`FBLib.Settings.resolve('recipeConfig')`, so an admin can publish an edited copy to the master
payload today and a Setup tab can edit it in place later. Keyed by the finished good's **part**
number, then attribute, then level. `ATTRIBUTES` keeps only the vocabulary — names, aliases, levels,
and which BOM line each targets — because that does not vary by pack.

Division of labour, which is the load-bearing part:

| comes from | what |
|---|---|
| the recipe config | every variable quantity, as absolute grams per pack; which flavour part fills the slot |
| the Fishbowl BOM | the fixed base ingredients and their quantities; part and UOM ids; the `bom.id` each configuration builds against |

**The figures are absolute per pack and are never derived.** From the workbook
(`Custom Hydration Values` rows 26–35, `PF Custom` B–H):

| item | levels | grams per 25-serve pack |
|---|---|---|
| Flavour | any of BAN / CHOC / ORG / LLM / GRP / WMN / CRM / RASP | 253.25 (the same for every flavour) |
| Electrolyte Mix | Low / Med / High = 400 / 500 / 1000 mg per serve | 49.07 / 61.14 / 122.28 |
| Caffeine | 0 / 25 / 50 / 75 / 100 mg per serve | 0 / 1.3 / 2.5 / 3.8 / 5 |

Deriving `perServe × servesPerPack` would be **wrong**, and this is the reason the config stores the
pack figure verbatim: 100 mg of caffeine per serve on a 25-serve pack is **5 g** of raw material, not
2.5 g — the raw good is roughly half caffeine by weight. Electrolytes at 400 mg/serve are 49.07 g,
not 10 g. Those ratios are properties of the raw materials, not arithmetic.

This also closes the caffeine 200 mg question above from the other direction: the base BOM's 5 g
caffeine line is the **100 mg** level, not 200 mg. The apparent doubling was the material factor.

Also added, because the config is only meaningful if it can name a part the BOM does not carry: a
one-off `part` lookup (`loadConfigParts`) resolving every part number the config can name to a live
`part.id` + `uom.id`, so a flavour substitution is postable. A target missing from Fishbowl warns and
keeps the BOM part. The 18-serve electrolyte figures (35.33 / 44.02 / 88.04 g) are recorded in the
config comment; the pack has no known part number yet.

## Settled: the recipe configuration is now EDITABLE (10 Sep) — Stage 6 delivered early

Andrew asked for the customisation tool ahead of the remaining stages, so the config moved from a
hardcoded seed to an in-client editor. Stage 6 is therefore **done**, and the config schema changed
with it.

**Schema v2.** One record per pack, items inline, replacing v1's split between a hardcoded
`ATTRIBUTES` vocabulary and a nested `packs[partNum].qty[attr][level]` map. A v1 payload published
before the editor existed is migrated on read (`migrateConfig`), reusing the seed for the fields v1
never stored. A pack now holds `bomId`/`bomNum` as well as its finished good.

```
packs: [ { key, label, fgPartNum, fgPartId, bomNum, bomId, servesPerPack, uom,
           items: [ { attr, type, partNum | slotPrefix, unit, uom, aliases[], qtyPerPack,
                      levels: [ { label | value, alt[], perServe, partNum, qtyPerPack } ] } ] } ]
```

**Three mapping types**, which is what the editor's type selector chooses between:

| type | levels are | quantity lives on |
|---|---|---|
| `scale` | free-text names (Low / Med / High) | each level |
| `numeric` | a number + unit; the label is derived and the bare number also parses | each level |
| `substitution` | which part fills a slot, matched by `slotPrefix` | the **item** — the mass does not vary by option |

**The vocabulary is now derived from the config**, as the union across packs, so adding an item in
Setup immediately makes it parseable — there is no second list to keep in step. Quantities and the
target part stay **per pack**, so two packs may use different parts for the same attribute.

**The pack may now name the BOM.** `resolveBaseRecipe` prefers the configured `bomId` over
"newest active wins", which was a coin toss whenever a part carried more than one active BOM. A
configured BOM that cannot be found falls back and says so.

**Editor** (`CSSetup`, topbar *Recipe* button): pack rail with add/duplicate/remove, BOM type-ahead
that fills the finished good, part type-ahead that offers the chosen BOM's own components first,
per-item level tables, validate-on-edit split into errors (block Save) and notes (savable, because
the resolver already handles them), Revert, Load seed, Export JSON. Readable by anyone, editable by
an admin, published to the master payload with a merge. Covered by
`tools/custom-supplement-tests/setup_editor.js` (`edit` / `readonly`).

Still open from the earlier stages: Stage 4's step-matching extras (Off/On/Yes/No aliases beyond
those seeded, "between steps" naming the nearest), Stage 5 (a target part not on the BOM is added to
the payload rather than warned about), and Stage 7's acceptance list.

---

## Stage 0 — Fix the BOM-by-part bug

Standalone, testable immediately, no dependency on the config work. Do it first and separately.

- `bomHeaderSQL(productNum)` (line ~1766) matches `fgpart.num = '<product num>'`. Change to
  `bomHeaderSQL(partId)` matching `fgbi.partid = <int>`. Keep `bom.activeflag = 1`,
  `fgbi.typeid = 10` and `fgbi.groupdefault = 1` exactly as they are.
- `resolveBaseRecipe(partId, partNum)` — id for the lookup, num for messages only.
- Call site (line ~2066): pass `row.part_id`, not `row.product_num`. The main query already selects
  `pt.id AS part_id, pt.num AS part_num` (line ~1438) — the data is there.
- New distinct blocker when `part_id` is null: *"product X is not linked to a part"*. Today that case
  falls through to *"no BOM found"*, which reads as missing data rather than a broken link.

**Test first** (brief acceptance #3): find a real product on the install whose `part.num` differs from
its `product.num` and assert its BOM resolves. Needs database access — `mcp_server_mysql` was not
connecting, so this may need a manual query or a retry.

## Stage 1 — Config foundation (no UI)

The config object, its persistence and its validators, with nothing reading it yet.

Verified, so build on it directly:
- `FBLib.Settings` **round-trips nested objects** — `saveUser()`/`publishMaster()` are
  `JSON.stringify` and reads are `JSON.parse` (fb-lib :268–288). No JSON-string workaround needed.
- `userproperties.userValue` is **`longtext`** — size is a non-issue. The real limit is
  `userKey varchar(41)`; `cdx.bi.customsupp.master.v1` is 27 chars.

Config lives under a `config` key in the **master** payload, so `publishMaster()` distributes it and
`toggleUserEditing()` locks it — both already work.

```js
config: {
  v: 1,
  discovery: [ { field:'product.num'|'product.description', op:'LIKE', value:'%CUST%', enabled:true } ],
  packs:     [ { partNum, family, servesPerPack, packLabel, serveWeightG, batchWeightG, enabled, status } ],
  items:     [ { key, label, kind:'quantity'|'substitution',
                 appliesTo:  ['PF75','PF90','PF120','HYDRATION'],
                 substitutesPartPattern,          // substitution only
                 materialFactor,
                 steps:   [ { label, perServe, unit,
                              qtyPerPack: { 25: 49.07, 18: 35.33 },
                              partNum } ],            // substitution steps only
                 targets: [ { partNum, ratio, uom } ],
                 status: 'ok'|'tbc'|'pending' } ],
  recipeOverrides: []
}
```

Validators (used by Stage 6's save, and by the engine as blockers):
`targets[].ratio` sums to 1.0 · no duplicate item keys or step labels · every `qtyPerPack` bucket has
a matching pack mapping · no empty step lists · part numbers resolve against `part` on save.

**`TBC` is first-class.** A config item on `TBC` saves, displays incomplete, and blocks any line that
needs it, naming the item. A complete config is never required to save — most part numbers are
unconfirmed, so requiring completeness would make the tool unusable during data entry.

## Stage 2 — Discovery by pattern

- `buildSQL()`: replace the `COALESCE(p.num, si.productNum) IN (...)` clause (lines ~1409–1414) with
  an OR-ed `LIKE` group built from `config.discovery`. Keep `so.statusId IN (10,20,25)`,
  `si.typeId IN (10,12)` and the `COALESCE(p.num, si.productNum)` on the number side.
- The product filter becomes **additive** — an extra `IN` on top of the pattern. Today it *replaces*
  the list (`state.prodNums.size ? Array.from(...) : CUSTOM_PRODUCTS`), which would silently defeat
  pattern discovery.
- Populate the product dropdown from `state.rows` in `adoptRows()`, the way `state.customers` already
  is. Delete `state.products = CUSTOM_PRODUCTS.map(...)` (line ~1367).
- Empty state names the pattern: *"No open lines matched `%CUST%`"*.
- Delete `CUSTOM_PRODUCTS`.

## Stage 3 — Step engine + pack mapping

The largest logic change. `resolveRecipe` is **replaced**, not edited: the current model applies
multipliers-then-deltas to components already on the BOM; the new one takes absolute per-pack
quantities from a lookup, explodes them across `targets[]`, and can introduce components the BOM
doesn't have. There is no useful overlap.

Pack mapping already exists as `SERVES_PER_PACK` (see *Settled: the PF-CUSTOM note contract*), keyed
on `part.num`; Stage 3 moves it into the config object. A part with no mapping row **warns and leaves
the BOM quantity alone** — superseding this plan's original "blocks", per Andrew's instruction that
nothing should stop the MO being created. What must never happen is defaulting the serving count to
1: that posts a 25× under-issue that looks like a plausible number. `recipe.outputQty` is the BOM's
own output quantity and is a different thing — don't reuse it.

Order, per item:
1. Resolve the step from the note. Never interpolate.
2. Pack quantity: `steps[i].qtyPerPack[servesPerPack]` verbatim if present, else derive
   `perServe × servesPerPack × materialFactor` and mark the line **derived** in the drawer.
3. `× ratio` per target.
4. `× ordered line quantity`.
5. A zero step **omits** the component rather than posting a zero line.

`kind:'substitution'` swaps the `partNum` on the BOM line matching `substitutesPartPattern` and leaves
its quantity alone.

Keep from the current implementation: clamp-at-zero with a warning, `round6`, `effectiveQty`'s
override-else-resolved contract, and quantities staying in each BOM line's own UOM.

Delete `MODIFIER_TABLE` and `BASE_RECIPES`.

## Stage 4 — Note parsing

Extends the existing parser; the tolerant `KEY: value` splitter, prose passthrough,
case-insensitivity and `unknown[]` surfacing all stay.

Add: match `value` against the step list by `label` (`Low`, `None`, `100mg`, `CHOC`) **or** by
`perServe` with an optional unit (`100`, `100mg`, `100 mg`, `3g`, `0.4 g`), normalising units first so
`0.1g` and `100mg` resolve to the same step. `Off/On`, `Yes/No`, `Y/N`, `true/false`, `1/0` all
resolve on a two-step item.

New blocking reasons, all amber chips: value matches no step **on a closed item** (list the valid
steps) · value falls between steps (name the two nearest) · unconvertible unit mismatch · step list
empty · target part still `TBC`.

`part has no pack mapping` moved from this list to a warning — see *Settled: the PF-CUSTOM note
contract*. An **open** item (Flavour today) accepts any value and warns when it has no part behind
it; only closed items block on an unrecognised value.

The strictness is the report's main value. Don't relax it while adding step matching.

## Stage 5 — Payload change

One real behaviour change in `buildItems()`: a target part **not already a BOM line must be added** as
a new component, not merely warned about. For Infinit, optional ingredients legitimately aren't in the
base BOM until chosen. Everything else about the create path is untouched — see *Do not change*.

## Stage 6 — Setup view

A dedicated view, not more fields in `#setOverlay`: a `Report` / `Setup` switch in the topbar swapping
`#tableScroll` for `#setupScroll`, keeping the existing chrome. Four editable tables — discovery
patterns, pack mapping (16 rows), adjustable items (steps + targets as sub-rows), and
base-recipe overrides (normally empty, kept visible so nobody re-hardcodes a recipe when the real fix
is to fix the BOM).

- **Validate on save, not on use** — a failing config may save as a draft but must not be publishable.
- **Show the factor variance.** Where a step has both a stated `qtyPerPack` and a derivable value,
  show both and flag the gap. This is how the caffeine 2× was found; leave the mechanism in the tool.
- **Paste-TSV import** accepting `Report Config` rows directly. Nobody hand-types 16 pack mappings
  and ~30 step rows. **Note:** that sheet's Discovery block (rows 6–9) is currently corrupt — see
  *Known data problems* — so the importer should cover sections 2 and 3 and treat discovery as
  hand-entered until the sheet is fixed.
- **JSON export** to the clipboard so a working config moves between installs and diffs.
- **Live preview**: given a part, a note and a quantity, show the resolved components with every step
  visible (step → pack qty → ×ratio → ×qty) and whether each figure was stated or derived. This makes
  a wrong factor obvious before it reaches a work order, and doubles as the acceptance test.

## Stage 7 — Tests

`tools/custom-supplement-tests/` (gitignored) runs the real report in jsdom against stubbed Fishbowl
hosts. Its *fixtures* need replacing — step-format notes, pack mappings, a product/part pair whose
numbers differ — and the brief's 18 acceptance criteria wired as cases.

Worked figures to assert:

| Input | Expected |
|---|---|
| `CAF: 100mg`, 25-serve, qty 2 | 10.0 g RAW-CAFFEINE (stated `qtyPerPack[25]` = 5) |
| `ELEC: Low`, 25-serve, qty 1 | 49.07 g RTU-ELECTROLYTE-MIX |
| `ELEC: Low`, 18-serve, qty 1 | 35.33 g — proves `servesPerPack` drives it |
| `BCAA: 3g`, 25-serve, qty 1 | 37.5 / 18.75 / 18.75 g on three lines, marked derived |
| `CAF: 60mg` | blocked, names 50mg and 75mg as nearest |
| `CAF: 150mg` | blocked, valid steps listed |
| `FLV: CHOC` | `FLV-RTU-*` line substituted, quantity unchanged at 253.25 g |
| `CAF: None` | no RAW-CAFFEINE line at all |

Keep `SAMPLE_ROWS`, with product numbers containing `CUST` so they exercise pattern discovery, and
notes in step format. Cover: clean parse, unknown key, between-steps, not-in-list, empty note, prose
alongside attributes, an already-built line, a part with no pack mapping, a null `product.partId`, a
part whose num differs from the product num, and an item on `TBC`.

---

## Do not change

The runtime guards and the three failure screens · `installPreviewSafeMasterSettings` and its
report-id-(-1) workaround · every Create-MO gate (`enableCreateMO` off, `createMOGroupId`,
`moCreateDryRun` **on**, create-as-Entered → verify `moitem` → issue → delete on mismatch) · the
refusal of fixture- and `SAMPLE_ROWS`-sourced rows · `MO_MARKER` / `moNote` / `findExistingBuilds` ·
`bomComponentSQL`'s deliberate absence of a `typeid` filter and the stage / sub-BOM refusal · the
single `POST /api/manufacture-orders` with full `configurations[].items[]`, never patching an issued MO.

The existing harness already has passing cases for the dry-run default, create-Entered → verify →
issue, the doubled-quantity merge detector, the staged and repair refusals, and the note-marker
duplicate guard — so a regression in these will be caught.

## Known data problems

1. **`Report Config` Discovery block is corrupt.** Rows 6–9 are written one character per cell
   (`A6..G6` = `i,n,c,l,u,d,e`; `A8..F8` = `a,l,w,a,y,s`). The field/operator/value are lost; the
   intent survives only in the brief. Re-author before relying on paste-TSV for that section.
2. **Caffeine `200mg` labels in the 12/5/24×SS blocks** — resolved above: labels in blocks that hold
   no quantities. Confirm with Stacy, but not a code or config concern.
3. **Electrolyte roll-up doesn't reconcile** — components total **1.669 g** (0.671 + 0.198 + 0.35 +
   0.45) against **0.949 g** stated, a 76% gap. BCAA reconciles exactly (1.5 + 0.75 + 0.75 = 3.00),
   so this is specific to electrolytes.
4. **`Calories` has no part number and no values** and can't be consumed on a work order. Either the
   config needs a label-only, non-consuming item kind, or the item is dropped.

## Test data: Premium Fuel 75g, 25-serve

Andrew is creating the base BOM and parts for **Premium Fuel 75g — 25 Serving in Package** on the
install for initial testing. Spec it as below so one BOM exercises every trap in Stages 0–5.

**Product / part — deliberately different numbers.** This single choice tests both pattern discovery
and the Stage 0 fix at once:

| | value | why |
|---|---|---|
| `product.num` | `PF75-CUST-25` | contains `CUST` → found by the discovery pattern |
| `part.num` | `PF75-25SRV` | **differs from the product num** → acceptance #3 |

**BOM** `BOM-PF75-25`, finished good `PF75-25SRV`, **output qty 1**. Output qty 1 and
`servesPerPack` 25 being different numbers is itself the guard against reusing one for the other.

Base components — always consumed, all in **g**:

| part | qty | note |
|---|---|---|
| `RAW-MALTODEXTRIN` | 1127.57 | |
| `RAW-FRUCTOSE` | 500 | |
| `RAW-DEXTROSE` | 12.43 | |
| `FLV-RTU-BAN` | 253.25 | **must be on the BOM** — `FLV` substitution needs a line to replace |

Base total **1893.25 g** against the sheet's stated batch weight of 1948.25 g — **55.00 g short**,
matching `Open Items` A6. Expected, not a data-entry error; the report's component total will not tie
to the stated batch weight until that's reconciled.

Create these parts but **leave them off the BOM** — optional ingredients aren't in the base recipe
until chosen, and their absence is what exercises Stage 5's add-a-component behaviour:
`RTU-ELECTROLYTE-MIX`, `RAW-CAFFEINE`.

Optional, if the explode path is wanted in the first pass: `TBC-LEUCINE`, `TBC-ISOLEUCINE`,
`TBC-VALINE` (also off the BOM) enables acceptance #8.

**Do not create:** `Calories` (no part, not consumable — see *Known data problems* #4) or
`Carbohydrate Blend` (values still pending Infinit US).

Config to enter in Setup: one pack-mapping row `PF75-25SRV / PF75 / 25 / "25 serve bag"`, plus the
`FLV`, `ELEC` and `CAF` item step tables — all three have complete figures for 25-serve.

Test SO line: product `PF75-CUST-25`, qty 2, note `FLV: CHOC, ELEC: Low, CAF: 100mg`
→ expect Flavour substituted to `FLV-RTU-CHOC` at 253.25 g unchanged, 98.14 g electrolyte mix
(49.07 × 2), and 10.0 g caffeine (5 × 2), with maltodextrin/fructose/dextrose scaled by the BOM.

**Second pass, once that works:** set the parts' base UOM to `kg` with `g` on the BOM lines and a
`uomconversion` row present. That exercises "quantities stay in each BOM line's own UOM, nothing
converted" — the trap that miscosts 37 of 110 BOMs in the stock JRXML. Keep the first pass in plain
grams so it actually gets done.

## Still blocked on data

The remaining 44 `????` part numbers on `PF Custom` · Custom Hydration step lists (the tab gives only
nil and each maximum) · carbohydrate blend min/max (with Infinit US) · the caffeine 2× factor · the
electrolyte roll-up.

None of this blocks Stages 0–6, and PF75 25-serve above is enough to test all of them end to end.
It does mean the report can't build the **rest** of the range until the part numbers land — which is
why `TBC` is first-class and why the Setup tab comes before the data: it's what makes the data
enterable.
