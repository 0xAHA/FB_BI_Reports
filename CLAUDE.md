# Fishbowl BI Script — JavaScript API Guide

This guide covers every built-in JavaScript function available in Fishbowl BI reports. These functions connect directly to Fishbowl's data and client, enabling interactive, data-rich reports without needing backend changes.

---

## What Is a BI Report?

A BI report is an **HTML file** that runs inside an embedded browser in the Fishbowl Advanced desktop client. You write standard HTML, CSS, and JavaScript — the report is stored in Fishbowl and opened in a panel inside the client window.

### Runtime Environment

The embedded browser is **JxBrowser 8 (Chromium-based)**. This means:

- **Modern JavaScript is fully supported** — ES2022+, async/await, `fetch`, template literals, optional chaining (`?.`), nullish coalescing (`??`), etc.
- **`fetch()` and external CDNs work** if the user's machine has internet access. For on-premise customers on restricted networks, do not rely on external resources — embed any libraries inline or avoid them entirely.
- **Do not use `localStorage` or `sessionStorage`** — these are cleared regularly. Use `saveSettings`/`loadSettings` instead, which persist to the Fishbowl user account.
- **No Node.js APIs** — this is a browser environment, not Node.
- **`<meta charset="UTF-8">` is required** in every report's `<head>`. Without it, special characters (em dashes, currency symbols, accented letters) will render as garbled text.

### Minimal Report Template

Every report should start from this skeleton:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: sans-serif; padding: 16px; }
  </style>
</head>
<body>

  <script>
    async function load() {
      // query data and build the UI here
    }

    load();
  </script>
</body>
</html>
```

### How Reports Are Created

1. In the Fishbowl client, open the **BI Script Editor** module
2. Write or paste your HTML into the editor
3. Click **Run** to preview
4. Save the report — once saved, it gets an ID that enables `saveReportData`/`loadReportData`

### Key Constraints

- SQL queries are **read-only** — only `SELECT` is allowed
- All built-in functions (listed below) are synchronous except `runQueryAsync`, which returns a `Promise`
- The report runs in the context of the logged-in user — `getUser()`, `hasUserAccess()`, and `getLocationGroupList()` all reflect that user's account

---

## Available Functions

### Data Querying

#### `runQuery(query, showErrors?)`
Run any SQL `SELECT` query against the Fishbowl database. Returns a JSON string — parse it to get an array of row objects.

- `query` — a SQL SELECT statement
- `showErrors` — `"true"` or `"false"` (optional, default `false`); if true, shows an error row in the result instead of returning nothing

```js
const rows = JSON.parse(runQuery("SELECT num, customerId FROM so WHERE statusId = 20"));
rows.forEach(row => console.log(row.num));
```

> **Note:** Only `SELECT` statements are allowed. INSERT/UPDATE/DELETE will be rejected.

> **Important — all column names come back lowercase.** Regardless of how you write them in the SQL or what aliases you use, every key in the result objects will be fully lowercase. For example, `SELECT so.totalPrice` is accessed as `row.totalprice`, and `SELECT c.name AS customerName` is accessed as `row.customername`. Always use lowercase when reading result fields in JavaScript.

---

#### `runQueryAsync(query)`
Same as `runQuery` but returns a `Promise` and resolves to an **already-parsed array of objects** — do not call `JSON.parse()` on the result. Use this for large queries so the report stays responsive while data loads.

```js
// Returns an array directly — no JSON.parse() needed
const rows = await runQueryAsync("SELECT * FROM Part WHERE activeFlag = 1");
rows.forEach(row => console.log(row.num)); // keys are lowercase
```

> **Best practice:** Prefer `runQueryAsync` for any query that might take more than a second to run. Use `runQuery` only for very fast, lightweight lookups where a `Promise` would add unnecessary complexity.

---

### Currency & Money

#### `formatCurrency(currencyId, amount, decimalFormat)`
Formats a number as currency using a specific currency's symbol and locale.

- `currencyId` — numeric ID of the currency
- `amount` — the number to format
- `decimalFormat` — a Java decimal format string like `"#,##0.00"`

```js
const formatted = formatCurrency(1, 1234.5, "#,##0.00"); // → "$1,234.50"
```

---

#### `roundMoney(value, isTotal?)`
Rounds a monetary value using Fishbowl's rounding rules.

- `value` — a number
- `isTotal` — `true` if this is a total/sum (uses a slightly different rounding rule)

```js
const rounded = roundMoney(10.005, false);
```

---

#### `currencyLocale()`
Returns the home company's currency locale and symbol as an object.

```js
const locale = currencyLocale();
// locale.locale → e.g. "en-US"
// locale.symbol → e.g. "$"
```

---

### User & Access

#### `getUser()`
Returns information about the currently logged-in Fishbowl user as a JSON string.

```js
const user = JSON.parse(getUser());
console.log(user.userName, user.firstName, user.lastName);
```

---

#### `hasUserAccess(accessRight)`
Returns `true` or `false` depending on whether the current user has a given access right. Use this to show/hide parts of a report based on permissions.

The access right string format is `"ModuleName-Right"` — the module's display name, a dash, then the right name. Examples:

| Access Right String | What it checks |
|---|---|
| `"Sales Order-View"` | Can the user view sales orders? |
| `"Sales Order-Edit"` | Can the user edit sales orders? |
| `"Purchase Order-View"` | Can the user view purchase orders? |
| `"Manufacture Order-View"` | Can the user view manufacturing orders? |
| `"Inventory-View"` | Can the user view inventory? |
| `"Part-View"` | Can the user view parts? |
| `"Customer-View"` | Can the user view customers? |
| `"Picking-View"` | Can the user view picks? |
| `"Shipping-View"` | Can the user view shipments? |
| `"Receiving-View"` | Can the user view receipts? |

```js
if (hasUserAccess("Sales Order-View")) {
    // show sales order section
}

