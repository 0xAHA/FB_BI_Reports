# Fishbowl API Tool (WPF)

A native port of `Fishbowl_Advanced_API_Tool.htm`, with the built-in guide and a
catalog that can update itself from a server's own documentation.

```
dotnet build   FbApiTool.csproj
dotnet run  --project selftest -- [server] [user] [password]
```

## Why a native port

The HTML tool has to make its calls with browser `fetch`. Fishbowl answers a
cross-origin request with a 200 and **no** `Access-Control-Allow-Origin` header,
so a page served from anywhere other than the Fishbowl server itself is blocked
from reading any response — the request succeeds and the tool sees nothing.
`HttpClient` sends no `Origin` header at all, so that whole class of failure
disappears. Self-signed certificates are accepted for the same practical reason.

## The catalog is the program

Nothing about an endpoint is compiled in. `assets/catalog.json` holds all 107
endpoints — verb, path, path parameters, query parameters, documented body
fields and an editable body template — and the sidebar, the request form, the
schema table and the body editor are all generated from it.

That is what makes the update feature possible rather than a rewrite: a newer
server's endpoint is a new record, not new code.

| File | What it does |
|---|---|
| `ApiCatalog.cs` | The model, and shipped-vs-updated file resolution |
| `ApiDocsImport.cs` | Reads `/apidocs.json` into a catalog |
| `CatalogDiff.cs` | Works out and applies what would change |
| `ApiRunner.cs` | Sends the request, shapes the response |

The shipped catalog was lifted from the HTML tool's `EPS` array, so nothing
curated was lost in the port.

## Updating from `/apidocs.json`

`/apidocs.json` is served unauthenticated, so the version can be checked before
sign-in. It is **not** OpenAPI — it is `{ version, sections[] }`, where each
endpoint carries `endpoint.verb`, `endpoint.path`, `queryParameters[]` and a
nested `attributes[]` field tree. Everything the request form needs is in there.

The tool checks quietly at start-up and reports in the status bar; **Check for
updates** opens the review dialog, which lists every proposed change with its
own checkbox. Applying writes `%LOCALAPPDATA%\FbApiTool\catalog.json`; **Reset
to the shipped catalog** deletes it.

### Rules the diff follows

These are not arbitrary — each one was forced by what a real 26.9 server
publishes, and each is covered by the self-test.

- **`endpoint.path` wins over `requestObject.title.endpointUrl`.** 26.9
  publishes *Update a manufacture order* with an `endpointUrl` of
  `/api/manufacture-orders`, dropping the `/{id}`. Trusting it collided Update
  with Create and silently overwrote Create's entry.
- **`<OBJECT ENDPOINT>` is expanded.** Memo endpoints are published once against
  a placeholder. Taken literally they are unusable and report as missing forever;
  they are expanded to the four order types that accept memos.
- **Prose is never touched.** Against a same-version server, wording alone
  accounted for 44 of 44 reported changes, every one a paraphrase — and the
  catalog's versions carry facts the published text does not (that
  `next-number` 404s on servers older than 26.7, for one). 26.9 even publishes a
  mojibake em dash. Only shape is diffed: parameters, fields, body templates.
  A blank description is still filled in, since that is a gap rather than a
  choice.
- **Nothing is removed automatically.** An endpoint the server does not document
  is usually a curated addition or an older server, not a retirement. Those
  arrive unticked and need a second confirmation.

### Is generated scaffolding actually usable?

Yes, and the self-test proves it rather than assuming it: it generates the body
template for *Add Inventory* from the server's field tree and asserts it is
identical to the one a person hand-wrote into the catalog, field paths included.

## The request pane

Each endpoint opens in its **own tab**, styled like the report host’s. Looking
up a part id half way through composing a sales order used to throw the order
away; now it does not.

Inside a tab everything is on one surface, as in the web tool — parameters at
the top, then the body editor and the documented field list **side by side**,
then the response under a splitter. Composing a body while reading which
fields are required is the main thing anyone does here, and splitting the two
across tabs turned it into a memory exercise.

**Enter sends**, from any single-line field. Inside the payload editors Enter
means a new line — losing a half-typed body to a stray keystroke is worse than
the convenience is worth — so use Ctrl+Enter there.

### The Import pane

`/api/import/{name}` is one endpoint covering 67 different record layouts, so
it gets its own pane rather than a JSON body:

- the type picker is filled from the catalog’s 67 authoritative names, each
  labelled with the directions the server supports;
- picking one calls `/api/export/{name}/header` and lays out a template row.
  The layouts are documented; what the live call adds is **this instance** — the
  header row comes back carrying the custom fields this database actually has,
  in its column order, so it is what this server will accept rather than what
  the general documentation describes. `Add-Inventory` takes its headers from
  `Inventory-Quantities`; without that alias the pre-fill silently 404s;
- a CSV / JSON toggle **converts** what is already typed rather than discarding
  it, and sets the right Content-Type (`text/plain` vs `application/json`);
- files can be dropped anywhere on the pane. The format is decided by content,
  not by extension — plenty of .txt files hold JSON, and guessing wrong sends
  the wrong Content-Type.

The JSON form is a 2-D array whose first row is the headers, **not** an array of
objects. Sending objects is the usual first mistake; pasting them anyway is
converted rather than refused.

## Styling

`App.xaml` carries the `scripts/fb-styles.css` tokens under the same names, so
this tool, the report host and the reports cannot drift apart. Fonts follow the
same stacks (Inter, then Segoe UI). Verb pills use the brand’s semantic
colours rather than an invented palette — blue for a read, success green for a
write, negative red for a delete — and the response grids get real header
cells: bold, filled, ruled off from the data.

Every interactive control is templated. Left to the Fluent theme they come out
in near-identical greys with no brand colour at all.

## Documentation tab

Two documents, switched at the top of the tab and deliberately kept apart:

| Document | What it covers |
|---|---|
| **Using this tool** (`assets/tool-guide.html`) | Driving this window. Owned here; edit freely. |
| **Fishbowl API guide** (`assets/guide.html`) | Building an integration on the API. A verbatim copy of `Fishbowl_API_App_Guide.htm` — never add to it, or the additions vanish the next time that file is refreshed. |

*Building an App on the Fishbowl API*, rendered in WebView2. The browser is
created the first time the tab is opened — it costs a process, and plenty of
sessions never look at it.

It is **both** embedded in the executable and written to `assets/guide.html`
beside it, and the same goes for the catalog. The folder copy is what gets read,
so the catalog stays readable, diffable and hand-editable; the embedded copy is
the safety net, so an `FbApiTool.exe` someone copied on its own still starts and
still has its documentation.

## Connecting

Sign in normally, or paste a bearer token. Pasting is not a shortcut: it is how
you reproduce a failing call with the **same** session an integration used,
which is usually the only way to tell an access-right problem from a payload
problem. A pasted token is verified before it is accepted, never written to
disk, and disconnecting drops it without logging that session out.

`FishbowlClient.cs` is shared with `fb-report-host` rather than forked — the
MFA-as-a-401-header and app-approval rules are easy to get subtly wrong and must
not drift between the two tools.
