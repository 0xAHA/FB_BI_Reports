# report_btn: module-related BI reports, and the Report Workspace

**Status:** proof of concept, version 0.4.0.
- **0.1.0 works in the client** (2026-10-12): Reports → Apps in Sales Order opens the
  Sales Order paperwork on the open order.
- **0.3.0** adds module and menu-group keys.
- **0.4.0** adds the **Report Workspace** module (below). It is installed and working
  in the client (2026-10-12).

**Building a report for these hosts?** Read
[Building a report for report_btn](#building-a-report-for-report_btn).

One Fishbowl client plugin, two features:
1. **Apps menu.** An **Apps** section at the bottom of the main **Reports** menu,
   listing the BI reports that belong to the current module.
2. **Report Workspace.** A module under Reporting that holds BI reports in tabs, with
   Back, Forward and Home. Any BI report can open another report in it.

## Apps menu

The Apps section lists the BI reports that belong to the current module:

```
Reports                          (in the Purchase Order module)
  …the module's own reports…
  ──────────────
  Apps
  - Purchasing - Open POs        ← its fb-launch tag names PO or PURCHASING
  - Bid Request                  ←    "      "
```

- **Which reports a module lists.** A report belongs to a module when its page's
  fb-launch tag names the module's key, or the module's menu group. For this proof of
  concept the tag *is* the visibility setting; a proper implementation would store it
  elsewhere.
- **Access.** The BI Reports module's access rules still apply.
- **Opening a report.** Choosing one opens it in its own window on the module's open
  record. The window is the BI Reports module's own report panel, so the report gets:
  - the native Refresh, Parameters, Save → PDF, Print and Email buttons;
  - its saved settings;
  - the live fb-lib and fb-styles.
- **The record** reaches the report as `window.FB_LAUNCH`. The format, every module's
  key and group, and what each module's record id is are in
  [`../Paperwork_POC/LAUNCH_CONTEXT.md`](../Paperwork_POC/LAUNCH_CONTEXT.md).

## Building a report for report_btn

For report developers. A report is one `.htm` page saved as a BI report. What decides
where it shows, and what it receives, is set out below.

| Concern | Decided by | Section |
|---|---|---|
| Which module's **Apps** menu lists it | the `fb-launch` meta tag | [1](#1-list-it-in-a-module-the-fb-launch-tag) |
| Its identity, file name and storage keys | the `FB_REPORT` block | [2](#2-name-and-key-the-page) |
| The open record it receives | `window.FB_LAUNCH`, set by the host | [3](#3-read-the-launched-record) |
| Settings and parameters | report settings, plus `FB_LAUNCH` | [4](#4-settings-and-parameters) |
| Opening other reports | `openModule('Report Workspace', …)` | [5](#5-open-other-reports) |

**The name does not tie a report to a module.** Neither does its folder or its
`- Folder -` prefix. Only the `fb-launch` tag does that.

### 1. List it in a module: the fb-launch tag

Put one tag in `<head>`, written exactly like this:

```html
<meta name="fb-launch" content="PURCHASING">   <!-- Purchase Order, Receiving and Vendor -->
```

| `content` | Listed in |
|---|---|
| `PO` | Purchase Order only |
| `SO, SHIP` | Sales Order and Shipping |
| `PURCHASING` | every module in the Purchasing menu group |
| `INVENTORY` | Inventory only (it sends a **part** record) |
| (no tag) | no module. The report is still in the BI Report module and the launcher. |

- **Module keys:**
  - Sales: `SO PICK SHIP CUST RMA PRICING_RULE`
  - Purchasing: `PO RECEIPT VEND`
  - Manufacturing: `MO WO BOM`
  - Materials: `PART PROD INVENTORY TO CONSIGNMENT`
  - The full table, with each module's record, is
    [LAUNCH_CONTEXT §3](../Paperwork_POC/LAUNCH_CONTEXT.md#3-modules-tag-keys-groups-and-record-ids).
- **Group keys:** `SALES PURCHASING MATERIALS MANUFACTURING ACCOUNTING SETUP GENERAL
  REPORTING INTEGRATIONS`. Separate keys with commas or spaces; case doesn't matter.
- **Write the tag exactly once.** Use `name="fb-launch"` with double quotes. The plugin
  reads only the first one in the stored page, so keep it out of comments, scripts and
  anything inlined (fb-lib, includes).
- **Scan timing.** Tags are re-read every 60 seconds, so a new tag shows within a
  minute of saving. Restart the client to see it at once.
- **Access still applies.** A user sees the report only if one of their groups has
  access to it in the BI Report module (admin sees all). A report with no access groups
  is admin-only.

### 2. Name and key the page

Start from `Template/Core_Dashboard_Template.htm`. Its first `<head>` script is the
identity block:

```js
window.FB_REPORT = {
    key:   'cdx.bi.soSummary',               // storage-key prefix: unique, max 31 characters
    name:  'Sales Order Summary',            // the Fishbowl record name
    build: 'UNSTAMPED'                       // @fb-build (stamped by tools/stamp; never edit)
};
```

- **`name`** is the report's plain name, with no `- Folder -` prefix (dropped
  2026-10-12). Name the file after the report, in the matching repo folder:
  `Sales Order Summary` is `SalesOrder/SalesOrderSummary.htm`.
- **Grouping comes from the module tag (§1),** not the name. The Report Launcher
  groups reports by the client's menu groups: a module key goes under its group
  (`SO` under Sales), and a group key under itself. A page with no tag is grouped by a
  legacy `- Folder -` prefix in its name, then by keywords. An admin can override the
  group in the launcher's Manage mode.
- **Never rename a published report casually.** An import keys on the name, so a new
  name creates a duplicate record. Links by name (§5) and the Home report also break.
- **`key`** prefixes everything the report stores (`FB_REPORT.key + '.user.v1'` etc.),
  so make it unique. Someone who copies a report in Fishbowl changes this one line.
- **Description.** Put one short sentence in `<meta name="description" content="…">`
  in `<head>`. Deploy and publish copy it into the record's description wherever
  that is empty or only repeats the name. The launcher shows it on the tile, searches
  it, and shows it in full in the tile's hover tooltip.

### 3. Read the launched record

When the Apps menu opens a report, the plugin sets `window.FB_LAUNCH` before any page
script runs:

```js
{ v: 1, host: 'report_btn', module: 'PO', moduleName: 'Purchase Order',
  table: 'po', id: 290, num: 'PO-10042', reportId: 41, params: {} }
```

| Field | Meaning |
|---|---|
| `module` | The **record type** (`SO`, `PO`, `PART` …), not the tag key. Inventory sends `PART`; Consignment sends `LOC`. |
| `id` | The record's primary key in `table`. `0` means no record was open, or it wasn't saved yet. |
| `num` | Its number or name, when the module has one. |
| `params` | Reserved. Always `{}` today (see §4). |

A report should treat the launch as optional:

```js
var L = window.FB_LAUNCH || null;     // absent when opened from the BI Report module or the workspace
var poId = (L && L.module === 'PO' && L.id > 0) ? L.id : 0;
if (poId) {
    loadPo(poId);                     // launched on a record: show it, and hide the record picker
} else {
    showPicker();                     // normal start: the report's own picker or last choice
}
```

- **Check `module` before using `id`.** A report tagged `PURCHASING` is also offered
  in Receiving and Vendor, and an `id` from those modules is a receipt or vendor id, not
  a PO id.
  - Act on the record types the report understands.
  - For any other launch, log it to the debug console and start normally.
- **`FB_LAUNCH` is absent** in the BI Report module, the BI Script Editor preview and
  the Report Workspace. Every report needs its normal, unlaunched start.
- **Don't save a launched record as the user's last choice,** and fix it in place: hide
  or disable the picker and prev/next. The paperwork reports do this; see
  [LAUNCH_CONTEXT §4](../Paperwork_POC/LAUNCH_CONTEXT.md#4-reading-it-in-a-report).
- **With fb-doc,** `FBDoc.launch.get()` returns the normalised payload, and
  `FBDoc.launch.id('PO')` returns the id, or 0.

### 4. Settings and parameters

A report gets its inputs three ways:

1. **The launched record:** `FB_LAUNCH.id` / `num` (§3). This is the only per-launch
   input today.
2. **Report settings.** These are the BI Script Editor's "Insert Report Setting" tokens,
   `$CODE{Title|default|Group}`, e.g. `$CHECK{Invoice|0|Document}`.
   - Both hosts load a report with its **saved setting values**, exactly as the BI
     Report module does. The native **Parameters** button changes them.
   - Values are stored on the BI report, so every user shares them.
   - Fishbowl substitutes tokens by plain text replacement over the whole page, so
     write each token exactly once, inside a `<script type="text/plain">` block, and
     read it from there.
   - The same text replacement is why `FB_LAUNCH` writes `$` as `$`.
3. **The user's own choices:** `FBLib.Settings`, keyed from `FB_REPORT.key`.

**`FB_LAUNCH.params` is reserved and always `{}`.** It is meant to carry per-launch
overrides keyed by report-setting title, but nothing fills it yet. Workspace links (§5)
carry only a report id or name, so **no host passes per-launch parameters today**.
Don't build a report that depends on them.

### 5. Open other reports

In the Report Workspace, any report can open another:

```js
openModule('Report Workspace', '- Sales - Sales Order Summary');      // same tab
openModule('Report Workspace', 'tab:Sales Order Summary');  // new tab
```

- **Link by record name, not id.** Ids differ between databases; names travel with
  imports.
- **In the BI Report module,** the same call switches to the workspace and opens the
  report there. Without the plugin, it shows an "Invalid Module" dialog.
- **Inside the workspace,** the page has `window.FB_WORKSPACE`
  (`{v, module, tab, reportId, canBack, canForward}`). Check it before offering links,
  as the Report Launcher does.
- **The opened report receives no record context** (§3).

### Checklist

- [ ] Started from the template; `FB_REPORT.key` is unique (31 characters or fewer) and
      `name` is the plain report name, matching the file.
- [ ] One `<meta name="description" content="…">` with a short description.
- [ ] One `<meta name="fb-launch" content="…">` in `<head>`, if any module should list it.
- [ ] `FB_LAUNCH` is optional: checked by `module`, with a normal start when absent.
- [ ] A launched record is fixed and not remembered as the last choice.
- [ ] Each report-setting token is written once, in a `text/plain` script block.
- [ ] Links to other reports use the record name, and only when `FB_WORKSPACE` exists.
- [ ] Groups that should see it are given access in the BI Report module.

## Report Workspace

A module named **Report Workspace**, under **Reporting**. Each tab holds one BI report
in the BI module's own report panel, so the report keeps its native toolbar, its saved
settings and its real report id (`saveReportData` works).

**The toolbar** (the client's main toolbar while the module is active):

| Button | Does |
|---|---|
| Back / Forward | Steps through the reports opened in the selected tab. Alt+←/→ works when focus is outside the page. |
| Home | Opens the Home report in the selected tab. |
| New Tab | Opens the Home report in a new tab. |

- Close a tab with its × or a middle-click.
- On the first visit, or after every tab is closed, the module opens Home.
- **Home** is the BI report named `Report Launcher` (renamed from
  `- System - Report Launcher` on 2026-10-12; a jar built before then looks for the old name)
  (`Other_NOT_FOR_PRODUCTION/Report_Launcher`). If it is missing, or the user can't
  open it, the tab says so.

**Opening a report from any BI report.** Every page already has the bridge function:

```js
openModule('Report Workspace', '123');                // report id 123, in the selected tab
openModule('Report Workspace', 'tab:123');            // ... in a new tab
openModule('Report Workspace', 'Sales Order Summary');  // by exact record name (tab: works too)
openModule('Report Workspace', 'home');               // also 'tab:home', 'back', 'forward'
```

- The call selects the workspace module and opens the report there. The user must be
  able to open the report under the same `bireportaccess` rules as the Apps menu.
- Pages the workspace hosts get `window.FB_WORKSPACE = {v, module, tab, reportId,
  canBack, canForward}`. A page uses it to tell that it's in the workspace, as the
  Report Launcher does.
- **Ids differ between databases.** For links between reports, prefer the record name.

**Why the history is the plugin's, not Chromium's.** The report panel and its browser
remember only the report given to the last `loadHTML`: the id `saveReportData` uses,
and what Refresh, Print and Save act on. A Chromium Back would show an older page while
those still pointed at the newer one. So each Back or Forward reloads its report the
same way the BI module opens one.

**Why `openModule('BI Report', id)` can't do this.** The client's `openModule` calls
`showModule(name)`, then `getModule(name).handleHyperLink(item)`. The BI Report module
inherits an empty `handleHyperLink`, so it only switches modules. This module overrides
`handleHyperLink`.

**Rights.** The client shows a module to a non-admin only when one of their groups has a
right that starts with the module name. The plugin registers `Report Workspace-View`;
grant it in **User Groups** once the plugin is installed. Admin always sees the module.

The native version of this (no plugin) is specified in
[`../Report_Launcher/NATIVE_NAVIGATION_SPEC.md`](../Report_Launcher/NATIVE_NAVIGATION_SPEC.md).

## Build and install

```
./build.sh             # -> target/report-btn.jar   (Git Bash)
./build.sh --check     # ... and run the self-check (link grammar, script insertion, tags)
./build.sh --install   # ... replace any report-btn*.jar in C:\Program Files\Fishbowl\plugins
```

Restart the Fishbowl client after installing.
- **Close the client first.** While it runs, it locks its plugin jars, so the old one
  cannot be removed. Overwriting the old jar in place does work.
- **No JDK is needed.** When `JAVA_HOME` has no `javac`, the script runs the Eclipse
  compiler on Fishbowl's own Java 21 runtime. It takes the compiler from VS Code's Java
  extension; set `ECJ_JAR` to use another copy.
- **Classpath:** the jars in `C:\Program Files\Fishbowl\lib`. Set `FB_HOME` for another
  install.
- **Jar name:** it carries no version (the version is in the manifest), so an upgrade
  never leaves two copies of the plugin.
- **Discovery:** the client loads any jar in `plugins\`. It scans the `com.fbi.plugins`
  package, so no manifest entries are needed.

## How it works

| Class | Job |
|---|---|
| `ReportAppsPlugin` | A hidden `FishbowlPlugin` module (`shouldShow()` is false). The client creates every plugin module at login (`Client.loadModules`); the constructor installs the menu hook. |
| `ReportAppsMenu` | Hooks `Client.reportMenu` (private, read by reflection) and lists the reports matching the module's key or its menu group (`getMenuGroupConst()`). |
| `AppCatalog` | Holds the access list and the fb-launch tags (see below). The workspace resolves ids and names through it. |
| `ModuleCodes` | Client module → tag key, record code, table and naming column. The record ids were read from each module's `getObjectId()`. |
| `AppLauncher` | Opens the Apps report window (steps below). Also holds `jsonString` and `insertScript`. |
| `ReportLoader` | Loads a report as the BI module does: `BI_REPORT_LOAD`, `REPLACE_INCLUDES_BI_SCRIPT`, saved settings. Shared by both features. |
| `ReportWorkspacePlugin` | The visible Report Workspace module: tabs, toolbar, `handleHyperLink`. |
| `ReportTab` | One workspace tab: a `BiBrowserPanel` and its history of report ids. |
| `WorkspaceLink` | Parses the `openModule('Report Workspace', item)` grammar. |
| `PaintedIcon` | The drawn Back / Forward / Home / New Tab icons (Fishbowl ships none). |

**The menu hook.** The client rebuilds the Reports menu on every module switch
(`Client.updateReportMenu`: `removeAll()`, then My / Company Reports). So the Apps
section is re-added each time the menu opens. The client also disables the menu when
the module has no reports and the user lacks Reports rights; the plugin turns it back
on while the module has reports to list.

**The two lists `AppCatalog` keeps:**
- **Access list:** per user, re-read after 30 s. It takes milliseconds.
- **fb-launch tags:** scanning for them reads every page (0.2–0.5 s for 12 MB on
  demodb). So it runs in the background at login and then every 60 s, and the menu
  never waits for it.

**Opening a report.** `AppLauncher` mirrors `BiReportModuleClient.loadData`:
1. Call `checkForSave()`, then read `getObjectId()` and look up the record's number.
2. Send `BI_REPORT_LOAD`, then `REPLACE_INCLUDES_BI_SCRIPT` (`ReportLoader`).
3. Insert `FB_LAUNCH` after the head tag.
4. Build the saved settings as `QueryParameter`s.
5. Call `new BiBrowserPanel().init(module, false)` and
   `loadHTML(html, reportId, name, false, params)`. These are the same arguments the
   BI module passes.

**Server errors.** An EVE reply with message type 201 is an error, the same test
`ClientModuleImpl.handleException` uses. 0.1.0 had this test inverted and showed "An
unknown error has occurred".

## Client test (0.3.0)

1. Restart the client, then open Sales Order → Reports. Apps should list the Sales
   Order paperwork, whose tag is `SO`.
2. Add `<meta name="fb-launch" content="PURCHASING">` to a test report and save it.
   Within a minute, Apps should list it in Purchase Order, Receiving and Vendor, and
   not in Sales Order.
3. Change the tag to `PO`. It should then show in Purchase Order only.
4. Open it from Purchase Order with a PO loaded. A report that prints
   `JSON.stringify(window.FB_LAUNCH)` should show `module: "PO"` and that PO's id.
5. Log in as a user without access to the report. It should not be listed for them.

## Client test (0.4.0, Report Workspace)

Install with the client closed (`./build.sh --install`), then start it as admin.
1. **Reporting → Report Workspace** opens with one tab: the Report Launcher (Home).
2. Click a tile. The report opens in the same tab, and the tab takes its name. Back
   returns to the launcher, and Forward goes to the report again.
3. Ctrl+click (or middle-click) a tile. It opens in a new tab. Close the tab with its ×.
4. In a workspace tab, open a report that saves with `saveReportData`. It saves without
   "Save Report Error", which shows the real report id reached the page.
5. The report's own Refresh, Parameters, Print and Save act on the report shown.
6. From the **BI Report** module, run a report that calls
   `openModule('Report Workspace', 'tab:<id>')`. The client switches to the workspace
   and opens it there.
7. Grant `Report Workspace-View` to a group in **User Groups**, then log in as a member
   (e.g. WSmith). The module shows. A report their groups can't open gives "doesn't
   exist, or you don't have access".

The client console logs lines prefixed `[report_btn]`.

## Known limits

- An Apps choice opens a new window. Nothing reuses an open one.
- **Back and Forward reload the report.** A report that doesn't keep its own state
  (most keep theirs with `FBLib.Settings`) comes back with its defaults.
- **Alt+←/→ only work when focus is outside the page,** e.g. on the tabs. Inside the
  page, Chromium has the keys.
- Each open tab is a Chromium browser, so close tabs you're done with.
- `BI_REPORT_LOAD` may require BI Reports module rights on the server. A refusal is
  shown with the server's message.
- `Client.reportMenu`, `getCurrentModule()` and the module classes are client
  internals, so a client update could rename them. The plugin then logs and does
  nothing.