if (hasUserAccess("Inventory-Show Part Cost")) {
    // show cost column
}
```

---

### Location & Company

#### `getLocationGroupList()`
Returns an array of location group IDs that the **currently logged-in user has access to** — not all location groups in the system. Users with restricted access will only see their assigned groups.

```js
const locationGroups = getLocationGroupList();
// → [1, 2, 3]
```

---

#### `getCompanyAddress(locationGroupId, showCountry?)`
Returns a formatted company address string for a given location group.

- `locationGroupId` — numeric ID
- `showCountry` — `true`/`false` (optional, default `false`)

```js
const address = getCompanyAddress(1, true);
```

---

### Navigation — Open Modules

#### `openModule(moduleName, item?)`
Opens a Fishbowl module in the client and optionally navigates to a specific record.

- `moduleName` — the internal module name (see table below — **these are not always the same as what you see in the client menu**)
- `item` — an order number or identifier to navigate to (optional)

The module names are internal identifiers. Some differ from the label shown in the Fishbowl client UI:

| Module name to use | What it opens |
|---|---|
| `"Sales Order"` | Sales Order module |
| `"Purchase Order"` | Purchase Order module |
| `"Work Order"` | Work Order (opens via the Manufacturing module) |
| `"Manufacture Order"` | Manufacturing Order module |
| `"Transfer Order"` | Transfer Order module |
| `"Inventory"` | Inventory module |
| `"Part"` | Part module |
| `"Customer"` | Customer module |
| `"Vendor"` | Vendor module |
| `"Picking"` | Picking module |
| `"Shipping"` | Shipping module |
| `"Receiving"` | Receiving module |
| `"Bill of Materials"` | BOM module |
| `"RMA"` | RMA module |

```js
openModule("Sales Order", "SO-10042");
openModule("Work Order", "WO-5001");
openModule("Part", "WIDGET-A");
```

> This is great for making clickable links in a report that jump the user to the relevant record.

---

### System Properties

#### `getProperty(name, defaultValue?)`
Reads a Fishbowl system property by name.

- `name` — the property name
- `defaultValue` — fallback if the property isn't set (optional)

```js
const serverName = getProperty("fb.server.name", "Unknown");
```

---

### Icons & Images

#### `getIcon(orderType, statusId)`
Returns a Base64-encoded PNG icon for a pick, work order, or BOM item status. Use the result as an `<img src>`.

- `orderType` — `"PICK"`, `"WO"`, or `"BOM"`
- `statusId` — numeric status ID

```js
const iconData = getIcon("WO", 20);
if (iconData) {
    img.src = "data:image/png;base64," + iconData;
}
```

---

#### `getImageFile(filePath)`
Returns a Base64-encoded image from the Fishbowl server's file system (e.g., a part image).

```js
const imgData = getImageFile("/images/parts/widget.png");
img.src = "data:image/png;base64," + imgData;
```

---

### Tracking Information

#### `getAllTrackingInfo(tableName, ids)`
Returns tracking data (lot, serial, expiration, etc.) for a set of records.

- `tableName` — the database table name (e.g., `"so"`, `"po"`)
- `ids` — a comma-separated string of record IDs

```js
const tracking = getAllTrackingInfo("so", "101,102,103");
```

---

### Customer Hierarchy

#### `getParentName(parentId)`
Returns the name of a customer's parent account.

```js
const parentName = getParentName(42);
```

---

### Reports

#### `getHighValueReport(tableName, id)`
Returns a high-value report (inventory valuation context) for a specific record.

- `tableName` — the table context (e.g., `"part"`)
- `id` — the record ID

```js
const report = getHighValueReport("part", 55);
```

---

### Auto PO & Auto MO

#### `getAutoPo(vendorId, locationGroupId, qbClassId, showVendorPartNumber, includeNoRopOul, alwaysManufacture, startDate, endDate)`
Returns the Auto PO calculation data — the same data used by the Auto PO wizard. Returns a JSON string of an array.

- Dates should be in `"YYYY-MM-DD"` format
- Any ID parameter can be `null` to include all
- **Field names are `snake_case`** (e.g., `part_num`, `vendor_name`, `qty_suggested`, `last_cost`) — the data is serialized with `LOWER_CASE_WITH_UNDERSCORES` naming

```js
const poData = JSON.parse(getAutoPo(null, 1, null, false, true, false, "2025-01-01", "2025-12-31"));
```

---

#### `getAutoMo(startDate, endDate, isIncludeNoRop?, isIncludeConfigurable?, locationGroupId?, qbClassId?)`
Returns the Auto MO calculation data. Returns a JSON string of an array. Field names are also `snake_case` for the same reason.

```js
const moData = JSON.parse(getAutoMo("2025-01-01", "2025-12-31", true, false, 1, -1));
```

---

### Pick Status

#### `runPickStatusHelper(pickId)`
Triggers the pick status recalculation helper for a given pick.

```js
runPickStatusHelper(200);
```

---

### Persistent Storage

These two pairs let your report save and load data between sessions.

#### `saveReportData(data)` / `loadReportData()`
Saves/loads arbitrary data tied to this specific report. Only works on saved reports (not the editor preview).

```js
saveReportData(JSON.stringify({ lastFilter: "active" }));
const saved = JSON.parse(loadReportData() || "{}");
```

---

#### `saveSettings(key, value)` / `loadSettings(key)`
Saves/loads user-specific settings by key — persisted per user, not per report. Useful for remembering filter preferences across multiple reports.

```js
saveSettings("myReport_locationGroup", "1");
const lg = loadSettings("myReport_locationGroup");
```

---

### Quick Reference Table

| Function | What it does |
|---|---|
| `runQuery` | SQL SELECT, synchronous |
| `runQueryAsync` | SQL SELECT, async (recommended) |
| `formatCurrency` | Format a number as currency |
| `roundMoney` | Round money using Fishbowl rules |
| `currencyLocale` | Get home currency symbol/locale |
| `getUser` | Current logged-in user info |
| `hasUserAccess` | Check user permission |
| `getLocationGroupList` | List location group IDs the current user can access |
| `getCompanyAddress` | Company address string |
| `openModule` | Navigate to a Fishbowl module/record |
| `getProperty` | Read a system property |
| `getIcon` | Base64 status icon (PICK/WO/BOM) |
| `getImageFile` | Base64 image from server filesystem |
| `getAllTrackingInfo` | Lot/serial/expiry tracking data |
| `getParentName` | Customer parent account name |
| `getHighValueReport` | High-value inventory report |
| `getAutoPo` | Auto PO wizard data |
| `getAutoMo` | Auto MO wizard data |
| `runPickStatusHelper` | Recalculate pick status |
| `saveReportData` / `loadReportData` | Persist data per report |
| `saveSettings` / `loadSettings` | Persist settings per user |

---

## Database Schema Reference

Full table definitions, column lists, status ID values, FK conventions, and common join patterns live in the **`schema/`** folder. Always load `schema/schema-index.md` first — it covers naming conventions, the FK pattern, status IDs, and a domain map so you know which file to load next.

### Schema Files

| File | Load when your report involves |
|---|---|
| `schema/schema-index.md` | Always — conventions, FK rules, status IDs, join patterns |
| `schema/schema-orders.sql` | SO, PO, MO, WO, XO, RMA |
| `schema/schema-fulfillment.sql` | Pick, Ship, Receipt |
| `schema/schema-inventory.sql` | On-hand qty, locations, tracking, cost layers |
| `schema/schema-parts-products.sql` | Parts, products, BOM, kits, UOM |
| `schema/schema-customers-vendors.sql` | Customers, vendors, addresses, pricing |
| `schema/schema-setup.sql` | Users, currency, carriers, payment terms, custom fields |
| `schema/schema-accounting.sql` | QB posting tables, payment processing |
| `schema/schema-system.sql` | Integrations, scheduling — rarely needed |
| `schema/schema-audit.sql` | Change history (`_aud` tables) — load only when auditing |
| `schema/schema-views.sql` | Views — quantity summaries, address formatting, shipping, part tracking |

### Views

Fishbowl defines 49 MySQL views (documented in `schema/schema-views.sql`) that can be queried with `runQuery()` like any table. The application does not use them internally — they exist for custom reports only.

**MySQL does not push `WHERE` predicates into views that use `GROUP BY`, `UNION`, `DISTINCT`, or aggregate functions** (MySQL calls this the TEMPTABLE algorithm). The view is fully materialized before your filter is applied. The quantity views are the worst case — `QTYINVENTORY` unions 15 sub-views, each of which scans tag and order tables.

For TEMPTABLE views, reproduce only the sub-query you need with your filter inline:

```js
// Slow — materializes all tags for all parts, then filters
const rows = JSON.parse(runQuery(`SELECT * FROM QTYONHAND WHERE partid = ${partId}`));

