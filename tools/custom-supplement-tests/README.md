# Custom_Supplement_WO test harness

Runs `Custom/Infinit_Nutrition/Custom_Supplement_WO.htm` in jsdom with the Fishbowl
host globals (`runQuery`, `runQueryAsync`, `runRestApiAsync`, `getUser`, …) and the
`fb-lib` / `fb-mfg` namespaces stubbed, so the report's real logic can be exercised
without a Fishbowl client.

    npm install                     # jsdom + moment (+ xlsx, to read the customer workbook)
    node <suite>.js ../../Custom/Infinit_Nutrition/Custom_Supplement_WO.htm [mode]

Each suite strips the `{% Script %}` / `{% Style %}` directives and the CDN tags,
stubs the host globals, then `win.eval`s the report's last inline script block.

## Suites

| suite | modes | covers |
|---|---|---|
| `stage0.js` | — | BOM looked up by `fgbi.partid`, never a part/product NUMBER; a part whose num differs from the product num resolves; a null `product.partId` blocks distinctly and short-circuits before the query |
| `stage2.js` | `found`, `none` | pattern discovery on product number **or** description; no hardcoded IN list; product dropdown derived from results; selecting one NARROWS the pattern; a miss names the pattern |
| `note_contract.js` | — | the three-attribute note contract **and the recipe configuration behind it**: which quantities come from config vs the BOM, flavour substitution, and what blocks vs what warns |
| `setup_editor.js` | `edit`, `readonly` | the recipe-configuration editor: draft isolation, the BOM and part type-aheads, the three mapping types, validation, and that a pack built in the editor immediately drives resolution |
| `stage_moper_so.js` | `happy`, `suffix`, `covered`, `partial` | one MO per sales order, `mo.num = so.num`, one configuration per custom line; `-2` suffix when the number is taken; per-line coverage from the note marker; a blocked line is excluded and named while the rest still build |
| `realbom.js` | `default`, `truestage`, `rawbit` | the real PF-CUSTOM BOM shape, with the recipe config applied end to end |

Run them all:

    R=../../Custom/Infinit_Nutrition/Custom_Supplement_WO.htm
    node stage0.js $R;            node stage2.js $R found;   node stage2.js $R none
    node note_contract.js $R
    node setup_editor.js $R edit;      node setup_editor.js $R readonly
    node stage_moper_so.js $R happy;   node stage_moper_so.js $R suffix
    node stage_moper_so.js $R covered; node stage_moper_so.js $R partial
    node realbom.js $R default;   node realbom.js $R truestage;  node realbom.js $R rawbit

`e2e.js` / `e2e_live.js` were removed: they asserted the per-LINE drawer API
(`CSBuild.open(<soitem key>)`, a single component table) that the per-SO rewrite
replaced. Their coverage lives in `stage_moper_so.js` and `realbom.js`.

## Why stage0.js exists

Stubs a BOM that answers **only** to `fgbi.partid = 900` and returns nothing to a name match, so a
regression to the product-number lookup fails the suite rather than silently falling back to the
fixture recipe. `soitem` has no `partId` — the part is reached `productId → product.partId → part.id`
— and that part's `num` routinely differs from the product's, so a name match finds nothing, falls
back to the fixtures, and reports "no active BOM found", which reads as missing data rather than as a
wrong lookup.

## Why note_contract.js exists

Two things are pinned down here: the note vocabulary, and **where each quantity comes from**.

PF-CUSTOM has exactly **three** customisable items; everything else on the BOM is a fixed base
ingredient, so naming one in the note is an unknown attribute and blocks.

| item | levels | grams per 25-serve pack |
|---|---|---|
| Flavour | BAN / CHOC / ORG / LLM / GRP / WMN / CRM / RASP (open list) | 253.25 — the same for every flavour |
| Electrolyte Mix | `Low` / `Med` / `High` = 400 / 500 / 1000 mg per serve | 49.07 / 61.14 / 122.28 |
| Caffeine | `0` / `25` / `50` / `75` / `100` mg per serve | 0 / 1.3 / 2.5 / 3.8 / 5 |

