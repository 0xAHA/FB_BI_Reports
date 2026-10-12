# BI report navigation in the client: native change spec

**For:** Fishbowl client developers.
**Status:** proposal. A working plugin version of every behaviour here is the
**Report Workspace** in [`../report_btn`](../report_btn/README.md) (0.4.0).
**Basis:** the 26.9.1 client jars (`fbswing`, `client`, `jxbrowser` 8.12.2), read on 2026-10-12.

## The problem

A BI report can't open another BI report.
- `openModule('BI Report', id)` is accepted. But `BiReportModuleClient` inherits the
  empty `ClientModuleImpl.handleHyperLink(String)`, so the call only switches modules.
- The BI Report module also holds one report at a time (one `pnlBrowser`).
- There's no way back to the previous report.

So a report launcher, a dashboard that drills into a detail report, or a "related
reports" link has nowhere to send the user.

## How `openModule` works today

`BiBrowser` (fbswing, `com.evnt.client.modules.biscripteditor.panel`) registers the
bridge with `window.putProperty(name, JsFunctionCallback)` in an `InjectJsCallback`.
Its `openModule(name, item)` callback runs:

```java
clientModule.showModule(name);                    // exact repository lookup; selects the module tab
clientModule.getModule(name).handleHyperLink(item);
```

`"Work Order"` is the only special case. An unknown name shows an "Invalid Module" dialog.

## Change 1: open a report by link (the smallest useful change)

Override `handleHyperLink` in `BiReportModuleClient`:

```java
@Override
public void handleHyperLink(String item) {
    int id = resolveReportId(item);   // numeric id, else exact bireport.name
    if (id > 0 && userCanOpen(id)) {  // the bireportaccess rule the search list applies
        loadData(id, true);           // checkForSave() then loadData(id): the existing open path
    }
}
```

- This alone makes `openModule('BI Report', id)` work from every report, dashboard and
  gadget, with no new JavaScript API.
- **Accept the record name as well as the id.** Ids differ between databases, and the
  name is what an import keys on, so links by name survive a move.
- **Run it on the event thread.** The bridge callback calls it from the page's own JS
  call, so reloading the panel synchronously from inside it is unsafe:
  `SwingUtilities.invokeLater`.

## Change 2: tabs in the BI Report module

- Replace the single `pnlBrowser` in `pnlContent` with a closeable `FBTabbedPane` of
  `BiBrowserPanel`s. `BiEditorModuleClient` already does this:
  `setShowCloseButtonOnTab(true)`, `setCloseTabOnMouseMiddleButton(true)`, and
  `setCloseAction(...)`, whose event source is the tab component.
- `loadData(id)` opens in the selected tab. Selecting a report in the search list keeps
  today's behaviour.
- Add an "Open in new tab" action to the search list's context menu. In the link
  grammar, a `tab:` prefix (`openModule('BI Report', 'tab:123')`) opens a new tab.
- Close each panel with `BiBrowserPanel.dispose()` when its tab closes, because every
  panel owns a Chromium browser.
- Pop-out keeps working per tab: it already moves a `BiBrowserPanel` into a `JFrame`.

## Change 3: Back, Forward and Home

- Add Back, Forward and Home buttons to `BiBrowserPanel.pnlButtons`, next to Refresh.
- **Keep the history as a list of report ids per panel, and reload through the normal
  path on each step. Don't use Chromium's history.** `BiBrowserPanel` (`reportId`,
  `reportName`, `originalHtml`, `saveParamList`) and `BiBrowser.biReportId` hold only the
  report given to the last `loadHTML`. After `Navigation.goBack()`:
  - Chromium would show the older page;
  - `saveReportData` and `loadReportData` would still use the newer report's id;
  - Refresh, Parameters, Print and Save would act on the newer report.

  Chromium's history is also full of the blank pages `clear()` loads between reports.
- **Home** is a company setting naming a BI report, for example a launcher. Hide the
  button when it isn't set.
- Expose the state to the page, so a report can draw its own Back link:
  `window.FB_NAV = {canBack, canForward}`, set with the other bridge properties.

## Optional: a dedicated bridge function

`openModule('BI Report', …)` is enough. A clearer API for report authors would be one
more `add…` in `BiBrowser`'s `InjectJsCallback`, plus a `JsFunctionConst` entry so the
BI Script Editor documents it:

```js
openReport(idOrName, { newTab: false })   // returns false when not found / no access
```

## Leave popups alone

Fishbowl sets no `CreatePopupCallback` or `OpenPopupCallback`, so `window.open` gets
JxBrowser's default: a new `JFrame` with its own `BrowserView`.
- Reports rely on this to print: they write a clean document into a popup, because
  `window.print()` on the report page is unreliable.
- That popup probably lacks the bridge functions, because `InjectJsCallback` is set on
  the report's browser only.
- Don't route popups into tabs.

## Access

Apply the rule the BI Report search list applies:
- a report is open to users in a group with a `bireportaccess` row for it;
- admin opens everything;
- a report with no rows is admin-only.

A link to a report the user can't open should say so, not fail silently.

## How the plugin maps to this

| Native change | Plugin equivalent (report_btn 0.4.0) |
|---|---|
| `BiReportModuleClient.handleHyperLink` | `ReportWorkspacePlugin.handleHyperLink` + `WorkspaceLink` |
| Tabs in the BI module | The Report Workspace module's `FBTabbedPane` of `ReportTab`s |
| Back / Forward / Home | The workspace toolbar; `ReportTab` keeps the id history |
| Load path | `ReportLoader`: `BI_REPORT_LOAD`, `REPLACE_INCLUDES_BI_SCRIPT`, saved params |
| `window.FB_NAV` | `window.FB_WORKSPACE`, inserted into the page before `loadHTML` |

The plugin has to use its own module, because a plugin can't change
`BiReportModuleClient`. That is the only real difference.
