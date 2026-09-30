// Regenerates Deployed/ — the JSON-wrapped, importable form of every source
// file in this repo.
//
//   *.htm            -> type "Page"
//   scripts/*.js     -> type "Script"
//   scripts/*.css    -> type "Style"
//
// The wrapper format is byte-identical to what the Fishbowl client exports
// (see fbwrap.js), so a generated file diffs cleanly against a fresh export.
//
// NAMES ARE LOAD-BEARING. Fishbowl keys an import on the page NAME, so a name
// that matches an existing page UPDATES it and a name that doesn't CREATES a
// duplicate. Names therefore come, in order of preference:
//   1. DEPLOYED_NAMES below — recovered from the real exports in Documents/BI
//      by matching the banner PATH line, then the <title>. These are the
//      authoritative live names and must not be "tidied".
//   2. the file's own <title>, with the " - Fishbowl BI" style suffix trimmed
//   3. the filename stem
// Anything resolved by 2 or 3 will CREATE a new page on import; the manifest
// marks those so it is never a surprise.
//
// OneDrive "-DESKTOP-<host>" conflict copies are skipped outright — deploying
// one would push a stale side-copy over a live page.
const fs = require('fs');
const path = require('path');
const W = require('./fbwrap.js');

// Default to the repo root (two levels up from tools/deploy), so the usual
// invocation is just `node tools/deploy/build-deployed.js`.
const REPO = process.argv[2] || path.resolve(__dirname, '..', '..');
const OUT = path.join(REPO, 'Deployed');

/* Recovered from Documents/BI. Left as an explicit table rather than
   re-derived at runtime: the reference exports are not part of this repo, so
   the mapping has to survive without them. */