// Fast — filter applied before aggregation, tag.partid index is used
const rows = JSON.parse(runQuery(`
  SELECT l.locationgroupid, COALESCE(SUM(t.qty), 0) AS qty
  FROM tag t
  INNER JOIN location l ON l.id = t.locationid
  WHERE t.typeid IN (30, 40) AND t.partid = ${partId}
  GROUP BY l.locationgroupid
`));
```

Simple join views (no aggregation) use the MERGE algorithm and are safe to filter directly. Each view in `schema-views.sql` is annotated with its algorithm.

### Key Rules for SQL Queries

- **All table names are lowercase** — `so`, `locationgroup`, `partreorder`. MySQL is case-insensitive on Windows and macOS, but lowercase is safe on all platforms.
- **Transfer Orders use the table `xo`** — not `to`, which is a reserved SQL word.
- **FK naming convention** — a field named `fooId` is almost always a FK to `foo.id`. e.g. `customerId` → `customer.id`, `locationGroupId` → `locationgroup.id`. Exceptions and the full pattern are documented in `schema-index.md`.
- **Result column keys are always lowercase** — `row.statusid`, not `row.statusId`; `row.totalprice`, not `row.totalPrice`. This applies regardless of how you write column names or aliases in the SQL.

---

## Example Reports

### Example 1: Clickable Sales Order Dashboard

Shows open, issued, and partially fulfilled sales orders in a sortable table. Each row displays the order number, customer name, status badge, total, and first ship date. Clicking any row navigates directly to that order in the Sales Order module.

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: sans-serif; padding: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #2c3e50; color: white; padding: 8px 12px; text-align: left; }
    td { padding: 8px 12px; border-bottom: 1px solid #ddd; }
    tr:hover { background: #eaf4ff; cursor: pointer; }
    .badge { padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
    .open { background: #d4edda; color: #155724; }
    .issued { background: #cce5ff; color: #004085; }
    h2 { margin-bottom: 4px; }
    #subtitle { color: #666; margin-bottom: 16px; font-size: 14px; }
  </style>
</head>
<body>
  <h2>Open Sales Orders</h2>
  <div id="subtitle">Loading...</div>
  <table>
    <thead>
      <tr>
        <th>Order #</th>
        <th>Customer</th>
        <th>Status</th>
        <th>Total</th>
        <th>First Ship Date</th>
      </tr>
    </thead>
    <tbody id="tableBody"></tbody>
  </table>

  <script>
    const STATUS_LABELS = { 20: "Issued", 25: "In Progress", 60: "Fulfilled" };
    const STATUS_CLASS  = { 20: "issued", 25: "open", 60: "open" };

    async function load() {
      const locale = currencyLocale();

      const rows = await runQueryAsync(`
        SELECT so.num, c.name AS customerName, so.statusId,
               so.totalPrice, so.dateFirstShip
        FROM so
        JOIN customer c ON so.customerId = c.id
        WHERE so.statusId IN (20, 25, 60)
        ORDER BY so.dateFirstShip ASC
        LIMIT 200
      `);

      document.getElementById("subtitle").textContent =
        `${rows.length} orders — click any row to open it`;

      const tbody = document.getElementById("tableBody");
      tbody.innerHTML = "";

      rows.forEach(row => {
        const tr = document.createElement("tr");
        // All column names come back fully lowercase from runQueryAsync
        const statusId = row.statusid;
        const label  = STATUS_LABELS[statusId] ?? statusId;
        const cls    = STATUS_CLASS[statusId]  ?? "";
        const amount = new Intl.NumberFormat(locale.locale, {
          style: "currency", currency: "USD"
        }).format(row.totalprice ?? 0);

        tr.innerHTML = `
          <td><strong>${row.num}</strong></td>
          <td>${row.customername}</td>
          <td><span class="badge ${cls}">${label}</span></td>
          <td>${amount}</td>
          <td>${row.datefirstship?.split("T")[0] ?? "—"}</td>
        `;

        tr.addEventListener("click", () => openModule("Sales Order", row.num));
        tbody.appendChild(tr);
      });
    }

    load();
  </script>
</body>
</html>
```