Those figures live in the report's **recipe configuration**, not the Fishbowl BOM — that is the
architecture, so an admin can adjust them without editing the BOM. The BOM still supplies the base
ingredients, the part and UOM ids, and the `bom.id` each configuration builds against.

**The stub BOM deliberately holds different figures** (electrolyte 60, caffeine 2.5, flavour 250) from
the config. That is the whole design of the suite: if the engine ever went back to scaling the BOM
quantity, every quantity assertion would move. It also covers the two cases where the config
legitimately has nothing to say — an unconfigured pack, and a component with no level entry — both of
which must keep the BOM figure and **warn**, never guess.

The caffeine figures are worth a test on their own because they are **not derivable**. 100 mg per
serve on a 25-serve pack is 5 g of raw material, not 2.5 g: the raw good is roughly half caffeine by
weight. Electrolytes at 400 mg/serve are 49.07 g, not 10 g. An implementation that multiplied
mg × serves would understate caffeine by half and electrolytes by five, so the config stores the pack
figure verbatim and the suite asserts the verbatim values.

Also covered: flavour substitution swaps the part and never the mass (`Chocolate` → `FLV-RTU-CHOC` at
the same 253.25 g), and a substitution target missing from Fishbowl keeps the BOM part and warns.

What blocks, and what only warns, is asserted explicitly:

- **blocks** — an unknown attribute (including a note trying to vary a base ingredient), or a
  caffeine/electrolyte value off its scale. Those two attributes are *closed*: Infinit specified the
  exact scales, so anything else is a bad note.
- **warns** — an unmapped flavour, a flavour part not in Fishbowl, a pack with no recipe config, a
  level with no configured quantity. All keep the BOM's own figure and name what to set by hand.
  None may block: the report produces the ingredient list a person reviews before creating, so
  refusing outright is worse than handing over a list with one line flagged.

The moitem read-back is generated from the payload in this suite on purpose — it measures the recipe
contract, and the verification path has independent expectations in `realbom.js` and
`stage_moper_so.js`.

## Why setup_editor.js exists

The recipe configuration is only worth having outside the code if the editor and the resolver agree,
so the suite ends by doing the whole round trip: it adds a pack through the editor's own handlers,
picks a BOM by type-ahead, types a named scale and a numeric item, saves, and then builds a real
sales-order line against it — asserting the payload carries the figures that were typed rather than
the BOM's (deliberately different) ones. If the vocabulary were not rebuilt from the saved config,
the note on that line would read as an unknown level and block, so that path is covered too.

It also pins the parts that are easy to get wrong: the draft is isolated (nothing reaches the master
payload before Save), `publishMaster` is merged rather than replaced (or the Create-MO gates would be
wiped), validation blocks only what would make a config unusable and merely *notes* what the resolver
already handles, and a non-admin gets a read-only panel.

**One harness note.** jsdom with `runScripts: 'outside-only'` does not compile inline `onclick`
attributes, and this report is wired that way throughout. Clicking a picker row therefore does
nothing, so the suite reads the handler the report *generated*, parses its arguments and invokes them
— which checks the wiring more precisely than a click would, and is why `pickArgs`/`firePick` exist.

## Why realbom.js exists

Every `bomitem` row on the install carries a **non-null `stageBomId`**, and the
adjustable components are variable-quantity lines. Keying stage detection off
`!!stagebomid` therefore flagged *every* component — including the finished
good, which `bomComponentSQL` also returns because it applies no typeid filter —
and refused to build anything. The fix: stage means `typeid = 50` **or**
(`bomitem.stage` bit set **and** a `stageBomId`), the finished-good row is
skipped, and staged / variable-qty / repair / note lines **warn instead of
blocking**.

`rawbit` mode delivers the bit(1) columns as `String.fromCharCode(0|1)`, the
shape the Fishbowl bridge can actually return, so the decoder is exercised
rather than a string comparison that happens to work in the stub.

Its `default` mode also carries the recipe config end to end against a BOM whose electrolyte line
says 49.07 (the *Low* figure) while the note asks for *High* — so the payload proves the configured
122.28 **replaces** the BOM figure rather than scaling it. The variable-quantity nag must be silent
there, because the config supplied both figures; it fires only when nothing replaced the BOM default.
