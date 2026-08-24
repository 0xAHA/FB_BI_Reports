/* ============================================================================
 * Fishbowl demo-data generator  (additive to demodb — the "WX-" widget family)
 * ----------------------------------------------------------------------------
 * Emits the CSV import files that layer ~113 new parts + ~60 multi-level BOMs +
 * reorder points + starting inventory + open SOs/POs onto the existing demodb,
 * engineered so Production_Scheduling_v1.2 has real signals (shortages,
 * contested stock, staged producer→consumer chains, overdue supply, capacity
 * load). Node only (run: `node generate.js`) — no deps.
 *
 * WHY A GENERATOR: when a client validation flags a wrong import header, fix the
 * column list in one place here and re-run — every row re-emits to spec. The raw
 * entity data is also dumped to _reference.json so a format change never means
 * re-deriving the data.
 *
 * FORMAT CONFIDENCE (see README):
 *   CONFIRMED (matched against repo tools + demodb):
 *     - PPVP  (Import_Builder.htm SCHEMAS registry)
 *     - ImportAddInventory (Inventory_Adjustment_Helper.htm)
 *     - ImportSalesOrder   (QuickOrder_v1.2.htm — two-header layout)
 *   BEST-EFFORT (verify the header in your client's Import wizard first):
 *     - BOM import
 *     - Reorder-point import
 *     - Purchase-order import   (repo prefers REST; CSV header unverified)
 * ============================================================================ */

'use strict';
const fs = require('fs');
const path = require('path');

// Anchor "today" so the dataset is reproducible + relative to the current demo.
const TODAY = '2026-08-24';
// Fishbowl parses import dates in the install's DateFormatShort. demodb is AU;
// if your install uses a different short format, change this ONE constant.
const DATE_FMT = 'dd/MM/yyyy';