const DEPLOYED_NAMES = {
  'Audit/Audit_Trail.htm':                                 ['Audit Trail', 'Audit Trail'],
  // Client-specific pair: the entry screen captures the pricing rule into an
  // soitem custom field, the report reads it back. New records on first import.
  'Custom/Babor/Babor_SO_Entry.htm':                       ['- Sales - Babor SO Entry', '- Sales - Babor SO Entry'],
  'Custom/Babor/Babor_Pricing_Rule_Sales.htm':             ['- Sales - Babor Sales by Pricing Rule', '- Sales - Babor Sales by Pricing Rule'],
  // Bright Steel: they sell by the kilo but are ordered by the bar. The
  // quoting screen and the replacement for the hand-written product card.
  // New records on first import.
  'Custom/BrightSteel/Bars_To_Kilos.htm':                  ['- Sales - Bright Steel Bars to Kilos', '- Sales - Bright Steel Bars to Kilos'],
  'Custom/BrightSteel/Product_Card.htm':                   ['- Part - Bright Steel Product Card', '- Part - Bright Steel Product Card'],
  'Dashboards/Dashboard_Combined.htm':                     ['Dashboard - Company', 'Dashboard - Company'],
  'Dashboards/Individual Pages/Items_To_Be_Picked.htm':    ['Dashboard - Tiles - Items to be Picked', 'Dashboard - Tiles - Items to be Picked'],
  'Dashboards/Individual Pages/Items_To_Be_Received.htm':  ['Dashboard - Tiles - Items to be Received', 'Dashboard - Tiles - Items to be Received'],
  'Dashboards/Individual Pages/Items_To_Be_Shipped.htm':   ['Dashboard - Tiles - Items to be Shipped', 'Dashboard - Tiles - Items to be Shipped'],
  'Dashboards/Individual Pages/Open_Purchase_Orders.htm':  ['- Open Purchase Orders', '- Open Purchase Orders'],
  'Dashboards/Individual Pages/Open_RMA_Orders.htm':       ['- Open RMA Orders', '- Open RMA Orders'],
  'Dashboards/Individual Pages/Open_Sales_Orders.htm':     ['- Open Sales Orders', '- Open Sales Orders'],
  'Dashboards/Individual Pages/Open_Transfer_Orders.htm':  ['- Open Transfer Orders', '- Open Transfer Orders'],
  'Dashboards/Individual Pages/Open_Work_Orders.htm':      ['- Open Work Orders', '- Open Work Orders'],
  'Dashboards/Inventory_Dashboard_v1.2.htm':               ['- Dashboards - Inventory v1.2', '- Dashboards - Inventory v1.2'],
  'Dashboards/Purchasing_Dashboard_v1.2.htm':              ['- Dashboard - Purchasing v1.2', '- Dashboard - Purchasing v1.2'],
  'Dashboards/Sales_Dashboard_v1.2.htm':                   ['- Dashboard - Sales v1.2', '- Dashboard - Sales v1.2'],
  'Inventory/Auto_PO_Inventory_Watchlist.htm':             ['- Auto PO', '- Auto PO'],
  'Inventory/HistoricalInventoryValuation.htm':            ['- Inventory - Inventory Valuation by Date', '- Inventory - Inventory Valuation by Date'],
  'Inventory/InventoryAvailability.htm':                   ['- Inventory - Inventory Availability', '- Inventory - Inventory Availability'],
  'Inventory/Inv_Reorder_Watchlist.htm':                   ['- Inventory - Inventory Reorder Monitor', '- Inventory - Inventory Reorder Monitor'],
  'Manufacturing/Production_Scheduling_v1.2.htm':          ['- Manufacturing - Production Scheduling w AI', '- Manufacturing - Production Scheduling w AI'],
  'Part/PartActivity.htm':                                 ['- Part - Part Activity', '- Part - Part Activity'],
  'PurchaseOrder/PurchaseOrderSummary.htm':                ['- Purchasing - Purchase Order Summary', '- Purchasing - Purchase Order Summary'],
  'PurchaseOrder/receivingsummary.htm':                    ['- Purchasing - Receiving Summary', '- Purchasing - Receiving Summary'],
  // AMBIGUOUS — the deployed "QuickOrder V2" matched QuickOrder.htm far more
  // closely than QuickOrder_v1.2.htm (31% of sampled blocks vs 3%), but
  // neither is a clean match because a deployed page has its {% Script %}
  // directives expanded inline. Confirm before importing this one.
  'SalesOrder/QuickOrder.htm':                             ['- Sales - QuickOrder V2', '- Sales - QuickOrder V2'],
  'SalesOrder/SalesOrderSummary.htm':                      ['- Sales - Sales Order Summary', '- Sales - Sales Order Summary'],
  'Template/Core_Dashboard_Template.htm':                  ['- System - BI Template', '- System - BI Template'],
  // Shared assets — names must match exactly or the {% Script %} /
  // {% Style %} directives in every report stop resolving.
  'scripts/fb-lib.js':    ['fb-lib',    'Library of common javascript helpers for BI reports'],
  // Description is literally "fb-mfg" on the live record — matched exactly
  // rather than improved, so the export stays a clean diff against Fishbowl's.
  'scripts/fb-mfg.js':    ['fb-mfg',    'fb-mfg'],
  'scripts/fb-styles.css':['fb-styles', 'Common CSS Styling for use in BI Reports'],
};

function walk(dir, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['.git', 'node_modules', 'Deployed'].indexOf(e.name) === -1) walk(p, out);
    } else out.push(p);
  });
  return out;
}

function typeFor(rel) {
  const l = rel.toLowerCase();
  // .htm only, deliberately — the few .html files in the tree are web-package
  // assets (a Cloudflare page bundle, a folder copy), not BI reports, and they
  // collide with the real report of the same title.
  if (l.endsWith('.htm')) return 'Page';
  if (l.startsWith('scripts/') && l.endsWith('.js')) return 'Script';
  if (l.startsWith('scripts/') && l.endsWith('.css')) return 'Style';
  return null;
}

/* A few files in this repo were at some point saved as Windows-1252 and are
   now valid UTF-8 encoding the WRONG characters ("â€”" where an em dash
   belongs). The payload is left exactly as found — faithfully reproducing the
   source is the job, and silently rewriting a report's bytes is not — but the
   damage must not leak into a Fishbowl RECORD NAME, so repair it here only. */
