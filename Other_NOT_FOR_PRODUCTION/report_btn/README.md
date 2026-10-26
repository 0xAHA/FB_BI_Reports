# report_btn: module-related BI reports, and the Apps (beta) module

**Status:** proof of concept, version 0.7.8.
- **0.1.0 works in the client** (2026-10-12): Reports → Apps in Sales Order opens the
  Sales Order paperwork on the open order.
- **0.3.0** adds module and menu-group keys.
- **0.4.0** adds the workspace module (below), named **Report Workspace** until 0.5.1. It is installed and working
  in the client (2026-10-12).
- **0.5.0** adds the **page editor** inside the Apps (beta) module, a removable
  extension ([Page editor](#page-editor-removable)). Built and self-checked
  (`./build.sh --check`); **not yet tested in the client**.
- **0.5.1** renames the workspace module to **Apps (beta)** (BI Reports are becoming
  Apps). Its right is now `Apps (beta)-View`, so re-grant it to any group that had
  `Report Workspace-View`, and links must use `openModule('Apps (beta)', …)`. The page
  preview can be closed and docked below or beside the code.
- **0.5.2** moves the editor's inserts into the selector: the Include… / Setting… /
  Function… buttons are gone, and **Report settings → right-click → Add setting…** asks
  for the type. Pages get a **Dashboard gadget** box (beside Published, and in New App).
  Labels say *app* instead of *BI report/page*. fb-lib functions carry JSDoc, and the
  selector and autocomplete lay out its summary, parameters, returns and examples.
- **0.5.3** adds the **Apps panel** (every app in a folder per menu group and module,
  plus shared scripts, styles and templates; filter as you type; multi-select actions),
  **New ▾** (app, script, style or template), **Import** and **Download** (the BI
  Editor's own), a two-row **Find/Replace** with Find all marked beside the scroll bar,
  and fixes History's Compare (it compared the two titles).
- **0.5.4** lets you drag apps between folders in the Apps panel (Ctrl+drag adds), and
  adds **Move to** / **Also show in** menus; either rewrites the app's `fb-launch` tag and
  saves it. The Apps panel / Insert panel boxes follow the panels' order on screen.
- **0.5.5** separates the two placements. **Module association** (`fb-launch`) only
  decides which modules' Apps menus list an app, and is set with a checkbox picker.
  **Folder** (`fb-folder`, one name) decides where it sits in the Apps panel and the
  **App Library** (the Report Launcher, renamed; Home now opens it). Dragging an app,
  or Move to folder, changes the folder only, adding the tag to pages without one.
  Folders are Fishbowl's own Company report folders, the ones apps use, and ones
  created with Reports-Company Edit.
- **0.5.6:** the Apps panel gets an **Apps menus** view (menu group › *All … modules* and
  each module, with the apps each lists) for bulk **Remove from …**, **Add to Apps menu ▸**
  and drag between Apps menus (Ctrl+drag adds). Moves and Apps-menu changes save without a
  confirm and end with one line ("Open Sales Orders was moved to Customer."). A changed
  Apps-menu association rescans at once, so the next module switch lists it. UI text
  drops tag names. The ribbon gets the client's separators, a New split button and
  Fishbowl's Import icon, and grows to the previous module's ribbon height; the editor
  toolbar has an icon on every button and dividers between groups.
- **0.5.7:** an app can leave the Apps (beta) tabs. **Main Tab** moves it into a main client
  tab of its own (a module named `Apps (beta)-<app>`, which the Apps (beta)-View right covers
  and the module menus never list); the client's **Save Bookmark** then remembers it and
  reopens it at login (`AppModules` makes the module on demand). **Window** moves it into a
  window of its own, excluded from application-modal dialogs so a dialog in the main
  window doesn't lock it. Both have Back, Forward, Reload and a way back to the Apps
  tabs (and to each other). Saving an app reloads it wherever it is shown.
- **0.5.8 / 0.5.9:** the **App Library** (Home) is built into the plugin. build.sh copies only
  its page (`../Report_Launcher/Report_Launcher.htm`) into the jar; its includes stay the
  `fb-lib` and `fb-styles` scripts saved in Fishbowl, which the server expands
  (`REPLACE_INCLUDES_BI_SCRIPT`) as for any app, so they keep their own deploy path. Home needs
  no record, import or access rows; a change to the page itself needs a new jar. The page's
  deploy target is `none` (the `App Library` record in Fishbowl is no longer used).
- **0.5.10:** the editor header's Folder box and Apps menus line become two toolbar buttons,
  **Folder…** and **Apps menus…**, which open the folder list and the module checkboxes
  (their tooltips name the current choice). Opening or switching to an editor tab selects
  its record in the Apps panel, with its folder opened. Saving reloads an open preview.
- **0.5.11: system apps.** A page tagged `<meta name="fb-origin" content="system">` ships
  with Fishbowl: every iReport port, every `Dashboards/` page and the Paperwork replicas.
  The editor locks its code, name, description, folder and Apps menus, even for admin;
  Active, Published, gadget and access can still be changed. **Duplicate…** (on the editor
  toolbar too) asks for a name and makes a custom copy with its own storage key. Delete
  offers to deactivate a system app instead. The editor won't save a page newly marked
  system: it offers to save it as custom. The Apps panel draws apps as Fishbowl's report
  tree does: black for system, green for custom, grey when inactive; unpublished apps are
  listed in grey. The App Library and the Apps menus list only active, published apps.
- **0.5.12:** the Apps panel shows inactive and unpublished apps by colour alone (no words
  beside the name), and the editor's shading behind embedded JS and CSS is fainter.
- **0.6.0: Report Builder publishing.** The Report Builder app (`scripts/fb-builder.js`) puts its
  definition in the user's own settings (`cdx.bi.reportBuilder.outbox.v1`) and asks for
  `openModule('Apps (beta)', 'build:publish:<nonce>')`. The plugin (`editor/BuilderPublisher`) reads
  it back, checks the nonce, and asks for the name, description, folder, Apps menus and who can
  open it. It then writes the page itself from the definition (`editor/BuilderPage`: no code or
  SQL from the user; every piece of user text escaped against the browser and Fishbowl's
  substitution) and saves it. The page's `fb-builder` tag carries the nonce, which is how the
  builder learns the record, so publishing again updates it.
  - **Who may publish:** admin and BI Editor-Edit publish anywhere. The new right
    **Apps (beta)-Build Reports** publishes a new report for the user's own groups only, in the
    Custom folder and no Apps menu. It republishes a builder report the user has Edit Settings (View after ADV-6032) on,
    keeping its access, folder and menus.
  - **Never replaced:** system pages, and pages the builder didn't write.
- **0.6.1:** an app no longer stays narrower than its tab. Chromium sometimes missed the
  size it was given while the page was starting (a new tab, the module's first show) until the
  window was resized; `BrowserFit` now gives the page a one-pixel resize after each load and
  whenever the tab, window or preview is shown. The native BI Reports module is Fishbowl's own
  and keeps the problem.
- **0.7.0: documents and email, a removable proof of concept** (`docs/`). An app can stand
  in for a module's Jasper document, through new **Print (App)** and **Email (rich)** ribbon
  buttons, and emails open in a rich HTML window. See
  [Documents and email (PoC)](#documents-and-email-poc).
- **0.7.8:** the **App Library** lets each user hide apps (the eye on a tile; saved in the user's own settings) and has a **Show hidden (N)** toggle at the top that brings them back faded, with *Unhide every app* in Settings. It lists only the apps the user has View access to (bireportaccess for their groups; only the admin user sees every app), and shows an app's edit pencil only where the user may edit it: Edit Settings access while that level exists, otherwise any access (the editor's own rule, ADV-6032); a system app opens read-only there. The workspace sends `admin` and `editsettings` in FB_WORKSPACE for this.
- **0.7.7:** files dropped on the **App Library** (in the Apps (beta) workspace, with the editor and BI Editor-Edit) go to the editor: a page, script or style opens in the tab of the record with the same name and type, loaded but not saved (a page is matched by its FB_REPORT name), or as a new record named after it; exports (.json) open the Import dialog pre-filled with Publish ticked. Any other file is ignored, and the page shows a drop outline only for files it takes. The page reads the files and sends them as `drop:<json>` through openModule (WorkspaceLink DROP, WorkspaceExtension.dropped). The email composer ignores dropped files (Attach… adds attachments). fb-lib now stops the browser opening any dropped file in place of an app.
- **0.7.6:** ready for Fishbowl's BI changes (epic ADV-5903). One jar runs on 26.9 and on the builds after them.
  - **Edit Settings goes (ADV-6032).** The access the editor asks for on a report (to edit its page, change its access or republish a builder report) is Edit Settings while Fishbowl has that level, and View once it doesn't (the upgrade turns every Edit Settings row into View). It's looked up by name at run time (`AccessPolicy.EDIT_LEVEL`), and the messages name whichever level it is.
  - **Saved settings per user (ADV-6029).** An app's saved settings are read through `BiReportFpo.getParams()` looked up at run time; if Fishbowl drops it with `bireport.params`, apps open with their declared values instead of failing. Reading each user's own row comes once that build is out.
  - **Import opens what it imported** (as ADV-6010 does in the BI Editor): each record in its own tab, an open tab reloads (asking first when it has unsaved changes), the last one in front and shown in the Apps panel. More than 12 are only shown in the panel.
  - **The editor remembers its layout per user** (as ADV-6009 does in the BI Editor): the Apps and Insert panel widths, the code / preview split, where the preview docks and which panels show, in client.properties under the user's id.
  - The email window's **Attach…** opens in the folder it last added from.
  - **Drop a file on the code** (as in the BI Editor): an .htm, .js, .css or other text file's text replaces the code (Ctrl+Z undoes it; nothing is saved). A Fishbowl export (`<name>-<Type>.json`, from a Download or the SharePoint folder) also fills in the name and description, on a tab of the same kind only (a page and a template take each other's). A file whose extension doesn't match the tab asks first; images, binaries and multi-record files are refused. Text drags inside the code work as before.
  - **Drop several exports** (`.json`) on the code, or any number on the Apps panel: Fishbowl's own Import dialog opens with the files already chosen and **Publish** ticked, so OK goes on to its access step; then they open as after Import. (The dialog's file chooser and Publish box are private fields, set by reflection; if a Fishbowl build changes them, the dialog opens as the toolbar's Import does and the self-check flags it.)
  - Wording: the App Builder publishes an *app*, the Insert panel lists *App settings*, and the launch error dialog is titled *Apps*. Names of Fishbowl's own modules (BI Report module, BI Editor) stay until Fishbowl renames them.
- **0.7.5:** every app can be put in Apps menus, system apps included. A system app's code stays locked (it ships with Fishbowl, and an update replaces it), so its Apps menus are kept as the company's choice in plugin properties (`report_btn.menus`, one per app record name) and win over its own fb-launch tag; a custom app's stay in its code as before. The Apps panel (Add to / Remove from / drag / Apps menus…) and the editor's **Apps menus…** button both do it; a system app's folder stays fixed.
- **0.7.4:** the email window keeps the stock Compose Email layout, so only the body editor is new: a toolbar with **Send** and **Cancel** (the client's own icons) plus **Email App ▾** (just this once / always), then From, the **To: / Cc: / Bcc:** buttons and Subject, and **Attachments:** with the paperclip at the foot. The buttons open the client's own **Email Address Book** (Customer or Vendor tab, Company tab; double-click a row to add it to To, or to Cc / Bcc once that field is clicked in), filled with the record's address and its account's contacts, and the company's contacts and the Fishbowl users. If that dialog can't open, a copy of it in the same layout does. The template in use shows at the right of the editor bar. Addresses split correctly when a quoted name holds a comma.
- **0.7.3:** the email window. The To, Cc and Bcc labels are buttons: each opens a list of the record's customer or vendor email contacts (the order's own address first) and the Fishbowl users, ticked where the field already has them; their tooltip says to separate addresses with a semicolon. **Open in my email program ▾** offers *Just this once* or *Always* (remembered; untick it there to stop). The body editor's list, indent, alignment, link and undo / redo buttons are icons (the link button toggles: inside a link it removes it; Ctrl+K), and deleting everything (select all, Delete) starts a plain email without the template's style sheet; Ctrl+Z straight after brings the template back.
- **0.7.2:** Edit on an app no longer fails with "Comparison method violates its general contract". When two scripts exported the same name, the autocomplete list held a function and a plain entry under one name, and their sort broke; now one entry per name is kept, and a completion failure no longer stops the editor opening. System apps open read-only, ready to duplicate. The App Library's folder chips are strictly A-Z (All first, Unfiled last).
- **0.7.1:** "Open in my email program" goes to the user's default email app (the one Windows
  uses for mailto: links), not just whichever Outlook is installed. New Outlook gets the draft
  through its own command (`olk.exe`), as a `.eml` marked unsent on its first line. Classic
  Outlook gets its main window opened when it isn't running, because one started only for
  the email closed with it and kept the sent email in its Outbox.

**Building a report for these hosts?** Read
[Building a report for report_btn](#building-a-report-for-report_btn).

One Fishbowl client plugin, two features:
1. **Apps menu.** An **Apps** section at the bottom of the main **Reports** menu,
   listing the BI reports that belong to the current module.
2. **Apps (beta).** A module under Reporting that holds BI reports in tabs, with
   Back, Forward and Home. Any BI report can open another report in it.
3. **Page editor** (optional). Edit a report's page, or a shared script or style, in a
   Workspace tab: syntax highlighting, a selector of includes, report settings, Fishbowl
   functions and the functions of the page's modules,
   autocomplete, preview, history, and report access.

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
  [`docs/launch-context.md`](../../docs/launch-context.md).

## Building a report for report_btn

For report developers. A report is one `.htm` page saved as a BI report. What decides
where it shows, and what it receives, is set out below.

| Concern | Decided by | Section |
|---|---|---|
| Which module's **Apps** menu lists it | the `fb-launch` meta tag | [1](#1-list-it-in-a-module-the-fb-launch-tag) |
| Its identity, file name and storage keys | the `FB_REPORT` block | [2](#2-name-and-key-the-page) |
| The open record it receives | `window.FB_LAUNCH`, set by the host | [3](#3-read-the-launched-record) |
| Settings and parameters | report settings, plus `FB_LAUNCH` | [4](#4-settings-and-parameters) |
| Opening other reports | `openModule('Apps (beta)', …)` | [5](#5-open-other-reports) |

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
    [LAUNCH_CONTEXT §3](../../docs/launch-context.md#3-modules-tag-keys-groups-and-record-ids).
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

Start from one of the three templates in `Template/`: `List_Report_Template.htm`
(a list report), `Record_Document_Template.htm` (one record's document) or
`Form_Tool_Template.htm` (a tool that changes data). The App editor's *New* fills in
the lines marked `TEMPLATE` that it can (name, key, folder, Apps menus, description,
title, heading) and leaves the rest for you. Its first `<head>` script is the
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
  `Sales Order Summary` is `iReport_Ports/SalesOrder/SalesOrderSummary.htm`.
- **The module tag (§1) only drives the Apps menus.** Where an app is filed (the App
  Library and the Apps panel) is its own `<meta name="fb-folder" content="…">` tag:
  one folder name, written once, after the `fb-launch` tag. A page without it is
  Unfiled.
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
  the Apps (beta) module. Every report needs its normal, unlaunched start.
- **Don't save a launched record as the user's last choice,** and fix it in place: hide
  or disable the picker and prev/next. The paperwork reports do this; see
  [LAUNCH_CONTEXT §4](../../docs/launch-context.md#4-reading-it-in-a-report).
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

In the Apps (beta) module, any report can open another:

```js
openModule('Apps (beta)', '- Sales - Sales Order Summary');      // same tab
openModule('Apps (beta)', 'tab:Sales Order Summary');  // new tab
```

- **Link by record name, not id.** Ids differ between databases; names travel with
  imports.
- **In the BI Report module,** the same call switches to the workspace and opens the
  report there. Without the plugin, it shows an "Invalid Module" dialog.
- **Inside the workspace,** the page has `window.FB_WORKSPACE`
  (`{v, module, tab, reportId, canBack, canForward}`). Check it before offering links,
  as the App Library does.
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

## Apps (beta)

A module named **Apps (beta)**, under **Reporting**. Each tab holds one BI report
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
- **Home** is the App Library, built into the jar since 0.5.8 (before that, the BI record
  named `App Library`, earlier `Report Launcher`)
  (`Other_NOT_FOR_PRODUCTION/Report_Launcher`). If it is missing, or the user can't
  open it, the tab says so.

**Opening a report from any BI report.** Every page already has the bridge function:

```js
openModule('Apps (beta)', '123');                // report id 123, in the selected tab
openModule('Apps (beta)', 'tab:123');            // ... in a new tab
openModule('Apps (beta)', 'Sales Order Summary');  // by exact record name (tab: works too)
openModule('Apps (beta)', 'home');               // also 'tab:home', 'back', 'forward'
```

- The call selects the workspace module and opens the report there. The user must be
  able to open the report under the same `bireportaccess` rules as the Apps menu.
- Pages the workspace hosts get `window.FB_WORKSPACE = {v, module, tab, reportId,
  canBack, canForward}`. A page uses it to tell that it's in the workspace, as the
  App Library does.
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
right that starts with the module name. The plugin registers `Apps (beta)-View`;
grant it in **User Groups** once the plugin is installed. Admin always sees the module.

The native version of this (no plugin) is specified in
[`../Report_Launcher/NATIVE_NAVIGATION_SPEC.md`](../Report_Launcher/NATIVE_NAVIGATION_SPEC.md).

## Page editor (removable)

A proof of concept: the Apps (beta) module's own BI page editor, so a report can be
changed beside the report itself instead of in the BI Editor module.

**The Apps panel**

One explorer, shared by the editor tabs (it moves into whichever one shows; untick
**Apps panel** to hide it):
- **Folders:** one level, from each page's `fb-folder` tag: Fishbowl's own Company
  report folders (read from `reporttree`, shown even when empty so apps can be dropped
  in; untick *Empty folders* to hide those), the folders apps use, and folders created
  here. Apps without the tag are under *Unfiled*; scripts, styles and templates under
  *Shared*. The module association is in the tooltip (*Apps menus: …*). Counts per folder.
  App icons follow Fishbowl's report tree: **black** for a system app, **green** for a
  custom one, **grey** when inactive (untick *Inactive* to hide them); an inactive script
  or style has its type icon greyed. **Unpublished** apps are listed in grey text, like an
  empty folder; no words are added for either. *gadget* and *built in* are noted beside the name; the
  tooltip has the description, System or Custom, folder and Apps menus.
- **Filter** as you type: name, description, type, tag and folder names (and the words
  *inactive*, *unpublished*, *gadget*, *system*, *custom*).
- **Select several** (Ctrl/Shift+click; a folder selects what it holds), then
  right-click or **Actions ▾**: Open, Run the app, Publish… (asks who can open them),
  Unpublish…, Activate / Deactivate…, Make / Remove dashboard gadget, Access… (one
  access list applied to every selected app: each report's own rows are updated, new
  groups added, others set to None), Duplicate… (one record: asks for the copy's name and
  opens it; several: named "<name> Copy"; each a new, unpublished, custom record, an app's
  copy with its own name and storage key), Download…, Delete… (`DELETE_BI_SCRIPT`;
  Fishbowl deletes a page's reports and access with it; a system or built-in record is
  offered deactivation instead, as in the BI Editor), Refresh.
- **Drag apps onto a folder** (or onto an app in it), or **Move to folder ▸** (every
  folder, Unfiled, New folder…): after one confirm each page is read fresh, its
  `fb-folder` tag rewritten or added (after `fb-launch`, else the charset meta, else
  `<head>`, `<html>`, the doctype, or the first line of a bare fragment) and saved.
  The module association is untouched. Built-in apps are skipped: changing their code
  makes Fishbowl save a copy.
- **Module association…** (and **Apps menus…** on the editor toolbar): a checkbox
  per menu group ("every Sales module") and per module; unknown keys are kept in a text
  field. It rewrites (or adds) the `fb-launch` tag. In the editor tab, **Folder…** (the
  folder list, Unfiled, or a new name) and **Apps menus…** edit the code undoably and
  Save keeps them; the panel's versions save at once.
- **The open record is selected:** opening or switching to an editor tab opens its folder
  and selects it (unless the filter hides it, or it isn't saved yet).
- **New folder… / Rename folder… / Delete folder** (Reports-Company Edit): created folders
  are stored once for the company in the plugin's properties (`FolderStore`); renaming
  refiles the folder's apps; delete only when empty. Fishbowl's own folders can't be
  renamed or deleted here.
- **Every action** checks the editor's rights record by record (Delete also needs BI
  Editor-Delete), lists what it will do and skip in one confirm, leaves alone any record
  with unsaved changes in an editor tab, then reloads the clean editor tabs and open
  report tabs of the records it changed.

**Opening it**
- **Edit** on the workspace toolbar: the selected report's page.
- The **✎ pencil** on a Report Launcher tile: `openModule('Apps (beta)', 'edit:<id>')`.
  The Launcher shows it only when `window.FB_WORKSPACE.edit` is true (the editor is
  built in and the user has BI Editor-Edit).
- **New ▾** on the toolbar: **App…** from the `BI Template` page (or a Template record,
  or blank), with a name, description, module tag, Published, Dashboard gadget and the
  app's access; or a blank **Script**, **Style** or **Template**, named in the tab.
- **Import** on the toolbar: the BI Editor's own Import dialog (`UploadScriptDialog`,
  with Fishbowl's JSON mapper), for files from a Download or the SharePoint folder. A
  record with the same name and type is updated; others are created. What it wrote then
  opens, each in its tab (an open tab reloads), the last one in front.
- The **Apps panel** on the left of every editor tab (below).
- Right-click an include in the selector: **Open in the editor** (fb-lib, fb-styles, …).

**In the tab**
- **The code:** RSyntaxTextArea (already in the client's `lib/`). It highlights HTML with
  embedded JS and CSS, and JS or CSS for scripts and styles, with folding and bracket
  matching. Find/replace uses Ctrl+F / Ctrl+H / F3, and Ctrl+G goes to a line.
- **The selector** (right):
  - *Modules in this page:* the functions of every script the page includes, indexed from
    the saved script (`JsIndex`: IIFE return maps, `global.X = {}`, `X.a = …`
    assignments, aliases, getters).
  - *Includes:* every active Script, Style, Template and Image. ✓ means the page already
    includes it; a duplicate directive is refused, because Fishbowl replaces every copy.
  - *Fishbowl functions:* the bridge, `JsFunctionConst` plus the functions it leaves out.
  - *Report settings:* every `$CODE{…}` type, and the tokens the page already uses.
    Double-click a type, or right-click the section and **Add setting…** to pick the type
    in the dialog. Tokens match `QueryParamTypeConst.buildCode`, as the BI Editor's own
    Setting dialog writes them.
  - *Docs:* a `/** … */` JSDoc block directly above a declaration is its doc (nothing
    above it is collected). Its summary, `@param` (types, optional, defaults,
    `opts.x`), `@returns` and `@example` are laid out in the doc pane and the
    autocomplete popup, and `@param` types feed parameter assistance.
  - *Every module* lists every script's functions. Inserting one from a module the page
    doesn't include offers to add its include.
- **Autocomplete:** Ctrl+Space, or on its own after a dot (`FBLib.Common.fo` →
  `formatMoney(value)`, with its doc).
- **Margin warnings:** a directive or setting token written twice; an include that names
  no active record.
- **Preview (F5):** the unsaved page through `REPLACE_INCLUDES_BI_SCRIPT`, in the native
  `BiBrowserPanel`, with the report's id and settings. **Sandbox preview** uses id -1, as
  the BI Editor does. The preview's header docks it **Bottom** or **Right** (the choice
  holds for the session) and **✕** closes it, stopping the page; F5 opens it again.
  Saving reloads an open preview.
- **Find** (Ctrl+F / Ctrl+H): Find and Replace rows under the code. Typing marks every
  match; **Find all** marks them in the error strip beside the scroll bar too, and the
  status says "3 of 12". Previous / Next wrap; **Replace** / **Replace all** are undoable.
  Match case, Whole word and Regex apply to all of them.
- **Download:** as the BI Editor's Download: asks to save first, then writes this record
  and the records it includes (`GET_BI_SCRIPT_EXPORT_DATA`) to a folder you pick, one
  `<name>-<Type>.json` each, in Fishbowl's own JSON (the same files Import reads).
- **History → Compare** now shows the code. `DiffDialog.setData` takes
  (fromText, fromTitle, toText, toTitle); 0.5.0–0.5.2 passed the titles as the text.
- **Dashboard gadget** (pages): sets `bireport.widget` on the page's report, as the BI
  Report module's Details tab does: a fresh `BI_REPORT_LOAD`, then `BI_REPORT_SAVE` with
  the access unchanged. Needs BI Report-Edit as well as edit rights on the page; enabled
  only while Published is ticked. Changing only the box doesn't re-save the page.
- **Save (Ctrl+S):** `SAVE_BI_SCRIPT`, after these checks:
  - the native rules: a name and description, at most 64 characters, no `_`;
  - name + type unique;
  - the user's rights, re-checked;
  - a confirm that lists what applies: a built-in record is copied, not changed; a
    script or style used by N pages; a page shared by several reports; unpublishing
    deletes the report; a rename.
  - **Conflicts:** when the saved copy changed since the tab loaded it (the BI Editor, or
    someone else), you can compare, overwrite, or load theirs.
  - **After saving:** the report's open tabs reload. After a script or style, it offers to
    reload them all.
- **History:** Fishbowl's saved versions. Compare any two, or one with the editor, and
  restore one into the editor (undoable, not saved).
- **Access…:** Fishbowl's own `BiAccessRightsPanel`, saved with `BI_REPORT_SAVE`. It warns
  before you remove your own Edit Settings (View after ADV-6032).

**Who may do what.** The server checks none of these rights on BI saves, so the editor
does, and re-checks before every save:

| Target | Editable when (admin always) |
|---|---|
| A page with reports | BI Editor-Edit **and** Edit Settings on every report that uses it (View after ADV-6032 removes Edit Settings) |
| A new page, or one with no report | BI Editor-Edit |
| A script, style or template | BI Editor-Edit |
| An image | never here |
| Report access | BI Report-Edit and Edit Settings on the report (View after ADV-6032) |
| Unpublishing | page editable, and BI Report-Delete |
| A system app (`fb-origin` system) | **never** its code, name, description, folder or Apps menus, admin included; Active, Published, gadget and access as above; Delete offers deactivation |

Opening the editor needs BI Editor-View; anyone who can open it but not edit sees the
code read-only, with the reason. A system app's banner says to duplicate it.

**System apps reach Fishbowl only through the repo.** The editor refuses to save a page
newly marked system (it offers to save it as custom), and New App and Duplicate always
make custom apps. The native BI Editor and Import don't check the tag, so the mark is a
convention the editor enforces, not a server rule.

**Removing it.** The editor is `src/main/java/com/fbi/plugins/reportbtn/editor/` (plus
`src/test/java/.../editor/`). The workspace finds it by class name
(`ReportWorkspacePlugin.loadExtension`, via the `WorkspaceExtension` interface), so:
- `./build.sh --no-editor` builds without it, the same as deleting both folders.
- `-Dreportbtn.editor=off` on the client turns it off in an existing jar.
- Without it, the Edit and New App buttons are gone, `FB_WORKSPACE.edit` is never set
  (the Launcher hides its pencil), and an `edit:` link says the editor isn't part of
  this build.

**The repo's deploy tools:** a page saved here differs from the repo copy, so
`tools/deploy/fbdeploy.js` reports it as edited in Fishbowl (`needs-confirm`) and won't
overwrite it without `--force`.

## Documents and email (PoC)

**A proof of concept, not for production.** It is all in `src/main/java/.../docs/` (with
`docs/mail/`) and `src/test/java/.../docs/`; nothing outside refers to it.
- **Leaving it out:** `./build.sh --no-docs`, the same as deleting both folders.
- **Turning it off:** `-Dreportbtn.docs=off` on the client hides its buttons and dialog.
- **Its only touches on the core:** `ReportWorkspacePlugin` loads it as a second extension,
  `WorkspaceHost.loadPage` loads a page for it, and `build.sh` copies its editor page.

**What it does**
- **Fishbowl's default documents stay Jasper.** Module Options can only store a Jasper
  report in `module.reportId`, and the stock Print and Email are untouched.
- **An app can stand in for a document.** A *document* is a row of the `module` table: the
  module's own row, plus extras such as Sales Order Invoice or Work Order Traveler.
  `docs/DocSlots` covers SO, PO, Picking, Shipping, WO, MO, TO and RMA.
- **The choice is company-wide.** It is a plugin property (`doc.<document>`) of the plugin
  `report_btn.docs`, read back by SQL so every PC sees it at once.
- **Who may set it:** admin, or Reports-Company Edit (to confirm against the native Module
  Options).
- **Print (App)** shows in a module's ribbon while one of its documents has an app. It opens
  a viewer of the open record's document with Print, Save PDF and Email.
- **Email (rich)** shows in every covered module. It attaches the app's PDF, or the Jasper
  default's (made with the module's own report viewer, as the stock Email does). It then
  opens the email window.
- **Apps (beta) › Documents…** chooses the app per document, with a Test button that opens
  the newest record. It also holds the user's own email choice.

**The page side: document output.** The plugin loads the app as the BI Reports module does
and adds `output: 'pdf'` to `FB_LAUNCH`. The page answers in `window.FB_DOC`
(`docs/launch-context.md` §6). fb-doc does this for every document built on
`FBDoc.app` or `FBDoc.Report`, so the Paperwork replicas, the iReport ports and Report
Builder reports all qualify. The PDF comes from the native panel's own Save→PDF, in a
window off the screen.

**The email window** (`docs/mail/EmailComposer`)
- **Layout:** the stock Compose Email window's: Send / Cancel / Email App toolbar, From, To,
  Cc, Bcc, Subject, the body, and Attachments at the foot. The **To:, Cc: and Bcc:** buttons
  open the client's Email Address Book (`EmailAddressBookDialog`): its first tab holds the
  record's customer (SO, RMA, SO shipment) or vendor (PO, PO shipment) email contacts, its
  Company tab the company's contacts and the active Fishbowl users with an email address.
- **The body editor is `Composer.htm` in the jar.** It keeps an HTML template's own style
  sheet and shows it as it will arrive. It has formatting, links and an HTML view.
  Deleting everything starts a plain email (the template's style sheet goes too); Ctrl+Z
  straight after brings the template back.
- **Template:** the module's email template, as the client's settings name it (SO, PO,
  Ship, else Generic), with its eight tokens filled from the record. A plain-text template
  becomes simple HTML.
- **Sending goes through the client's own helpers and settings:** SMTP, or the linked
  Google or Microsoft account.
- **The message:** `multipart/mixed` holding `alternative` (a text part, plus HTML with
  inline images), then the attachments. The style sheet is copied onto the elements
  (`CssInliner`), so Gmail and Outlook keep the look.
- **"Open in my email program"**: just this once, or always (remembered per user; it then
  skips this window). Classic Outlook gets the mail
  through COM, with HTML and attachments (its main window is opened if it wasn't running, so
  the email leaves the Outbox). New Outlook gets a `.eml` draft marked unsent, through
  `olk.exe`. Anything else gets the `.eml` draft, opened with the `.eml` program. Which
  program is the user's default email app (the mailto: handler).

**Checks:** `DocsSelfCheck` covers slots, `FB_LAUNCH` and `FB_DOC`, templates, tokens, the
inliner, the MIME tree and the `.eml` draft. The page side's desk tests are
`tools/doc-tests/Output.test.js`.

**Not tried in the client yet**
- The off-screen render and the PDF timing.
- The ribbon buttons appearing and hiding.
- The plugin-property save.
- The Jasper PDF for the extra documents (e.g. the invoice).
- The OAuth routes.
- How new Outlook and Thunderbird take a `.eml` draft.

## Build and install

```
./build.sh               # -> target/report-btn.jar   (Git Bash)
./build.sh --check       # ... and run the self-checks (core, plus the editor's over ../../scripts)
./build.sh --install     # ... replace any report-btn*.jar in C:\Program Files\Fishbowl\plugins
./build.sh --no-editor   # leave the page editor out (combines with the others)
./build.sh --no-docs     # leave the documents and email PoC out (combines with the others)
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
| `ReportWorkspacePlugin` | The visible Apps (beta) module: tabs, toolbar, `handleHyperLink`. |
| `ReportTab` | One workspace tab: a `BiBrowserPanel` and its history of report ids. |
| `WorkspaceLink` | Parses the `openModule('Apps (beta)', item)` grammar. |
| `PaintedIcon` | The drawn Back / Forward / Home / New Tab icons (Fishbowl ships none). |
| `WorkspaceExtension`, `WorkspaceHost`, `WorkspaceTab` | The seam for an optional feature: what it gets from the workspace (tabs, catalog, queries, report reloads), what the workspace asks of it (toolbar, `edit:`, `FB_WORKSPACE` flags, unsaved-work checks), and what any tab can do. |
| `editor.EditorFeature` | The page editor's entry point, found by class name. It owns the Edit, New and Import buttons, the shared Apps panel and the editor tabs. |
| `editor.EditorTab` | One page, script or style being edited: code, toolbar, selector, preview, save flow. |
| `editor.JsLexer`, `editor.JsIndex`, `editor.JsDoc` | Read a module's exports from its source, docs included, and lay out JSDoc tags. Pure; SelfCheck runs them over `scripts/*.js`. |
| `editor.ScriptService`, `ClientRights`, `AccessPolicy` | The server calls (the BI Editor's EVE methods), the signed-in user's rights, and the pure decision table. |
| `editor.InsertPanel`, `Completions`, `Inserts`, `PageIncludes`, `Bridge`, `DirectiveParser` | The selector, autocomplete, insert text, directive and token parsing, the bridge list, margin warnings. |
| `editor.PreviewPane`, `HistoryDialog`, `Diff`, `NewPageDialog`, `TemplateRewriter`, `FindBar`, `CodeArea`, `IndexCache` | Preview, saved versions, the native diff, new pages from a template, find/replace, the RSyntaxTextArea setup, the module-index cache. |
| `editor.AppExplorer`, `AppActions`, `AppGroups`, `Exporter` | The Apps panel, its multi-select actions, the tag-to-folder tables, and Download (Fishbowl JSON files). |

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

## Client test (0.4.0, Apps (beta))

Install with the client closed (`./build.sh --install`), then start it as admin.
1. **Reporting → Apps (beta)** opens with one tab: the Report Launcher (Home).
2. Click a tile. The report opens in the same tab, and the tab takes its name. Back
   returns to the launcher, and Forward goes to the report again.
3. Ctrl+click (or middle-click) a tile. It opens in a new tab. Close the tab with its ×.
4. In a workspace tab, open a report that saves with `saveReportData`. It saves without
   "Save Report Error", which shows the real report id reached the page.
5. The report's own Refresh, Parameters, Print and Save act on the report shown.
6. From the **BI Report** module, run a report that calls
   `openModule('Apps (beta)', 'tab:<id>')`. The client switches to the workspace
   and opens it there.
7. Grant `Apps (beta)-View` to a group in **User Groups**, then log in as a member
   (e.g. WSmith). The module shows. A report their groups can't open gives "doesn't
   exist, or you don't have access".

The client console logs lines prefixed `[report_btn]`.

## Client test (0.5.0, page editor)

Install with the client closed, start it as admin, and open the Apps (beta) module.
1. **0.4.0 still works** (the list above).
2. **Edit:** select a report tab and click **Edit**. The page opens in a ✎ tab, with
   syntax colours.
   - **Save:** change something, then Ctrl+S. The report's tab reloads with the change.
   - **History:** it lists the save just made.
3. **Pencils:** the Launcher's tiles have a ✎ pencil that opens the same editor.
   - As a user with BI Editor-Edit but **View** access to a report, the editor opens read
     only and says why.
   - As a user without BI Editor-Edit, there is no pencil.
4. **Inserts:** Report settings → right-click → Add setting… writes the same token as the
   BI Editor's Setting dialog. **Dashboard gadget:** tick it, save, and the app is offered
   on the home dashboard (check the BI Report module's Details tab).
5. **Selector:**
   - Inserting from *Modules in this page* writes e.g. `FBLib.Common.formatMoney(value)`.
   - A module the page doesn't include offers to add its include.
   - A duplicate include is refused.
6. **Autocomplete:** type `FBLib.Common.fo`. The list shows `formatMoney`, with its doc.
7. **Preview (F5):**
   - The unsaved page shows below the code.
   - Sandbox preview shows the native "Loading data is only available on reports"
     behaviour for a page that loads report data.
8. **Scripts:** right-click fb-lib in Includes → Open in the editor.
   - Saving asks before changing a script N pages use, then offers to reload the open
     reports.
   - `node tools/deploy/fbdeploy.js --status scripts/fb-lib.js` then shows it as edited in
     Fishbowl.
9. **Conflict:** edit the same page in the BI Editor module and save there, then save
   here. The conflict dialog offers to compare, overwrite, or load theirs.
10. **Built-in page** (e.g. Sales Dashboard): saving warns that Fishbowl keeps the original
    as `(FB) name`. Check whether its report now shows the new copy (the editor warns if
    not).
11. **Access…:** change a group, save, then check it in the BI Report module.
12. **New App:** from `BI Template`, published (and once with Dashboard gadget ticked).
    **New → Script** saves a script that the Includes list then offers.
15. **Folders:** drag Aging Report onto Inventory: its code gains the `fb-folder` tag and
    its Apps menus don't change. Module association… → tick Part: the Part module's
    Apps menu lists it, and it stays in Inventory. New folder (as a user with
    Reports-Company Edit), drop an app in it, rename it, move the app out, delete it.
    The App Library groups the same way.
16. **Apps panel:** the folders match the Launcher's groups; the filter narrows as you
    type; with three apps selected, Deactivate → all three greyed, Activate restores them.
    Access… on two apps, then check both in the BI Report module. Delete a test copy made
    with Duplicate.
17. **Import / Download:** Download a page, then Import the files in the BI Editor (and
    with Import here): the record is updated, not duplicated.
18. **Find:** Ctrl+F, type a word: matches are marked in the text and beside the scroll
    bar; Replace all, then Ctrl+Z undoes it.
19. **History → Compare** shows both versions' code side by side. It appears in the Launcher, and the new
    page's tab title drops the `*` after saving.
20. **Folder… / Apps menus… (0.5.10):** Folder… → pick Inventory (or type a new name):
    the `fb-folder` tag changes in the code, the tab gets its `*`, and the tooltip names
    the folder; Save, and the Apps panel moves the app. Apps menus… does the same for the
    module checkboxes.
21. **Reveal:** open an app from the App Library's pencil: the Apps panel opens its folder
    and selects it; switching between editor tabs follows.
22. **Preview on save:** preview an app (F5), change it, Ctrl+S: the preview reloads.
23. **System apps (0.5.11):** in the Apps panel, iReport ports and dashboards are black,
    custom apps green, inactive ones grey, unpublished ones in grey text. Open Aging Report:
    the code, name, Folder… and Apps menus… are locked and the banner says to duplicate it;
    untick Active and Save works. Duplicate… → a name: the copy opens green, editable, with
    its own `FB_REPORT.key`, and saves. Delete on a system app offers to deactivate it. Type
    the system tag into a custom app and Save: it offers to save it as custom.
24. **Published only:** unpublish a test app: it leaves the App Library and the Apps menus.
13. **Unsaved work:** closing a changed tab, closing the module, and exiting the client
    each ask to save.
14. **Without the editor:** `./build.sh --no-editor --install` gives exactly 0.4.0
    behaviour, and `edit:` links say the editor isn't part of the build.

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
- **Page editor:**
  - It saves through the same server call as the BI Editor module, so the server applies
    its own rules (built-in copies, publishing creates the report), and keeps no extra
    check of its own.
  - The per-report access level comes from the login. After someone changes a report's
    access, a user may need to log in again.
  - Server calls run on the event thread with a wait cursor, as the rest of the plugin
    does. Module indexing runs in the background.
  - The module index reads code, not running pages. Members added at run time (methods
    on objects that `Table.init()` returns) aren't listed.