// ── date helpers ────────────────────────────────────────────────────────────
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function fmtDate(iso) {
    const [y, m, d] = iso.split('-');
    if (DATE_FMT === 'yyyy-MM-dd') return iso;
    if (DATE_FMT === 'MM/dd/yyyy') return `${m}/${d}/${y}`;
    return `${d}/${m}/${y}`;   // dd/MM/yyyy (AU default)
}
// ── csv helpers ─────────────────────────────────────────────────────────────
function csvField(v) { if (v == null) v = ''; v = String(v); return '"' + v.replace(/"/g, '""') + '"'; }
function csvRow(arr) { return arr.map(csvField).join(','); }
function writeCsv(name, headerRows, dataRows) {
    const lines = [].concat(headerRows.map(csvRow), dataRows.map(csvRow));
    fs.writeFileSync(path.join(__dirname, name), lines.join('\r\n') + '\r\n', 'utf8');
    console.log(`  ${name}: ${dataRows.length} data row(s)`);
}

// ── existing-demodb references (must already exist — additive import) ─────────
const VENDORS = ['A&B Distribution', 'Johnson Manufacturing', "Kevin's Cables",
    'Cyclery Connection', 'Simpson Cyclery', 'Monroe Bike Company',
    'Rocky Mountain Bikes', "Chuck's Chain Shop"];
const CUSTOMERS = ['Bike World', 'Pro Bike', 'Speed Way Bikes', 'Cityscape Bikes',
    'DIYBike Co.', 'National Bicycle Club', 'Timeless Bicycles', "Big Al's Bike Shop",
    'Magic Mountain Biking', 'Peak Mountaineer'];
// LGs used for the demo + their primary pickable stock location (real names).
const LGS = [
    { name: 'QLD Stock', loc: 'R1A2' },
    { name: 'Sydney',    loc: 'Bike Storage' },
    { name: 'Melbourne', loc: 'Stock Room' },
];
const PURCHASE_TAX = 'NCG';   // part-level (purchase) tax code, APAC
const SALES_TAX    = 'GST';   // product-level (sales) tax code, APAC
// Tax-RATE names (taxrate.name) for the order headers/lines. These differ from
// the part/product tax CODES above. Verified against demodb: 'GST' = taxrate
// id 2 (orderTypeId 20, sales); 'NCG' = taxrate id 4 (orderTypeId 10, purchase).
const SALES_TAX_NAME    = 'GST';
const PURCHASE_TAX_NAME = 'NCG';
const LABOUR = ['WX-LAB-FAB', 'WX-LAB-ASSY', 'WX-LAB-TEST'];

// Real customer ship/bill addresses pulled from demodb (address ⋈ customer via
// accountId). Every customer here EXISTS in demodb — this is additive-only.
const AU = 'Australia';
const CUST_ADDR = {
    'Bike World':            { addr: 'Racer Way St',            city: 'Burwood',         state: 'NSW', zip: '2984' },
    'Pro Bike':              { addr: '145 Twindle Road',        city: 'Toorak',          state: 'NSW', zip: '2980' },
    'Speed Way Bikes':       { addr: '1427 Westminster',        city: 'Dandenong',       state: 'VIC', zip: '3255' },
    'Cityscape Bikes':       { addr: '1000 Time Square',        city: 'Vermont',         state: 'VIC', zip: '3687' },
    'DIYBike Co.':           { addr: '123 Glacier Mountain',    city: 'South Dandenong', state: 'VIC', zip: '3125' },
    'National Bicycle Club': { addr: '99 Community Circle',     city: 'Torquay',         state: 'VIC', zip: '3588' },
    'Timeless Bicycles':     { addr: '1488 Sky Limit',         city: 'Port Augusta',    state: 'SA',  zip: '7666' },
    "Big Al's Bike Shop":    { addr: '1 Chapel St',            city: 'South Yarra',     state: 'VIC', zip: '3526' },
    'Magic Mountain Biking': { addr: '1498 Apple Way',          city: 'Pakeham',         state: 'VIC', zip: '3955' },
    'Peak Mountaineer':      { addr: '1400 South Sky Limit Ave', city: 'Flemington',     state: 'NSW', zip: '2003' },
};
// Real vendor (remit-to) addresses pulled from demodb — every vendor EXISTS.
const VENDOR_ADDR = {
    'A&B Distribution':      { addr: '432 Vine St',        city: 'Double Bay',     state: 'NSW', zip: '2988' },
    "Chuck's Chain Shop":    { addr: '5500 East Rd',       city: 'Sandown',        state: 'VIC', zip: '3651' },
    'Cyclery Connection':    { addr: '500 E. Lost Way',    city: 'South Melbourne', state: 'VIC', zip: '3254' },
    'Johnson Manufacturing': { addr: '3245 Williams Ave',  city: 'Dandenong Nth',  state: 'VIC', zip: '3943' },
    "Kevin's Cables":        { addr: '2155 Mescalero Trail', city: 'Footscray',    state: 'VIC', zip: '3984' },
    'Monroe Bike Company':   { addr: '100 Wall Street',    city: 'Sunbury',        state: 'VIC', zip: '3742' },
    'Rocky Mountain Bikes':  { addr: '234 Garden Rd',      city: 'Sydney',         state: 'NSW', zip: '2884' },
    'Simpson Cyclery':       { addr: '3 Dumskaya Ulitsa',  city: 'Monbulk',        state: 'VIC', zip: '3987' },
};
// Company ship-to for POs (home company default address in demodb).
const COMPANY_SHIPTO = { name: 'FB July', addr: '1 Smith St', city: 'Smithtown', state: 'QLD', zip: '4174' };

// Raw-material UOMs, rotated so the availability engine's UOM conversion path is
// exercised (not everything is 'ea').
const RM_UOMS = ['ea', 'ea', 'm', 'kg', 'mm', 'ea', 'L', 'ft', 'ea', 'kg'];

// ── part catalogue ───────────────────────────────────────────────────────────
const parts = [];   // {num, desc, uom, typeId, isFg, isSa, isRm, vendor, cost, moq, vendorUom, price}
const N_FG = 40, N_SA = 20, N_RM = 50;

for (let i = 0; i < N_RM; i++) {
    const num = 'WX-RM-' + (3000 + i);
    const uom = RM_UOMS[i % RM_UOMS.length];
    // Deterministic cost 2.50..27.00; MOQ 10..100 in a few multiples.
    const cost = Math.round((2.5 + (i % 20) * 1.25) * 100) / 100;
    const moq = [1, 10, 25, 50, 100][i % 5];
    parts.push({
        num, desc: 'WX Raw Component ' + (3000 + i), uom, typeId: 10, isRm: true,
        vendor: VENDORS[i % VENDORS.length], cost, moq, vendorUom: uom,
    });
}
for (let j = 0; j < N_SA; j++) {
    const num = 'WX-SA-' + (2000 + j);
    parts.push({ num, desc: 'WX Sub-Assembly ' + (2000 + j), uom: 'ea', typeId: 10, isSa: true,
        price: Math.round((40 + j * 3) * 100) / 100 });
}
for (let i = 0; i < N_FG; i++) {
    const num = 'WX-FG-' + (1000 + i);
    parts.push({ num, desc: 'WX Widget Assembly ' + (1000 + i), uom: 'ea', typeId: 10, isFg: true,
        price: Math.round((120 + i * 7.5) * 100) / 100 });
}
LABOUR.forEach((num, k) => parts.push({
    num, desc: ['Fabrication labour', 'Assembly labour', 'Test & QA labour'][k],
    uom: 'hr', typeId: 21, isLabour: true,
}));

const rm = parts.filter(p => p.isRm);
const sa = parts.filter(p => p.isSa);
const fg = parts.filter(p => p.isFg);

// ── BOM definitions (multi-level: FG consumes 1 SA + raws + labour) ──────────
// Each BOM: { num (=FG/SA part num), estMinutes, lines:[{type:'FG'|'RM', part, qty, uom}] }
const boms = [];
sa.forEach((s, j) => {
    const lines = [{ type: 'FG', part: s.num, qty: 1, uom: 'ea' }];
    const nRaw = 2 + (j % 3);   // 2-4 raws
    for (let k = 0; k < nRaw; k++) { const r = rm[(j * 3 + k) % rm.length]; lines.push({ type: 'RM', part: r.num, qty: 1 + ((j + k) % 3), uom: r.uom }); }
    lines.push({ type: 'RM', part: LABOUR[j % 3], qty: 0.25 + (j % 4) * 0.25, uom: 'hr' });   // labour line
    boms.push({ num: s.num, estMinutes: 30 + (j % 4) * 20, lines });
});
fg.forEach((f, i) => {
    const lines = [{ type: 'FG', part: f.num, qty: 1, uom: 'ea' }];
    lines.push({ type: 'RM', part: sa[i % sa.length].num, qty: 1, uom: 'ea' });   // sub-assembly → staged chain
    const nRaw = 3 + (i % 3);   // 3-5 raws
    for (let k = 0; k < nRaw; k++) { const r = rm[(i * 5 + k + 7) % rm.length]; lines.push({ type: 'RM', part: r.num, qty: 1 + ((i + k) % 4), uom: r.uom }); }
    lines.push({ type: 'RM', part: LABOUR[(i + 1) % 3], qty: 0.5 + (i % 5) * 0.25, uom: 'hr' });
    boms.push({ num: f.num, estMinutes: 60 + (i % 6) * 30, lines });
});

// ── engineered scarcity: mark ~15 raws SHORT, a few CONTESTED ────────────────
// short: zero/low on-hand → drives Procurement/Materials "unmet".
// contested: enough for one WO but several WOs need it → "stock contested".
const shortRm = new Set(rm.filter((_, i) => i % 3 === 0).map(p => p.num));      // ~17 short
const contestedRm = new Set(rm.filter((_, i) => i % 7 === 3).map(p => p.num));  // ~7 contested

// ============================================================================
// 1) PARTS / PRODUCTS / VENDOR PRICING  (ImportPartProductAndVendorPricing)
//    Header + column set taken verbatim from Import_Builder.htm SCHEMAS.
// ============================================================================
const PPVP_COLS = ['PartNumber', 'PartDescription', 'PartDetails', 'UOM', 'UPC', 'PartTypeID',
    'Active', 'PartTaxCode', 'StdCost', 'ProductNumber', 'ProductDescription', 'Price',
    'ProductActive', 'ProductTaxCode', 'Vendor', 'DefaultVendor', 'VendorPartNumber', 'Cost', 'VendorUOM'];
const ppvpRows = parts.map(p => {
    const isProduct = p.isFg || p.isSa;   // sellable finished goods + sub-assemblies get a product
    return [
        p.num, p.desc, '', p.uom, '', p.typeId,
        'true', PURCHASE_TAX,   // PartTaxCode is required for every part (incl. labour)
        (p.cost != null ? p.cost : (p.price != null ? Math.round(p.price * 0.55 * 100) / 100 : '')),   // StdCost
        isProduct ? p.num : '',                         // ProductNumber
        isProduct ? p.desc : '',                        // ProductDescription
        isProduct ? p.price : '',                       // Price
        isProduct ? 'true' : '',                        // ProductActive
        isProduct ? SALES_TAX : '',                     // ProductTaxCode
        p.vendor || '',                                 // Vendor
        p.vendor ? 'true' : '',                         // DefaultVendor
        p.vendor ? (p.num + '-V') : '',                 // VendorPartNumber
        p.cost != null ? p.cost : '',                   // Cost
        p.vendor ? p.vendorUom : '',                    // VendorUOM
    ];
});

// ============================================================================
// 2) BILL OF MATERIALS  (BEST-EFFORT — verify header in your Import wizard)
//    One row per BOM line: finished-good line (Type "Finished Good") then the
//    raw/labour lines (Type "Raw Good"). estimatedDuration on the FG line drives
//    the report's Est. Labor + capacity load.
// ============================================================================
const BOM_COLS = ['BOM Number', 'BOM Description', 'Configurable', 'Type', 'Part Number',
    'Part Description', 'Quantity', 'UOM', 'Estimated Duration (min)', 'Instructions'];
const bomRows = [];
boms.forEach(b => {
    const fgPart = parts.find(p => p.num === b.num);
    b.lines.forEach((ln, idx) => {
        const lp = parts.find(p => p.num === ln.part);
        bomRows.push([
            b.num,
            idx === 0 ? (fgPart ? fgPart.desc : b.num) : '',
            'false',
            ln.type === 'FG' ? 'Finished Good' : 'Raw Good',
            ln.part,
            lp ? lp.desc : '',
            ln.qty,
            ln.uom,
            idx === 0 ? b.estMinutes : '',
            '',
        ]);
    });
});

// ============================================================================
// 3) REORDER POINTS  (BEST-EFFORT — verify header)
//    Per-part per-LG min (reorder point) / max (order-up-to). Raws + SAs so the
//    Min/Max demand tag + Auto-PO-style signals populate.
// ============================================================================
const REORDER_COLS = ['PartNumber', 'LocationGroup', 'ReorderPoint', 'OrderUpToLevel', 'MinOrderQty'];
const reorderRows = [];
rm.forEach((p, i) => {
    const lg = LGS[i % LGS.length].name;
    const rop = [10, 20, 25, 50][i % 4];
    reorderRows.push([p.num, lg, rop, rop * 3, p.moq]);
});
sa.forEach((p, j) => { reorderRows.push([p.num, LGS[0].name, 5, 20, 1]); });

// ============================================================================
// 4) STARTING INVENTORY  (ImportAddInventory — CONFIRMED header)
//    On-hand for raws + some SAs. SHORT raws get 0 (or a token qty); contested
//    raws get just enough for ~1 WO; the rest get healthy stock.
// ============================================================================
const INV_COLS = ['PartNumber', 'PartDescription', 'Location', 'Qty', 'UOM', 'Cost', 'QBClass', 'Date', 'Note'];
const invRows = [];
const todayFmt = fmtDate(TODAY);
// The Location column is prefixed with the location group + hyphen so it is
// unambiguous when the same location name exists under more than one LG.
const locFull = (lg) => lg.name + '-' + lg.loc;   // e.g. "QLD Stock-R1A2"
rm.forEach((p, i) => {
    const lg = LGS[i % LGS.length];
    let qty;
    if (shortRm.has(p.num)) qty = 0;                 // genuinely short
    else if (contestedRm.has(p.num)) qty = 3;        // enough for ~1 WO → contested
    else qty = [40, 80, 150, 250][i % 4];            // healthy
    if (qty > 0) invRows.push([p.num, p.desc, locFull(lg), qty, p.uom, p.cost, '', todayFmt, 'WX demo seed']);
});
// A subset of sub-assemblies pre-stocked so not every chain must be built.
sa.forEach((p, j) => { if (j % 2 === 0) invRows.push([p.num, p.desc, locFull(LGS[0]), 4 + (j % 3), 'ea', Math.round(p.price * 0.55 * 100) / 100, '', todayFmt, 'WX demo seed']); });

// ============================================================================
// 5) SALES ORDERS  (ImportSalesOrder — CONFIRMED two-header layout)
//    ~15 SOs of 1-3 FG lines each, spread across customers/LGs and scheduled
//    dates → demand drivers. SONum blank = Fishbowl auto-numbers.
// ============================================================================
const SO_COLS = ['Flag', 'SONum', 'Status', 'CustomerName', 'CustomerContact',
    'BillToName', 'BillToAddress', 'BillToCity', 'BillToState', 'BillToZip', 'BillToCountry',
    'ShipToName', 'ShipToAddress', 'ShipToCity', 'ShipToState', 'ShipToZip', 'ShipToCountry',
    'ShipToResidential', 'CarrierName', 'TaxRateName', 'PriorityId', 'TotalIncludesTax',
    'PONum', 'VendorPONum', 'Date', 'Salesman', 'ShippingTerms', 'PaymentTerms', 'FOB', 'Note',
    'QuickBooksClassName', 'LocationGroupName', 'OrderDateScheduled', 'URL', 'CarrierService',
    'CurrencyName', 'CurrencyRate', 'PriceIsHomeCurrency', 'DateExpired', 'Phone', 'Email', 'Category'];
const SO_ITEM_COLS = ['Flag', 'SOItemTypeID', 'ProductNumber', 'ProductDescription', 'ProductQuantity',
    'UOM', 'ProductPrice', 'Taxable', 'TaxCode', 'Note', 'ItemQuickBooksClassName',
    'ItemDateScheduled', 'ShowItem', 'KitItem', 'RevisionLevel', 'CustomerPartNumber'];
const soRows = [];
const N_SO = 15;
for (let s = 0; s < N_SO; s++) {
    const cust = CUSTOMERS[s % CUSTOMERS.length];
    const lg = LGS[s % LGS.length];
    const a = CUST_ADDR[cust];                          // real demodb address
    const sched = fmtDate(addDays(TODAY, 7 + s * 3));   // spread 1-8 weeks out
    soRows.push([
        'SO', '', 20, cust, cust,
        cust, a.addr, a.city, a.state, a.zip, AU,        // BillTo* (full address)
        cust, a.addr, a.city, a.state, a.zip, AU,        // ShipTo* (full address)
        'false', '', SALES_TAX_NAME, 30, 'false',
        'WX-PO-' + (100 + s), '', todayFmt, '', '', '', '', 'WX demo sales order',
        '', lg.name, sched, '', '',
        '', '', 'true', '', '', '', '',
    ]);
    const nLines = 1 + (s % 3);
    for (let k = 0; k < nLines; k++) {
        const f = fg[(s * 3 + k) % fg.length];
        soRows.push([
            'Item', 10, f.num, f.desc, 1 + ((s + k) % 4),
            'ea', f.price, 'true', SALES_TAX_NAME, '', '',  // TaxCode = tax-rate NAME on every line
            sched, 'true', '', '', '',
        ]);
    }
}

// ============================================================================
// 6) PURCHASE ORDERS  (BEST-EFFORT — repo prefers REST; verify header)
//    Open POs covering short raws: a mix of Issued (20), Bid Request (10), and
//    an overdue batch (ETA in the past). One row per line, PO header repeated.
// ============================================================================
// Two-header layout (matching the confirmed SO shape): a 'PO' header row with
// full RemitTo (vendor) + ShipTo (company) address + TaxRate, then 'Item' rows
// each carrying the purchase tax-rate NAME. Header is best-effort — verify the
// column list in your Import wizard before running.
const PO_COLS = ['Flag', 'PONum', 'Status', 'VendorName', 'VendorContact',
    'RemitToName', 'RemitToAddress', 'RemitToCity', 'RemitToState', 'RemitToZip', 'RemitToCountry',
    'ShipToName', 'ShipToAddress', 'ShipToCity', 'ShipToState', 'ShipToZip', 'ShipToCountry',
    'CarrierName', 'TaxRateName', 'PaymentTerms', 'FOB', 'Note',
    'QuickBooksClassName', 'LocationGroupName', 'Date', 'DateScheduled', 'URL',
    'CurrencyName', 'CurrencyRate', 'PriceIsHomeCurrency'];
const PO_ITEM_COLS = ['Flag', 'POItemTypeID', 'PartNumber', 'PartDescription', 'PartQuantity',
    'UOM', 'PartPrice', 'Taxable', 'TaxCode', 'Note', 'ItemQuickBooksClassName',
    'ItemDateScheduled', 'ShowItem', 'RevisionLevel', 'CustomerPartNumber', 'VendorPartNumber'];
const poRows = [];
const shortList = rm.filter(p => shortRm.has(p.num));
let poN = 500;
// Group short raws by vendor so each PO is single-vendor.
const byVendor = new Map();
shortList.forEach(p => { if (!byVendor.has(p.vendor)) byVendor.set(p.vendor, []); byVendor.get(p.vendor).push(p); });
let vi = 0;
const cs = COMPANY_SHIPTO;
for (const [vendor, list] of byVendor) {
    // status/eta profile rotates: issued+future, bid, issued+overdue.
    const profile = vi % 3;
    const status = profile === 1 ? 10 : 20;                       // 10=Bid Request, 20=Issued
    const eta = profile === 2 ? addDays(TODAY, -3 - (vi % 5))     // overdue
        : addDays(TODAY, 5 + (vi % 10));                          // future
    const ponum = 'WX-PO-' + (poN++);
    const va = VENDOR_ADDR[vendor];                               // real vendor address
    poRows.push([
        'PO', ponum, status, vendor, vendor,
        vendor, va.addr, va.city, va.state, va.zip, AU,          // RemitTo* (vendor address)
        cs.name, cs.addr, cs.city, cs.state, cs.zip, AU,         // ShipTo* (company address)
        '', PURCHASE_TAX_NAME, '', '',
        (profile === 2 ? 'WX demo — overdue supply' : 'WX demo PO'),
        '', LGS[0].name, todayFmt, fmtDate(eta), '',
        '', '', 'true',
    ]);
    list.forEach(p => {
        poRows.push([
            'Item', 10, p.num, p.desc, Math.max(p.moq, 50),
            p.uom, p.cost, 'true', PURCHASE_TAX_NAME, '', '',    // TaxCode = tax-rate NAME on every line
            fmtDate(eta), 'true', '', p.num + '-V', p.num + '-V',
        ]);
    });
    vi++;
}

// ── emit ─────────────────────────────────────────────────────────────────────
console.log('Generating WX demo-data CSVs (anchor today=' + TODAY + ', dateFmt=' + DATE_FMT + '):');
writeCsv('01_parts_products_vendorpricing.csv', [PPVP_COLS], ppvpRows);
writeCsv('02_boms.csv', [BOM_COLS], bomRows);
writeCsv('03_reorder_points.csv', [REORDER_COLS], reorderRows);
writeCsv('04_starting_inventory.csv', [INV_COLS], invRows);
writeCsv('05_sales_orders.csv', [SO_COLS, SO_ITEM_COLS], soRows);
writeCsv('06_purchase_orders.csv', [PO_COLS, PO_ITEM_COLS], poRows);

// Reference dump so a header fix never needs the data re-derived.
fs.writeFileSync(path.join(__dirname, '_reference.json'), JSON.stringify({
    today: TODAY, dateFmt: DATE_FMT, counts: {
        parts: parts.length, fg: fg.length, sa: sa.length, rm: rm.length, labour: LABOUR.length,
        boms: boms.length, reorder: reorderRows.length, inventory: invRows.length,
        salesOrders: N_SO, purchaseOrders: poN - 500,
        shortRaws: shortRm.size, contestedRaws: contestedRm.size,
    }, vendors: VENDORS, customers: CUSTOMERS, lgs: LGS, boms,
}, null, 2), 'utf8');
console.log('  _reference.json written.');
console.log('Done — ' + parts.length + ' parts, ' + boms.length + ' BOMs.');
