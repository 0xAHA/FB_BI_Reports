# Fishbowl BI Reports

Fishbowl Advanced BI reports come in two kinds:

- **replicas** of standard Fishbowl reports;
- **workflow tools** that go beyond them.

Each report is one HTML file. It runs in the embedded Chromium browser
(JxBrowser) of the Fishbowl Advanced client. Reports read data with Fishbowl's
built-in JavaScript functions: `runQuery`, `runQueryAsync`, `runRestApiAsync`
and `saveSettings`. [CLAUDE.md](CLAUDE.md) documents the full API.

## Folders

| Folder | Contents |
|---|---|
| `Dashboards/` | Sales, Inventory and Purchasing dashboards (v1.2); `Dashboard - Company`; the eight order-queue tiles in `Individual Pages/` |
| `SalesOrder/` | Sales Order Summary, Open Orders, QuickOrder, Delivery Route Planner |
| `PurchaseOrder/` | PO Summary, PO Approval, receiving, outsourced demand |
| `Inventory/` | Reorder Watchlist, valuation, availability, replenishment, Bulk Scrap |
| `Manufacturing/` | Production Scheduling, WO Finisher, Available to Build, BOM Cost; `jrxml/` holds fixed copies of standard reports |
| `Part/`, `Product/`, `Customer/`, `Audit/` | Part tools, product and kit tools, customer status, audit trail |
| `Custom/` | Customer-specific reports |
| `Template/` | `Core_Dashboard_Template.htm`, the starting point for new reports |
| `scripts/` | Shared assets (below) |
| `schema/` | Database schema reference; start with [schema-index.md](schema/schema-index.md) |
| `tools/` | Build stamping, publishing, local preview and test harnesses |
| `PowerBIAgent/` | Windows service that pushes Fishbowl data to Power BI |
| `Themes/` | Legacy theme CSS |

These folders are not production:

- `archived/`: superseded versions kept for comparison and bug checks (see its README)
- `Manufacturing/Archived/`: earlier Production Scheduling and Gantt versions
- `Manufacturing/Temp/`
- `mockups/`
- `Other_NOT_FOR_PRODUCTION/`: helper tools, prototypes, probes and sample data (see its README)

Project skills for Claude Code live in `.claude/skills/`.

## Shared assets

Reports include these by record name through Fishbowl's Script / Style
directives. Import them before the reports that use them, in this order:

| Asset | Namespace | Role |
|---|---|---|
| `scripts/fb-styles.css` | `--fb-*` tokens | Design tokens and Workspace components |
| `scripts/fb-lib.js` | `FBLib` | Shared runtime (see below) |
| `scripts/fb-mfg.js` | `FBMfg` | Manufacturing engines (WO finish, scrap, staging), generated from `Production_Scheduling_v1.2.htm` |
| `scripts/fb-pricing.js` | `FBPricing` | Fishbowl-exact pricing rules (a JavaScript port of the pricing SQL) |

fb-lib's runtime provides:

- formatters;
- settings with admin defaults;
- custom-field columns;
- tables;
- saved views;
- .xlsx export.

## Report identity and versions

Every production report opens its `<head>` with:

```js
window.FB_REPORT = { key: 'cdx.bi.…', name: '- Folder - Report', build: '2026.09.30-4ca940a' };
```

| Field | What it is |
|---|---|
| `key` | Prefix for everything the report stores (settings, saved views, shared data). |
| `name` | The Fishbowl record name. Imports and publishing match on it, so renaming creates a duplicate. `null` means the report isn't published. |
| `build` | The date the content last changed plus a content hash. Written by `tools/stamp/stamp.js`; never edit it by hand. |

The shared assets carry their own stamps: `FBLib.BUILD`, `FBMfg.BUILD` and
`--fb-styles-build`.

File-name suffixes such as `_v1.2` mark major rewrites; they are not a strict
scheme. The record `name` is what identifies a report.

## Setup

```sh
git config core.hooksPath tools/githooks   # pre-commit build stamping, once per clone
```

- **Node.** The stamp and publish tools use only Node built-ins. The test
  harnesses in `tools/custom-supplement-tests` need `npm install`.
- **Publishing.** Set up a shared export folder in the gitignored
  `tools/deploy/publish.local.json` as `{ "dir": "<path>" }`, or with the
  `FB_PUBLISH_DIR` variable. With neither set, publishing does nothing.

| Command | What it does |
|---|---|
| `node tools/stamp/stamp.js [--check \| --list]` | Stamp or verify build stamps |
| `node tools/deploy/publish.js <file> [--all \| --list \| --dry]` | Update a report's published export in place. Never creates one. |
| `node tools/deploy/build-deployed.js` | Build importable JSON exports into the gitignored `Deployed/` |

## Read next

- [CLAUDE.md](CLAUDE.md): the BI JavaScript API, runtime constraints and
  conventions.
- [schema/schema-index.md](schema/schema-index.md): tables, status and type
  IDs, join patterns.
- [tools/deploy/README.md](tools/deploy/README.md): the export and publishing
  contract.
- [Dashboards/dashboards.md](Dashboards/dashboards.md),
  [Dashboard Tiles](Dashboards/Dashboard%20Tiles.md),
  [Dashboard - Company](Dashboards/Dashboard%20Combined%20-%20Import%20Instructions.md).
- [tools/local-preview/README.md](tools/local-preview/README.md): running a
  report outside Fishbowl.
- [LICENSES.md](LICENSES.md): third-party licences.
