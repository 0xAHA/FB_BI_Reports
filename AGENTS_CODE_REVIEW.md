# AI Code Review Guide

## Review Profile

- Be assertive and high-signal. Prioritize a small number of important findings over exhaustive nitpicking.
- Post specific inline comments anchored to the offending lines, plus one short summary comment.
- This is a Fishbowl BI Reports repo: HTML dashboards plus vanilla JavaScript that run inside an embedded **JxBrowser 8 (Chromium)** panel in the Fishbowl Advanced desktop client. There is no build step, bundler, transpiler, or automated test suite. Reports are standard HTML/CSS/JS files loaded directly. Review accordingly.

## What to Review

### P0 — must flag

- **SQL injection and unsafe query construction.** Dashboards build SQL that runs against the Fishbowl database. Flag any query assembled by string-concatenating user input, filter values, URL params, or report inputs. Require parameterization or strict whitelisting/escaping.
- **XSS / unsafe DOM injection.** Flag untrusted or DB-derived values written via `innerHTML`, `outerHTML`, `document.write`, or `insertAdjacentHTML` without escaping. Prefer `textContent` or an explicit escape helper. HTML reports rendering query results into the DOM are the main attack surface here.
- **Correctness bugs that produce wrong numbers.** This is BI/reporting: a wrong JOIN, wrong aggregation/GROUP BY, off-by-one date boundary, timezone mishandling, or NULL-handling mistake silently corrupts the figures users make decisions on. Flag these.
- **Breaking changes to shared modules.** `scripts/dashboard-common.js` and the shared `dashboard-*.js` modules are used across many `.htm` files. Flag signature/return-shape changes or removed exports that would break consumers not visible in the diff.
- **Secrets / credentials** hardcoded in HTML, JS, or SQL.

### P1 — should flag

- **Performance.** Unbounded result sets, missing `LIMIT`/pagination, queries inside loops, and N+1-style repeated calls. Embedded-browser DOM work: building large tables via repeated single-node insertion or layout thrash in tight loops. Flag heavy synchronous work that freezes the report panel.
- **Error handling.** Query/data calls (`fetch`, Fishbowl data APIs) with no failure path; empty/NULL result sets that throw instead of rendering an empty-state. Flag swallowed errors (`catch {}`) that hide data-load failures from the user.
- **Maintainability.** Logic duplicated across dashboards that belongs in a shared `scripts/` module; magic numbers/status codes without explanation; copy-pasted query blocks that will drift.
- **Type/format safety in JS.** This runs un-typed in the browser, so be strict about implicit coercion, `==` vs `===`, parsing of dates/numbers, and accessing properties on possibly-undefined query rows. Optional chaining (`?.`) and nullish coalescing (`??`) are supported (ES2022+) — prefer them over unguarded access.

### P2 — quick wins

- Missing `<meta charset="UTF-8">` in a report `<head>` (required; otherwise em dashes/currency/accents render garbled).
- Use of `localStorage`/`sessionStorage` (cleared regularly in this runtime) instead of `saveSettings`/`loadSettings`.
- Reliance on external CDNs for on-premise/offline customers; prefer inlining or avoiding the dependency.
- Consistent date formatting through the shared `formatDate`/system date-format setting rather than ad-hoc formatting.

## What NOT to comment on

- Pure formatting, indentation, or whitespace.
- Requests to add a build system, bundler, framework, TypeScript, or test harness — out of scope for this report format.
- Suggesting Node.js APIs or modules — this is a browser (JxBrowser) environment, not Node.
- Stylistic rewrites of working SQL or JS that do not change behavior, performance, or safety.
- Files under `Other_NOT_FOR_PRODUCTION/` — review lightly; they are experimental and explicitly not production.

## Repo-specific notes

- **Stack:** HTML reports + vanilla JavaScript (ES2022+) + CSS themes, with SQL queries against the Fishbowl database. Runtime is JxBrowser 8 (Chromium) embedded in the Fishbowl Advanced desktop client. No backend, no build, no test framework.
- **Purpose:** Custom BI dashboards (Sales, Purchasing, Inventory, Manufacturing) plus standalone order-type views, surfacing real-time Fishbowl operational data.
- **Shared code:** `scripts/dashboard-common.js` holds cross-dashboard utilities (date formatting, status indicators); `dashboard-*.js` are per-domain modules. Changes here ripple across many reports — review for blast radius.
- **Schema:** `schema/*.sql` documents the Fishbowl tables/views the reports query; use it to sanity-check JOINs, column names, and aggregations.