---

### Example 2: Low Stock Alert Report with Location Group Filter

Shows active parts that have fallen at or below their reorder point for a selected location group. Includes a dropdown to filter by location group (populated from the user's accessible groups, active only) that remembers the last selection between sessions. Results are sorted by most critically low first and link to the Inventory module.

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: sans-serif; padding: 16px; }
    .toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
    select, button { padding: 6px 12px; font-size: 14px; }
    button { background: #2c3e50; color: white; border: none; border-radius: 4px; cursor: pointer; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #c0392b; color: white; padding: 8px 12px; text-align: left; }
    td { padding: 8px 12px; border-bottom: 1px solid #ddd; }
    .low { color: #c0392b; font-weight: bold; }
    tr:hover { background: #fff3f3; cursor: pointer; }
  </style>
</head>
<body>
  <h2>Low Stock Alert</h2>
  <div class="toolbar">
    <label>Location Group:
      <select id="lgSelect"></select>
    </label>
    <button onclick="load()">Refresh</button>
  </div>
  <table>
    <thead>
      <tr>
        <th>Part #</th>
        <th>Description</th>
        <th>On Hand</th>
        <th>Reorder Point</th>
        <th>Order Up To</th>
      </tr>
    </thead>
    <tbody id="tableBody"></tbody>
  </table>

  <script>
    const SETTINGS_KEY = "lowStockReport_locationGroup";

    async function init() {
      const lgIds = getLocationGroupList();
      const saved = loadSettings(SETTINGS_KEY);
      const select = document.getElementById("lgSelect");

      // Fetch active location group names
      const lgRows = await runQueryAsync(
        `SELECT id, name FROM locationgroup WHERE id IN (${lgIds.join(',')}) AND activeFlag = 1 ORDER BY name`
      );

      lgRows.forEach(lg => {
        const opt = document.createElement("option");
        opt.value = lg.id;
        opt.textContent = lg.name;
        if (String(lg.id) === saved) opt.selected = true;
        select.appendChild(opt);
      });

      load();
    }

    async function load() {
      const lgId = document.getElementById("lgSelect").value;
      saveSettings(SETTINGS_KEY, lgId);

      const rows = await runQueryAsync(`
        SELECT p.num, p.description,
               COALESCE(SUM(t.qty), 0) AS onHand,
               pl.reorderPoint, pl.orderUpToLevel
        FROM part p
        JOIN tag t ON t.partId = p.id
        JOIN location l ON t.locationId = l.id
        JOIN locationgroup lg ON l.locationGroupId = lg.id
        JOIN partreorder pl ON pl.partId = p.id AND pl.locationGroupId = lg.id
        WHERE lg.id = ${lgId}
          AND p.activeFlag = 1
          AND pl.reorderPoint > 0
        GROUP BY p.id, p.num, p.description, pl.reorderPoint, pl.orderUpToLevel
        HAVING onHand <= pl.reorderPoint
        ORDER BY (onHand / pl.reorderPoint) ASC
        LIMIT 500
      `);

      const tbody = document.getElementById("tableBody");
      tbody.innerHTML = rows.length === 0
        ? "<tr><td colspan='5'>No low stock items found.</td></tr>"
        : "";

      rows.forEach(row => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><strong>${row.num}</strong></td>
          <td>${row.description}</td>
          <td class="low">${row.onhand}</td>
          <td>${row.reorderpoint}</td>
          <td>${row.orderuptolevel ?? "—"}</td>
        `;
        tr.addEventListener("click", () => openModule("Inventory", row.num));
        tbody.appendChild(tr);
      });
    }

    init();
  </script>
</body>
</html>
```

---

### Example 3: Work Order Status Board with Icons

A kanban-style board that groups work orders into columns by status (Enter, Planned, Started, Fulfilled). Each card shows the WO number and item description pulled from the manufacturing order, with a Fishbowl status icon. Clicking a card opens it in the Work Order module.

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: sans-serif; padding: 16px; background: #f5f5f5; }
    .board { display: flex; gap: 16px; flex-wrap: wrap; }
    .column { background: white; border-radius: 8px; padding: 12px; min-width: 260px; flex: 1; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
    .column-title { font-weight: bold; font-size: 15px; margin-bottom: 10px; border-bottom: 2px solid #eee; padding-bottom: 6px; }
    .card { padding: 10px; border: 1px solid #eee; border-radius: 6px; margin-bottom: 8px; cursor: pointer; display: flex; gap: 10px; align-items: center; }
    .card:hover { background: #eaf4ff; }
    .card img { width: 20px; height: 20px; }
    .card-info { flex: 1; }
    .card-num { font-weight: bold; font-size: 13px; }
    .card-desc { font-size: 12px; color: #666; }
    .count { background: #eee; border-radius: 10px; padding: 2px 8px; font-size: 12px; }
  </style>
</head>
<body>
  <h2>Work Order Board</h2>
  <div class="board" id="board">Loading...</div>

  <script>
    // WO status IDs used in Fishbowl
    const STATUSES = [
      { id: 10, label: "Enter" },
      { id: 20, label: "Planned" },
      { id: 30, label: "Started" },
      { id: 40, label: "Fulfilled" },
    ];

    async function load() {
      const rows = await runQueryAsync(`
        SELECT wo.num, wo.statusId, moi.description AS partDesc
        FROM wo
        JOIN moitem moi ON wo.moItemId = moi.id
        WHERE wo.statusId IN (10, 20, 30, 40)
        ORDER BY wo.dateScheduled ASC
        LIMIT 300
      `);

      const grouped = {};
      STATUSES.forEach(s => grouped[s.id] = []);
      rows.forEach(row => {
        if (grouped[row.statusid]) grouped[row.statusid].push(row);
      });

      const board = document.getElementById("board");
      board.innerHTML = "";

      STATUSES.forEach(status => {
        const cards = grouped[status.id];
        const col = document.createElement("div");
        col.className = "column";
        col.innerHTML = `<div class="column-title">${status.label} <span class="count">${cards.length}</span></div>`;

        // Pre-fetch the icon for this status
        const iconData = getIcon("WO", status.id);

        cards.forEach(wo => {
          const card = document.createElement("div");
          card.className = "card";

          const imgTag = iconData
            ? `<img src="data:image/png;base64,${iconData}" />`
            : "";

          card.innerHTML = `
            ${imgTag}
            <div class="card-info">
              <div class="card-num">${wo.num}</div>
              <div class="card-desc">${wo.partdesc ?? ""}</div>
            </div>
          `;
          card.addEventListener("click", () => openModule("Work Order", wo.num));
          col.appendChild(card);
        });

        board.appendChild(col);
      });
    }

    load();
  </script>
</body>
</html>
```

---

### Example 4: Auto PO Review Tool

Shows Auto PO reorder recommendations for a selected date range. Part numbers and vendor names are clickable links that open the Part and Vendor modules respectively. A button on each row opens the Purchase Order module where the user can act on the recommendation.

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: sans-serif; padding: 16px; }
    .toolbar { display: flex; gap: 12px; align-items: flex-end; margin-bottom: 16px; flex-wrap: wrap; }
    label { display: flex; flex-direction: column; font-size: 13px; gap: 4px; }
    input[type=date], select { padding: 6px; font-size: 14px; }
    button { padding: 8px 16px; background: #2c3e50; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #34495e; color: white; padding: 8px 12px; text-align: left; }
    td { padding: 8px 12px; border-bottom: 1px solid #ddd; font-size: 13px; }
    tr:hover td { background: #f0f4ff; }
    .action-btn { padding: 4px 10px; font-size: 12px; background: #2980b9; color: white; border: none; border-radius: 4px; cursor: pointer; }
    #status { color: #666; font-size: 13px; margin-bottom: 8px; }
  </style>
</head>
<body>
  <h2>Auto PO Review</h2>
  <div class="toolbar">
    <label>Start Date <input type="date" id="startDate" /></label>
    <label>End Date <input type="date" id="endDate" /></label>
    <button onclick="load()">Load Recommendations</button>
  </div>
  <div id="status"></div>
  <table>
    <thead>
      <tr>
        <th>Part #</th>
        <th>Vendor</th>
        <th>Qty Needed</th>
        <th>Cost</th>
        <th></th>
      </tr>
    </thead>
    <tbody id="tableBody"></tbody>
  </table>

  <script>
    // Set default dates
    const today = new Date();
    const in90 = new Date(today); in90.setDate(today.getDate() + 90);
    document.getElementById("startDate").value = today.toISOString().split("T")[0];
    document.getElementById("endDate").value   = in90.toISOString().split("T")[0];

    function load() {
      const start = document.getElementById("startDate").value;
      const end   = document.getElementById("endDate").value;
      document.getElementById("status").textContent = "Loading...";
      document.getElementById("tableBody").innerHTML = "";

      // showVendorPartNumber=true so part_num contains "VendorNum (AdvancedNum)"
      const data = JSON.parse(getAutoPo(null, null, null, true, true, false, start, end));
      const locale = currencyLocale();

      document.getElementById("status").textContent =
        `${data.length} part(s) recommended for reorder`;

      const fmt = new Intl.NumberFormat(locale.locale, { style: "currency", currency: "USD" });
      const tbody = document.getElementById("tableBody");

      data.forEach(item => {
        const tr = document.createElement("tr");
        // Advanced part number is always in the last parenthesis group, e.g. "PO-F103 (F201)"
        const match = item.part_num?.match(/\(([^)]+)\)$/);
        const fbPartNum = match ? match[1] : item.part_num;

        // Build links with createElement to safely handle apostrophes in names
        const partLink = document.createElement("a");
        partLink.href = "#";
        partLink.textContent = item.part_num ?? "—";
        partLink.addEventListener("click", e => { e.preventDefault(); openModule("Part", fbPartNum); });

        const vendorLink = document.createElement("a");
        vendorLink.href = "#";
        vendorLink.textContent = item.vendor_name ?? "—";
        vendorLink.addEventListener("click", e => { e.preventDefault(); openModule("Vendor", item.vendor_name); });

        tr.innerHTML = `
          <td class="part-cell"></td>
          <td class="vendor-cell"></td>
          <td>${item.qty_suggested ?? 0}</td>
          <td>${fmt.format(parseFloat(item.last_cost) || 0)}</td>
          <td>
            <button class="action-btn" onclick="openModule('Purchase Order', '')">
              Open PO Module
            </button>
          </td>
        `;
        tr.querySelector(".part-cell").appendChild(partLink);
        tr.querySelector(".vendor-cell").appendChild(vendorLink);
        tbody.appendChild(tr);
      });
    }
  </script>
</body>
</html>
```

---

## Tips for Building with Claude

When asking Claude to build a BI report, give it:

1. **What data to show** — describe the columns and where the data lives in Fishbowl (e.g., "sales orders", "parts", "work orders")
2. **Any filters** — date ranges, statuses, location groups, etc.
3. **Interactivity needed** — should rows be clickable? Should it open a module?
4. **Which functions to use** — reference this guide so Claude knows what's available (e.g., "use `runQueryAsync`", "use `openModule` for row clicks")
5. **The look and feel** — simple table, card layout, status board, etc.

Claude works best when the prompt is specific. For example:

> "Build a BI report that shows all open and issued purchase orders from the last 30 days. Show PO number, vendor name, total cost, and expected delivery date. Make each row clickable to open the Purchase Order module. Use `runQueryAsync` for the query. Style it with a dark header and alternating row colors."
