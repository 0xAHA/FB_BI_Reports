# Launch context: opening a BI report from a Fishbowl module

**Status:** proof of concept.
- **Reader:** `FBDoc.launch` in `fb-doc.js`, applied by the `FBDoc.app` shell that every
  paperwork document uses (`SOReport.htm` first).
- **Host:** the report_btn plugin (`../report_btn/`).
- **Client-tested:** the Sales Order launch (0.1.0). report_btn 0.4.0 (module and group
  keys, plus the Report Workspace) is installed and working. Both on 2026-10-12.
- **Report developers:** the step-by-step guide is
  [report_btn README → Building a report for report_btn](../report_btn/README.md#building-a-report-for-report_btn).
  This page is the format spec.

A **host** opens a BI report from a Fishbowl module, such as Sales Order or Purchase
Order. It tells the report which module it came from and which record was open there.
This page defines:
- the tag that decides which modules list a report;
- the data the host hands the report when it opens.

## 1. Which modules list a report

A module's **Reports → Apps** section lists only the reports whose fb-launch tag names
that module. A report with no tag is listed nowhere; it stays available in the BI
Reports module as usual.

> The tag is the proof of concept's visibility setting. A proper implementation
> would keep visibility outside the page.

Put one tag in the page's `<head>`, written exactly like this:

```html
<meta name="fb-launch" content="PO">
```

**Content.** A list of keys, separated by commas or spaces. Each key is one of:
- **a module key**, which lists the report in that module only. Use the "tag key"
  column in section 3, e.g. `SO`, `PO`, `INVENTORY`.
- **a menu-group key**, which lists the report in every module of that group. These
  are the client's own groups: `SALES`, `PURCHASING`, `MATERIALS`, `MANUFACTURING`,
  `ACCOUNTING`, `SETUP`, `GENERAL`, `REPORTING`, `INTEGRATIONS`.

Mix them as needed. `content="PURCHASING"` lists the report in Purchase Order,
Receiving and Vendor. `content="SO, SHIP"` lists it in just those two modules.

**Other rules:**
- **Access** still applies. A report is listed only for users who may open it, under
  the BI Reports module's rule: one of the user's groups has an access row for it, and
  admin sees all.
- **How the host finds it.** Hosts look for `name="fb-launch"` (double quotes) in the
  stored page, and read only the **first** one.
  - Write the tag once, and never anywhere else in the page: not in comments, and not
    in a script or file that gets inlined. The `fb-doc.js` lint checks this.
  - Prose that just mentions fb-launch is fine.
- **Scan timing.** report_btn re-reads the tags in the background every 60 seconds. A
  new or changed tag shows on a menu open after that.
- **Reports never read the tag themselves.**

## 2. The host hands over `window.FB_LAUNCH`

The host sets it before any page script runs:

```js
window.FB_LAUNCH = {
  v: 1,                       // format version
  host: 'report_btn',         // who launched (for the debug log)
  module: 'SO',               // record-type code (section 3) — not the tag key
  moduleName: 'Sales Order',  // the client module it was opened from
  table: 'so',                // optional: the table `id` belongs to (absent when unknown)
  id: 290,                    // the record's primary key; 0 = no record open (or none saved)
  num: 'SO-10042',            // optional: its number (or name)
  reportId: 41,               // optional: the bireport opened
  params: {}                  // optional, reserved: overrides keyed by report-setting title
};
```

**`params` is always `{}` today.** It is reserved for per-launch overrides keyed by
report-setting title, but no host fills it yet. Reports must not depend on it. Their
settings come from the report's saved setting values, which the host applies as the BI
Report module does.

**Only the Apps menu sends `FB_LAUNCH`.** Reports opened in the Report Workspace get
`window.FB_WORKSPACE` instead (see the report_btn README), with no record. The BI Report
module and the BI Script Editor preview send nothing.

**Transport.** Insert a script tag straight after the first `<head>` tag that is not
inside a comment, before the page reaches the browser:
`<script>window.FB_LAUNCH={…};</script>`.
- report_btn inserts it into the page text that `REPLACE_INCLUDES_BI_SCRIPT` returns.
  The toolbar's Refresh reloads that text, so the value survives.
- A host that controls the browser can set the same value from a JxBrowser
  `InjectJsCallback` instead.

**Encoding.** The payload is JSON with two extra rules:
- Write `<` as `\u003c`, so the data cannot close the script.
- Write `$` as `\u0024`. Fishbowl's settings substitution is a plain text replace
  over the whole page, so it then cannot find a setting token inside the data.

## 3. Modules: tag keys, groups and record ids

- **tag key:** the module's key for section 1.
- **group:** the module's menu group in the client.
- **`module`, `table` and id:** what the launch carries. The id is what each client
  module's `getObjectId()` returns. It was read from the module classes in the 26.9.1
  client, e.g. `SOModuleClient.getObjectId()` returns `SalesOrderFpo.getId()`.

**Codes.** Where Fishbowl has its own report-setting code (`QueryParamTypeConst`),
`module` uses it. RMA and the setup records use their module's enum name.

| Client module | tag key | group | `module` | `table` | id is | `num` from |
|---|---|---|---|---|---|---|
| Sales Order | SO | SALES | SO | so | the sales order | num |
| Picking | PICK | SALES | PICK | pick | the pick | num |
| Shipping | SHIP | SALES | SHIP | ship | the shipment | num |
| Customer | CUST | SALES | CUST | customer | the customer | name |
| RMA | RMA | SALES | RMA | rma | the RMA | num |
| Pricing Rule | PRICING_RULE | SALES | PRICING_RULE | pricingrule | the rule | name |
| Purchase Order | PO | PURCHASING | PO | po | the purchase order | num |
| Receiving | RECEIPT | PURCHASING | RECEIPT | receipt | the receipt | (none) |
| Vendor | VEND | PURCHASING | VEND | vendor | the vendor | name |
| Manufacture Order | MO | MANUFACTURING | MO | mo | the MO | num |
| Work Order | WO | MANUFACTURING | WO | wo | the work order | num |
| Bill of Materials | BOM | MANUFACTURING | BOM | bom | the BOM | num |
| Part | PART | MATERIALS | PART | part | the part | num |
| Product | PROD | MATERIALS | PROD | product | the product | num |
| **Inventory** | **INVENTORY** | MATERIALS | **PART** | **part** | **the selected part** | num |
| Transfer Order | TO | MATERIALS | TO | xo | the transfer order | num |
| **Consignment** | **CONSIGNMENT** | MATERIALS | **LOC** | **location** | **the consignment location** | name |
| Class | CLASS | ACCOUNTING | CLASS | qbclass | the class | name |
| Currency | CURRENCY | ACCOUNTING | CURRENCY | currency | the currency | name |
| Tax Rate | TAX_RATE | ACCOUNTING | TAX_RATE | taxrate | the tax rate | name |
| Carrier | CAR | SETUP | CAR | carrier | the carrier | name |
| Location | LOC | SETUP | LOC | location | the location | name |
| Location Group | LG | SETUP | LG | locationgroup | the location group | name |
| User | USER | SETUP | USER | sysuser | the user | userName |
| User Group | USER_GROUP | SETUP | USER_GROUP | usergroup | the group | name |
| Company | COMPANY | SETUP | COMPANY | company | the company | name |
| Payment Terms | PAYMENT_TERMS | SETUP | PAYMENT_TERMS | paymentterms | the terms | name |
| UOM | UOM | SETUP | UOM | uom | the UOM | name |
| any other module | from its name, e.g. CALENDAR | its own | same as the tag key | — | whatever the module returns, usually 0 | — |

**Record type vs tag key.** Inventory sends a `PART` record and Consignment a `LOC`
record, so a part report reads the same fields from either module. Their tag keys
differ (`INVENTORY`, `CONSIGNMENT`), so a tag can still target exactly one of them.

**Where the list lives:** report_btn's `ModuleCodes`, `FBDoc.launch.MODULES`, this
table, and the tag-key to group map (`MODULE_GROUP`) in the Report Launcher, which groups
reports by it. Keep all four in step.

## 4. Reading it in a report

**With fb-doc** (the paperwork reports):

```js
var launched = FBDoc.launch.get();      // normalised object, or null
var soId = FBDoc.launch.id('SO');       // the id when launched for a sales order, else 0
```

`get()` normalises the payload:
- It accepts an object or a JSON string.
- It upper-cases `module`.
- It takes `table` from the host, else from the code map.
- An `id` of 0 or less becomes `0`.
- It returns `null` when there is no launch or the payload is junk.

**Without fb-doc**, read the global directly:

```html
<head>
  <meta charset="UTF-8">
  <meta name="fb-launch" content="PO">          <!-- listed in the Purchase Order module -->
</head>
<script>
  var L = window.FB_LAUNCH || null;             // absent when opened from the BI module
  var poId = (L && L.module === 'PO' && L.id > 0) ? L.id : 0;
  if (poId) loadPo(poId); else showPicker();
</script>
```

**Precedence (`FBDoc.app`, so every paperwork document):**
1. A launch for a module the report takes, by `id`, else by `num`.
2. Otherwise the report's normal start: the adopt-once Sales_Order setting, then the
   user's last pick, then the newest order.

The report also follows these rules:
- **A launched record is fixed.** The record picker, prev/next and Refresh are hidden,
  leaving the title, status, **Print** and **Settings**; paper size and document flags
  (e.g. Invoice) are in the Settings drawer. The plugin window's native toolbar still has
  Print / Save-PDF / Email. This stops someone changing the order by accident.
- A launch never marks the setting as adopted, and is not remembered as the user's last
  pick.
- A launch from another module is written to the debug console and ignored; the report
  then starts normally, with the picker.
- The status line ends "from <module> module".

## 5. Host checklist

A host should:
1. List only the reports the user may open. Follow `bireportaccess`: a report is listed
   when one of the user's groups has a row for it, and admin sees every report.
2. Call the module's `checkForSave()` first, then read `getObjectId()`.
3. Load the report the way the BI Reports module does, so the server expands the
   Script / Style directives and the saved settings apply:
   `BI_REPORT_LOAD`, then `REPLACE_INCLUDES_BI_SCRIPT`, then `BiBrowserPanel`.
4. Insert `FB_LAUNCH` as in section 2.
5. Leave the page's scrollbars and print path alone. `BiBrowserPanel` brings the native
   Print / Save-PDF / Email.