const MOJIBAKE = [
  [/â€”/g, '—'], [/â€“/g, '–'], [/â€˜/g, '‘'], [/â€™/g, '’'],
  [/â€œ/g, '“'], [/â€/g, '”'], [/â€¦/g, '…'], [/Â/g, '']
];
function demojibake(s) {
  MOJIBAKE.forEach(function (p) { s = s.replace(p[0], p[1]); });
  return s;
}

/* Fall-back name: the <title>, minus the house suffix, else the file stem. */
function deriveName(rel, text) {
  const m = text.match(/<title>([^<]*)<\/title>/i);
  let t = m ? demojibake(m[1]).trim() : '';
  t = t.replace(/\s*[-—–]\s*Fishbowl\s+(BI|Advanced)\s*$/i, '').trim();
  // Some titles are "Name — what it does". A record name wants the name; the
  // explanation only makes the picker harder to scan. Trim at the separator
  // once the title is long enough that it is clearly carrying both.
  if (t.length > 40) {
    const cut = t.split(/\s+[—–]\s+| - /)[0].trim();
    if (cut.length >= 8) t = cut;
  }
  if (!t || /^report title$/i.test(t)) t = path.basename(rel).replace(/\.[^.]+$/, '');
  // A page name is a Fishbowl record name and becomes a filename; keep it to
  // characters that survive both.
  return t.replace(/[\\/:*?"<>|]/g, '-').trim();
}

const files = walk(REPO)
  .map(p => ({ abs: p, rel: path.relative(REPO, p).replace(/\\/g, '/') }))
  .filter(f => typeFor(f.rel))
  .filter(f => !/-DESKTOP-[A-Z0-9]+(-\d+)?\./i.test(f.rel))
  .sort((a, b) => a.rel.localeCompare(b.rel));

// INCREMENTAL. Every source is still wrapped on each run — that is cheap, and
// it is the only way to know what actually changed — but a file is only
// WRITTEN when its bytes differ from what is already on disk. So a run after a
// single report edit touches exactly one file, and the other 79 keep their
// timestamps, stay out of the git diff, and don't churn OneDrive.
//
// Comparison is on CONTENT, never mtime: OneDrive rewrites timestamps on sync,
// so mtime would report phantom changes and, worse, miss real ones.
//
// Orphans are still pruned at the end, so a renamed or deleted source cannot
// leave a stale export behind — that guarantee is what the old wipe-and-rebuild
// bought, and it is kept here without the churn.
fs.mkdirSync(OUT, { recursive: true });

const manifest = [];
const seen = new Map();
const written = [], unchanged = [];
files.forEach(f => {
  const type = typeFor(f.rel);
  const text = fs.readFileSync(f.abs, 'utf8');
  // A report's own identity block (FB_REPORT.name) is the record name when it
  // sets one — the same name publish.js matches on — ahead of the table below.
  const own = require('./publish.js').identityOf(f.abs);
  const known = own && own.type === 'Page' ? [own.name, (DEPLOYED_NAMES[f.rel] || [])[1] || own.name] : DEPLOYED_NAMES[f.rel];
  const name = known ? known[0] : deriveName(f.rel, text);
  const desc = known ? known[1] : name;

  // Two sources mapping to one Fishbowl name would have one silently
  // overwrite the other on import. Several archived copies legitimately share
  // a <title> with their live sibling, so disambiguate rather than drop the
  // file: fall back to the filename stem, then to "folder / stem". A RECOVERED
  // name is never rewritten — it is the live record's actual name, so a clash
  // there is a real conflict and is refused instead.
  let finalName = name, note = '';
  if (seen.has(finalName + '|' + type)) {
    if (known) {
      console.log('  !! NAME CLASH on a RECOVERED name  "' + finalName + '"  ' +
                  seen.get(finalName + '|' + type) + '  vs  ' + f.rel + '   — SKIPPED');
      manifest.push({ source: f.rel, status: 'skipped-name-clash', name: finalName, type: type });
      return;
    }
    const stem = path.basename(f.rel).replace(/\.[^.]+$/, '');
    finalName = stem;
    if (seen.has(finalName + '|' + type)) {
      finalName = path.dirname(f.rel).split('/').pop() + ' - ' + stem;
    }
    finalName = finalName.replace(/[\\/:*?"<>|]/g, '-').trim();
    note = 'renamed from "' + name + '" to avoid a clash';
  }
  seen.set(finalName + '|' + type, f.rel);

  // FLAT — every export sits directly in Deployed/, matching how the Fishbowl
  // client itself exports (one folder of "<name>-<type>.json"). That also
  // makes the folder a drop-in match for a client export directory, so the two
  // can be diffed against each other without reorganising either. The name
  // clash guard above is what keeps this safe: name+type is unique, so the
  // filename is too. manifest.json carries the source path for each file.
  const outRel = W.fileNameFor(finalName, type);
  const outAbs = path.join(OUT, outRel);
  const next = W.wrap(finalName, desc, text, type);

  // Only touch the file when its bytes actually differ.
  let prev = null;
  try { prev = fs.readFileSync(outAbs, 'utf8'); } catch (_) {}
  if (prev !== next) {
    fs.writeFileSync(outAbs, next, 'utf8');
    written.push({ rel: outRel, src: f.rel, isNew: prev === null });
  } else {
    unchanged.push(outRel);
  }

  manifest.push({
    source: f.rel, deployed: outRel.replace(/\\/g, '/'), name: finalName, type: type,
    status: known ? 'updates-existing' : 'creates-new',
    note: note || undefined,
    bytes: Buffer.byteLength(next, 'utf8')
  });
});

// Prune exports whose source is gone or renamed. README.md is hand-written and
// manifest.json is rewritten below, so both are kept.
const expected = new Set(manifest.filter(m => m.deployed).map(m => m.deployed));
const orphans = fs.readdirSync(OUT)
  .filter(f => f !== 'README.md' && f !== 'manifest.json' && !expected.has(f));
orphans.forEach(f => fs.rmSync(path.join(OUT, f), { force: true }));

// The manifest carries a `generated` timestamp, so writing it unconditionally
// would make it the one file that shows as modified on every single run. Keep
// the old timestamp when the entries themselves are unchanged.
const manPath = path.join(OUT, 'manifest.json');
let prevMan = null;
try { prevMan = JSON.parse(fs.readFileSync(manPath, 'utf8')); } catch (_) {}
const entriesSame = prevMan &&
  JSON.stringify(prevMan.entries) === JSON.stringify(manifest);
if (!entriesSame) {
  fs.writeFileSync(manPath, JSON.stringify({
    generated: new Date().toISOString(), count: manifest.length, entries: manifest
  }, null, 2) + '\n', 'utf8');
}

const upd  = manifest.filter(m => m.status === 'updates-existing').length;
const neu  = manifest.filter(m => m.status === 'creates-new').length;
const skip = manifest.filter(m => m.status === 'skipped-name-clash').length;
const added = written.filter(w => w.isNew).length;

if (!written.length && !orphans.length && entriesSame) {
  console.log('\n  Deployed/ already up to date — ' + unchanged.length + ' file(s), nothing written.');
} else {
  console.log('\n  Deployed/ updated:');
  written.forEach(w => console.log('    ' + (w.isNew ? '+ new    ' : '~ changed') + '  ' +
                                   w.rel + '   <- ' + w.src));
  orphans.forEach(f => console.log('    - removed  ' + f + '   (source gone or renamed)'));
  if (!entriesSame && !written.length && !orphans.length) console.log('    ~ changed  manifest.json');
  console.log('    ' + unchanged.length + ' unchanged, left alone');
}
console.log('\n  ' + (manifest.length - skip) + ' export(s) tracked' +
            (added ? ', ' + added + ' new this run' : ''));
console.log('    ' + upd + ' update an existing Fishbowl record (name recovered from a real export)');
console.log('    ' + neu + ' would CREATE a new record (name derived from <title>/filename)');
if (skip) console.log('    ' + skip + ' skipped on a name clash');
