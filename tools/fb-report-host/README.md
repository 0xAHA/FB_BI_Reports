# FB Report Host

A WPF + WebView2 shell that runs a Fishbowl BI report **outside** the Fishbowl
client. Drop in a report `.htm` or a `Deployed/*.json` export and it renders,
with the Fishbowl JS bridge supplied by the host rather than by JxBrowser.

## Why it exists

Two things a browser cannot do, and this can:

1. **No same-origin problem.** The REST calls are made by `HttpClient`, not by
   the page, so no `Origin` header is sent and the browser's CORS policy never
   applies. A local web page served on any other port gets a 200 back from
   Fishbowl with *no* `Access-Control-Allow-Origin` header, so the browser
   discards the response — which is why serving a report locally has never
   worked without a proxy.
2. **`runApiRequest` actually works.** It is a raw TCP socket (port 28192,
   int32 big-endian length prefix). Page JS cannot open a socket at all, so a
   browser harness has to stub all 130 call sites. This can send them.

## Running it

```
dotnet build
dotnet run
```

Sign in, then drop a report on the window (or use **Open…**).

**The first sign-in will fail** with *"A new integrated application has been
added to Fishbowl. Please contact the Fishbowl administrator to approve this
integrated application."* That is normal: the host registers itself as an
integrated app (`FB Report Host`, appId 9317). Approve it once in Fishbowl and
sign in again.

## What it does on load

* Unwraps a `Deployed/*-Page.json` envelope (`[ { name, description, data } ]`).
* Expands the shared-asset directives from `scripts/fb-lib.js` and
  `scripts/fb-styles.css`, found by walking up from the report until a folder
  containing `scripts/fb-lib.js` appears.
* Replaces **every** occurrence of a directive, exactly as the server does — so
  a report that mentions the placeholder twice fails here the same way it fails
  on deployment, rather than looking fine until it ships.
* Injects the bridge before any report script runs, because every report opens
  with a guard that rewrites `document.body` when `runQuery` is missing.


## The library

Imported reports live in an ordinary folder tree under
`%LOCALAPPDATA%FbReportHostLibrary`. Deliberately plain folders and files
rather than a database - rearrange it in Explorer, sync it, or hand a folder to
a colleague and the app picks the change up on **Refresh**.

* **Import…** or drag-and-drop **copies** the file in; the original is never
  touched, so importing out of the git working tree is safe.
* Dropping a **folder** brings in the reports one level deep.
* Importing the same name twice renames rather than overwrites
  (`Product_Card (2).htm`).
* **Open (no import)** runs a file where it sits, for a quick look.
* Right-click the tree for new folder / rename / delete / open in a new window.


## Shared assets (fb-lib / fb-styles)

A report does not contain the shared code — it contains a **directive**, and the
Fishbowl server substitutes it at save time. Outside Fishbowl this host has to
supply it, or the report hits its own "fb-lib not loaded" guard.

Resolution order, per report:

1. the `scripts/` folder of a repo **above the report** — so a report opened in
   place picks up the working-tree copy you are editing;
2. the library's **`_shared`** folder — the only option for a report that has
   been *copied into the library*, which has no repo above it.

On first run the host seeds `_shared` from the checkout it is running inside, so
normally there is nothing to do. Otherwise click **Shared assets…** and pick your
`FB_BI_Reports\scripts` folder (the repo root works too). The toolbar shows
`shared assets ✓`, or names what is missing; importing reloads any open tabs.

`_shared` is hidden from the tree — it is plumbing, not content. Re-import after
changing `fb-lib.js` in the repo: the copy is a cache, not a live link.

## Windows and tabs

* Reports open as **tabs** in the main window; each tab has a close button, and
  opening a report that is already open focuses its tab instead of duplicating it.
* **Pop out** moves a report into its own window, so several can be watched at
  once. Every window shares the one signed-in session.
* The **Library** pane and the **Log** pane both toggle from the toolbar. The log
  starts hidden.

Each tab gets its own bridge instance, so `loadReportData`/`saveReportData` are
scoped per report rather than shared across whatever happens to be open.

## The bridge

| Implemented | Backed by |
|---|---|
| `runQuery`, `runQueryAsync` | `GET /api/data-query` |
| `runRestApiAsync` | passthrough to `HttpClient` |
| `runApiRequest` | legacy TCP socket, port 28192 |
| `getUser`, `hasUserAccess` | the login response's `moduleAccessList` |
| `getLocationGroupList`, `getProperty`, `currencyLocale`, `getCompanyAddress` | SQL |
| `saveSettings` / `loadSettings`, `saveReportData` / `loadReportData` | a local JSON file, so a harness run never writes to `userproperties` |
| `formatCurrency`, `roundMoney` | local |

`openModule` is logged and shown in the status bar — there is no way to drive
the desktop client's navigation from outside it.

`getAutoPo`, `getAutoMo`, `getIcon`, `getImageFile`, `getAllTrackingInfo`,
`getParentName`, `getHighValueReport` and `runPickStatusHelper` **throw** with
the reason. They run Fishbowl's own engines or read server-local files and have
no REST equivalent; returning an empty array would read as a legitimate
"nothing found".

## Fidelity warning

The Fishbowl client runs **JxBrowser 8.12.2** (an older Chromium). This host
uses whatever WebView2 runtime is installed — currently **153**. Anything that
works here may still fail in the client. If this becomes the primary
development surface, pin a fixed-version WebView2 distribution close to the
client's Chromium instead of using the evergreen runtime.

## Self-test

Exercises the loader and every bridge method against a live server, compiling
the shipping sources rather than copies:

```
dotnet run --project selftest -- http://localhost:2456 <user> <password>
```

Add an already-approved `<appName> <appId>` as the 4th and 5th arguments to
test before the host's own app registration is approved.
