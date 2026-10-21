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

- **`- Sales - QuickOrder V2` is `Custom/SalesOrder/QuickOrder_v1.2.htm`** (v1.2 is
  the released version, confirmed 2026-10-01). The name was recovered from an
  export of the older v1.0, which is now `archived/SalesOrder/QuickOrder.htm`.
- **Payloads are faithful, including existing defects.** Three source files
  carry mojibake from an old Windows-1252 save (`Custom/Manufacturing/Temp/ProdSched_vA.htm`
  and `_vB.htm`, 18 occurrences each in visible text; `Custom/SalesOrder/QuickOrder_v1.2.htm`,
  1 occurrence inside a JS comment). The wrapper reproduces the bytes as found
  rather than guessing a repair — but it does clean the *record name*, so the
  corruption never reaches Fishbowl's page list. Fix the sources if you want
  them fixed.
- **OneDrive `-DESKTOP-<host>` conflict copies are excluded.** Deploying one
  would push a stale side-copy over a live page.
- A source file's BOM is stripped; Fishbowl's own exports never carry one.

---

# fbdeploy.js — straight into a Fishbowl server

`fbdeploy.js` skips the export/import round trip. It writes a source directly
into the server's BI tables, so the next open of the report in the client runs
it. It's meant for the dev server; nothing reaches a customer this way.

| Source | Table | `typeId` |
|---|---|---|
| `*.htm` (by `FB_REPORT.name`) | `biscript` + its `bireport` row | 10 (Page) |
| `scripts/*.js` (by file name) | `biscript` | 20 (Script) |
| `scripts/*.css` (by file name) | `biscript` | 30 (Style) |

## Setup

Create `tools/deploy/fishbowl.local.json` (gitignored, since it holds a password):

```json
{
  "server": "http://localhost:2456",
  "username": "your-fishbowl-user",
  "password": "your-password",
  "appName": "Claude BI Dev",
  "appId": "claude-bi-dev-2",
  "appDescription": "Dev testing"
}
```

- Use a dedicated user with Data rights and no MFA, and don't log in to the
  desktop client as that user. `FB_SERVER`, `FB_USERNAME`, `FB_PASSWORD` and
  `FB_MFA_CODE` override the file.
- `appName` + `appId` identify the integrated app. The pair shown is already
  approved on the dev server. A new pair needs approving once, under
  **Setup → Settings → Integrated Apps**.
- The server needs the sysproperty `FbPartnerApi = true`.

## Where an edit goes: targets.js

Each file's target is the user's answer, recorded in the gitignored
`targets.local.json`:

```json
{ "SalesOrder/Foo.htm": "both", "scripts/fb-lib.js": "sharepoint" }
```

The values are `fishbowl`, `sharepoint`, `both` and `none`. A file with no
answer goes **nowhere**. On its first edit, `targets.js --hook` hands Claude
the question to ask. It offers only the targets configured on this machine,
says where the file already sits on SharePoint, and lists the folders when
it has no copy there yet. Record the answer with:

```
node tools/deploy/targets.js <fishbowl|sharepoint|both|none> <file> [--folder <sub>]
node tools/deploy/targets.js --list
```

Recording an answer also pushes the file to each chosen target: `publish.js`
(with `--folder` for a first SharePoint copy) and `fbdeploy.js --create`. If
the answer can't be carried out, for example SharePoint with no valid folder
or a target this machine hasn't configured, nothing is recorded and the
question comes back on the next edit.

## Built pages: built.js

Some pages only run once built. Their source carries markers such as
`<!-- @inline-script fb-doc.js -->`, and the `build.js` beside it inlines
them into `dist/<page>`. No folder does this at present: the only one, the
Paperwork POC, was archived on 2026-10-15 and its documents now include the
shared `fb-doc` Script. The mechanism stays for future built pages.
For these pages, `fbdeploy.js` and `publish.js` ship the built page and never
the source. `built.js` runs the build first.

- **The contract.** A `build.js` takes part when it answers `--plan`. That
  prints `[{ src, out, page, inputs }]`, and `node build.js <page>` builds `out`.
