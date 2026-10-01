# Deployed exports — on request only

`build-deployed.js` wraps a source file in the JSON envelope the Fishbowl client
uses for BI import/export, ready to drop into an import. It is **run on request,
not after every edit**, and its output folder `Deployed/` is gitignored — the
exports were not earning their place in every commit.

```
node tools/deploy/build-deployed.js
```

It regenerates every export at once (there is no single-file mode); take the one
you need from `Deployed/` and ignore the rest.

| Source | Type | Output |
|---|---|---|
| `*.htm` | `Page` | `Deployed/- Sales - Sales Order Summary-Page.json` |
| `scripts/*.js` | `Script` | `Deployed/fb-lib-Script.json` |
| `scripts/*.css` | `Style` | `Deployed/fb-styles-Style.json` |

**Flat — every export sits directly in the folder, no subfolders.** That is how
the Fishbowl client itself exports, so the folder is a drop-in match for a client
export directory and the two can be diffed against each other without
reorganising either. Filenames are `<name>-<type>.json`; `manifest.json` maps
each one back to the repo file it came from.

Nothing collides, because the generator guarantees `name` + `type` is unique
(see *Names are load-bearing* below) — and that makes the filename unique too.

## The envelope

A single-element JSON array, serialized the way Jackson's `DefaultPrettyPrinter`
does it — which is *not* what `JSON.stringify` produces:

```
[ {
  "name" : "- Sales - Sales Order Summary",
  "description" : "- Sales - Sales Order Summary",
  "data" : "<!DOCTYPE html>\r\n…",
  "active" : true,
  "note" : "",
  "type" : "Page"
} ]
```

- no BOM; opens `[ {`, closes `} ]` with **no trailing newline**
- CRLF between entries, two-space indent, a space on **both** sides of the colon
- `data` is the source file verbatim, CRLF line endings, JSON-escaped
- BMP non-ASCII (em dash, arrows, box drawing) stays raw UTF-8; only astral
  characters (emoji) are escaped, as a `\uXXXX` surrogate pair

Verified by round-tripping all 27 real exports in `Documents/BI` — every one
reproduces byte-for-byte. When this was written, the generated `fb-lib`, `fb-mfg` and
`fb-styles` were **byte-identical** to their live exports.

## Names are load-bearing

Fishbowl keys an import on the record **name**: a matching name *updates* that
record, a new one *creates a duplicate beside it*. `manifest.json` records
which is which for every file:

- **`updates-existing`** (31 at the last run) — the name was recovered from a real export in
  `Documents/BI`, by matching the banner `PATH:` line and then the `<title>`.
  These are the live record names; don't tidy them.
- **`creates-new`** (55 at the last run) — no deployed counterpart was found, so the name comes
  from the file's `<title>` (house suffix trimmed) or its filename. Importing
  one of these makes a new page.
- A `note` field marks anything auto-renamed because two sources derived the
  same name (mostly `Archived/` copies sharing a title with their live sibling).

## Known caveats

- **`- Sales - QuickOrder V2` is `SalesOrder/QuickOrder_v1.2.htm`** (v1.2 is
  the released version, confirmed 2026-10-01). The name was recovered from an
  export of the older v1.0, which is now `archived/SalesOrder/QuickOrder.htm`.
- **Payloads are faithful, including existing defects.** Three source files
  carry mojibake from an old Windows-1252 save (`Manufacturing/Temp/ProdSched_vA.htm`
  and `_vB.htm`, 18 occurrences each in visible text; `SalesOrder/QuickOrder_v1.2.htm`,
  1 occurrence inside a JS comment). The wrapper reproduces the bytes as found
  rather than guessing a repair — but it does clean the *record name*, so the
  corruption never reaches Fishbowl's page list. Fix the sources if you want
  them fixed.
- **OneDrive `-DESKTOP-<host>` conflict copies are excluded.** Deploying one
  would push a stale side-copy over a live page.
- A source file's BOM is stripped; Fishbowl's own exports never carry one.
