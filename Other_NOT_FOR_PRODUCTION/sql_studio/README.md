# SQL Studio: a Data module replacement

**Status:** in development, version 0.1.0. Built; not yet tested in the client.

A Fishbowl client plugin that adds a **SQL Studio** module under Reporting: the
Data module's query tab, rebuilt with what fb-api-tool's Data tab has.

- **Schema browser.** Tables grouped by part of Fishbowl, with columns, keys,
  what each key points at, and what points back. Filter as you type.
  Double-click to insert; **Rows** previews a table; **Diagram** draws it.
- **Editor.** Syntax colouring, completion (tables after FROM/JOIN, the query's
  columns, `alias.` → that table's columns), **Format** (Ctrl+Shift+F), and a
  linter: unbalanced brackets and quotes, trailing commas, UPDATE without WHERE,
  duplicate column names, unknown tables and columns. Ctrl+Enter runs the
  statement under the caret. A FROM-first statement is reordered before it is
  sent, and a **Rows** limit is added to SELECTs that have none.
- **Results.** Columns in the order the SELECT list writes them (the REST
  reply's JSON keys come in the server's map order; `*` and `t.*` take the
  schema's column order), so a CSV export is laid out as written. Sticky
  header, row numbers, number alignment, NULLs marked, status-like columns as
  pills, sort, filter, copy (tab-separated) and CSV.
  - **Column filters** (▾ in each header): Excel's value list with counts,
    narrowed by the other filters, plus sort. **Clear column filters** resets.
  - **Column widths**: drag a header's edge; kept per user by column name;
    double-click the edge to fit. Fixed layout, so big results lay out at once.
  - **Raw data**: off, decimals are padded to the column's own places
    (561.00, 513.70) and midnight datetimes show as dates; on, values as the
    server sent them. Copy and both exports always use the values as sent.
  - **Export Excel**: fb-lib's own `.xlsx` writer, lifted out of
    `scripts/fb-lib.js` by `build.sh` into `fb-export.js` (one source; never
    edit the lifted copy). Real numbers and dates, header frozen, AutoFilter;
    a number with a leading zero stays text, a datetime with a time of day
    stays text (the date cell would drop the time).
- **Schema diagram.** In its own tab or popped out into a window. Drag, zoom,
  double-click to re-centre, right-click to show what a table links to.
  Ctrl+click tables and columns, then **Write query** puts the JOIN in the
  editor.
- **Parameters**, as the Data module has them. **Add parameter** writes one
  at the caret in the Data module's own form (`$` + type code + `{Prompt|default}`):
  19 record types (orders, pick, shipment, receipt, part, product, BOM,
  customer, group, vendor, carrier, class, user, location group, location),
  whose value is the record's id, and text, number, quantity, money, date and
  check box. Run asks for each: a searchable picker for a record, a date
  input, a checkbox (1 or 0). A value inside quotes has its quotes doubled.
  **Where a record parameter is compared with the column its picker shows**
  (`num = …`, `p.num LIKE …`, `… = customer.name`, `num IN (…)`), it gives
  that number or name, quoted, instead of the id; decided at each place it is
  used (`SqlText.comparedColumn`). This goes beyond the Data module, which
  always gives the id, so such a query behaves differently there.
  The last value per prompt is remembered. The Data module's colour, list,
  date range and print types have no use in a SELECT and aren't offered.
- **Saved queries, shared with the Data module.** The Queries tab lists the
  Data module's saved queries; open one and the toolbar shows it, marked ● when
  the editor differs. **Save** (Ctrl+S) saves it in place; **Save as…** saves
  under a name and description to the Data module, or to *My queries* (only
  you). Delete is on each one. Opening another while changed asks to save
  first, as the Data module does. Saving needs Data-Edit and deleting
  Data-Delete. The calls are the Data module's own (`DataQueryBridge`: GET /
  SAVE / DELETE_DATA_EXPORT), put on the page as `window.sqlStudioHost` after
  each load; in the BI Reports viewer there is no bridge and they are
  read-only. Recent history is per user too.
- **Writes, admin only.** UPDATE and INSERT, after **Allow writes** is ticked and
  a confirmation that counts the rows an UPDATE matches. Each is read back
  afterwards. DELETE is never run.

## How it is built

| Part | What it does |
|---|---|
| `SqlStudioPlugin.java` | The module: a `FishbowlPlugin` under Reporting, right `SQL Studio-View`, holding the client's own `BiBrowserPanel` |
| `DataQueryBridge.java` | `window.sqlStudioHost`: the Data module's saved queries (get, save, remove, rights) over its own EVE calls; strings in, JSON out |
| `StudioPage.java` | Reads the page from the jar, inlines its `<script src>` and stylesheet, and sets `window.FB_STUDIO` (`admin`, `user`, `version`) |
| `src/main/web/studio.htm`, `studio.css`, `studio.js` | The page |
| `src/main/web/sql-text.js` | Tokenizer, colouring, formatter, comment stripping, row limit, FROM-first reorder, completion context, linter, cell tones. Ported from fb-api-tool `core/Sql*.cs`, `ValueTone.cs`, `CellStyle.cs` |
| `src/main/web/schema.js` | Reads the schema (`information_schema`), the snapshot, parts of Fishbowl, the diagram's graph, key paths and the JOIN writer. Ported from fb-api-tool `core/DbSchema.cs`, `SchemaGraph.cs`, `KeyPath.cs`, `QueryWriter.cs`, `SchemaAreas.cs` |
| `src/main/web/diagram.js` | Draws the graph as SVG; one state, drawn docked or in a pop-out window |

**Why a BiBrowserPanel.** It already gives a page `runQuery`, `runQueryAsync`,
`runRestApiAsync` and `saveSettings` over the client's session, so the page
needs no Java bridge, login or credentials. It is loaded the way report_btn
loads its built-in App Library: report id `-1`, no includes.

**Reads** go to `/api/data-query` (query-string form), which keeps the column
names as the statement spelt them. When the REST connection or the right to it
isn't there, the page falls back to `runQueryAsync` for the session, and column
names come back in lower case. Statements longer than 6,000 characters always
use `runQueryAsync`.

**Writes** go to `/api/unsafe/deprecated/data-query`, never through the native
Data module's support mode (a flag the client sends and the server believes;
see the memory note on the native module). Only an admin (user id 1, or the
user named admin) is offered them. Servers where that write path is off answer
403, and the page says UPDATE, INSERT and DELETE are not supported, without
naming the setting. The server rejects DELETE itself; the page doesn't send it.
Fishbowl's change history (`_aud`) doesn't see these writes, which the
confirmation says.

**Page rules** (it is a BI page): no `{%` and no dollar sign followed by a
capital letter anywhere in its source (Fishbowl substitutes both by global text
replacement), no literal control characters, and no `localStorage`.

## Build and install

```bash
./build.sh            # target/sql-studio.jar
./build.sh --check    # run the page's script tests (node) first
./build.sh --install  # copy into the Fishbowl plugins folder; restart the client
```

Same toolchain as report_btn: the client's own jars, ECJ on Fishbowl's Java
runtime when there's no JDK. The page can also be opened straight from
`src/main/web/studio.htm` in a browser while working on it; without Fishbowl's
bridge functions it says so and runs nothing.

## Not done yet

- The Data module's Server Log viewer, and parameter defaults saved per query.
- Cancelling a running query (`runQuery` has no cancel).
- A diagram window that stays usable while a client dialog is open (the pop-out
  is a browser window; a Java frame excluded from modals would be).