- **Dependents.** An edit also redeploys or republishes every opted-in page
  built from the edited file: each page that inlines an edited `fb-doc.js`, and
  any variant of an edited page.
- **Variants** are pages built from another page, such as `SOInvoiceReport`
  from `SOReport`. They exist only in `dist/`, so their target is recorded
  against the dist path:
  `targets.js fishbowl <folder>/dist/<Variant>.htm`.

## Commands

```
node tools/deploy/fbdeploy.js <file> [...]            update existing records
node tools/deploy/fbdeploy.js --create <file>         also create missing ones
node tools/deploy/fbdeploy.js --force <file>          overwrite after the user agreed
node tools/deploy/fbdeploy.js --access <groups|all> <file>   add View access (Pages)
node tools/deploy/fbdeploy.js --status [file ...]     compare repo with Fishbowl
node tools/deploy/fbdeploy.js --dry ...               report, write nothing
node tools/deploy/fbdeploy.js --rename <old> --to <new> [--type Page|Script|Style]
node tools/deploy/publish.js --rename <old name> <file>
```

**Renaming** keeps a record's identity. `fbdeploy.js --rename` renames the
`biscript` row and its `bireport` row in place, so the id, access rows and saved
settings survive, and moves the deploy state with them. It refuses when the new
name is taken, which also catches a collision with a stock report.
`publish.js --rename` moves the SharePoint copy to the file's current name,
in the same folder, with the current source. A server that imported the old
name gets a second report from the renamed copy, so delete the old one there.
Set the new `FB_REPORT.name` in the file first.

## Rules it enforces

- **Opt-in per file.** `tools/hooks/after-edit.js` calls `--hook` after the
  stamp and the publish. It deploys only files whose target includes
  Fishbowl, and only to records that already exist. Files under `archived/`
  and `Deployed/`, OneDrive conflict copies, and files outside the repo are
  never offered.
- **No silent overwrite.** It overwrites a record without asking only when the
  record's SHA-256 equals the hash the tool last wrote, which is kept in the
  gitignored `fishbowl.state.json`. Anything else is reported as
  `needs-confirm` and left untouched. `--force` overwrites it, after saving the
  Fishbowl copy to `backups/` (gitignored).
- **Every write is read back** and hash-compared, because the endpoint never
  reports success.
- **Updates bump `dateLastModified`.** That's the entity's Hibernate
  `@Version`, so a client editor still holding the old copy fails to save
  rather than overwriting the deploy.
- **New records** look like client-created ones: `active=1`, `note=''`,
  `published=1` for pages and 0 for scripts and styles, and `bireport` with
  `params='{}'` (only while that column exists: ADV-6029 moves saved settings
  to one row per user and drops it) and `widget=0`. A new page has no access rows, so only admins
  see it until `--access` is used.
- **Descriptions come from the page.** A page's
  `<meta name="description" content="…">` becomes the description of a new
  record, and of an existing one (`biscript` and `bireport`) whose description
  is empty or only repeats the name. A description written in Fishbowl is never
  replaced. `publish.js` does the same for the SharePoint copy's description.

## The endpoint

`GET /api/unsafe/deprecated/data-query`, with the SQL in the body
(`Content-Type: application/sql`). Node's `fetch` won't send a body on a GET,
so the tool uses `http.request`. The following comes from the 26.9.1 server
code and has been confirmed by a live round trip:

- It returns 403 "Unsafe REST API." unless `FbPartnerApi` is true.
- The statement must **start with** SELECT, UPDATE or INSERT. **DELETE is
  rejected**, so records can't be deleted and access can't be revoked through
  it; use the client.
- It runs inside a read-only Spring transaction on the MariaDB driver. Writes
  still commit, and DML returns `[]`.
- Raw SQL bypasses Envers, so `biscript_aud` / `bireport_aud` get no row. The
  backups are the only history of what was overwritten.
- The BI entities have no second-level cache, so a write is visible the next
  time the report loads.
- Bodies are sent as `CONVERT(FROM_BASE64('…') USING utf8mb4)`, so quotes,
  backslashes and `sql_mode` can't break them. Stored data is CRLF, the same
  as an import.
