# Report harness

Run a BI report in desktop Chrome, without the Fishbowl client, on recorded
data. Use it to develop a report, to check its PDF view, and to prove a
change did or didn't change what it does. Everything here is read-only: the
only database access is `fixture.js` sending the page's own SELECTs to the
local Fishbowl server.

| Tool | What it does |
|---|---|
| `build.js` | Builds a page: every Script / Style directive expanded from `scripts/` (or `--scripts <dir>` first), Fishbowl's browser bridge stubbed (`runQuery`, `getProperty`, `openModule`, `saveSettings`…), queries answered from a fixture. Options: `--launch '<json>'` (a `window.FB_LAUNCH`, as report_btn sets it), `--set <id>=<value>` (a report setting's substituted value), `--prop name=value` (a system property). |
| `serve.js` | Serves the built pages on `http://127.0.0.1:8733/`. Leave it running. |
| `run.js` | Opens a built page headless, runs optional steps (`steps.js`: `module.exports = async page => …`), prints status, banner, errors, SQL sent, `openModule` calls and the PDF view's pages. `--pdf` switches to the PDF view first; `--shot` saves a screenshot. |
| `fixture.js` | Records a fixture from the local Fishbowl server (`tools/deploy/fishbowl.local.json`): runs the page, answers each new query from the server, repeats until nothing new is asked. Pass the same steps / launch / settings you will test with, so their queries are recorded too. |
| `check.js` | Static checks before deploy: head tags written once, every directive and setting token exactly once, `FB_REPORT` key ≤ 31 characters, no control characters, every script parses. |
| `ab.js` | Before / after: builds version A (git `HEAD`, `--a-rev`, or `--a <file>`) and B (the working copy or `--b <file>`) on one fixture and compares SQL, status, launch lock, PDF sheets and document output. `--launch CODE:id` adds the launched, output and wrong-module scenarios of a record document. |
| `steps/record-nav.js` | Steps for a record document: Filters panel, previous / next, browse, pick. Element ids from `REC_IDS` (default `recInput,recPrev,recNext`). |

The render tests of the record documents against a live database are in
[`tools/doc-tests/`](../doc-tests/) (a different harness: real SQL, no fixtures).

## Setup

- Node 18+ and Google Chrome.
- playwright-core: `npm i -g playwright-core`, or point `PLAYWRIGHT_PATH` at an
  existing copy (`npx playwright-core --version` caches one).
- Optional `tools/report-harness/harness.local.json` (gitignored):
  `{ "playwright": "…/node_modules/playwright-core", "chrome": "…/chrome.exe", "port": 8733, "out": "…" }`.
  Environment variables `PLAYWRIGHT_PATH`, `CHROME_PATH`, `HARNESS_PORT`,
  `HARNESS_OUT` override it. Built pages, screenshots and A/B results go to
  `out` (default `<tmp>/fb-report-harness`).
- `fixture.js` needs the deploy tool's local server config
  (`tools/deploy/fishbowl.local.json`, see `tools/deploy/README.md`).

## A typical session

```
node tools/report-harness/serve.js                     # once, in its own terminal
node tools/report-harness/fixture.js iReport_Ports/Inventory/AgingReport.htm fx/aging.js
node tools/report-harness/build.js iReport_Ports/Inventory/AgingReport.htm fx/aging.js
node tools/report-harness/run.js <out>/AgingReport.html --pdf --shot aging.png
node tools/report-harness/check.js iReport_Ports/Inventory/AgingReport.htm
```

Then open `http://127.0.0.1:8733/AgingReport.html` in Chrome to use it by hand.

A record document, before and after a change:

```
REC_IDS=woInput,woPrev,woNext node tools/report-harness/ab.js iReport_Ports/WorkOrder/WOTraveler.htm fx/wot.js \
    --launch WO:160 --steps tools/report-harness/steps/record-nav.js
```

## Fixtures

A fixture is a JS array of `[regex, rows]`: the first regex matching a query
(case-insensitive) answers it, anything else gets `[]`. Recorded keys match
the whole query; to cover a case the database doesn't have (serial numbers,
a foreign-currency vendor, a 40-page order), copy the fixture and edit the
rows, or add a looser regex before the recorded one. Keep fixtures out of the
repo unless they hold no customer data (the local server's data is demo data,
but check). Changing a query's text (even whitespace inside a value) means
re-recording or loosening its key: `ab.js` reports such queries in
`sqlOnlyA` / `sqlOnlyB`.

## What the harness can't tell you

It runs in Chrome, not JxBrowser inside the client: the toolbar's Print /
Save-PDF / Email, `runApiRequest` writes, real `saveSettings` storage and the
report_btn host are only exercised in the client. Every report still needs a
client test before it is called done.
