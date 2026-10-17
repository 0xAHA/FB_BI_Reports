// Pure-function tests for fb-doc.js (no browser, no dependencies).
//   node --test Other_NOT_FOR_PRODUCTION/Paperwork_POC/tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const F = require('../fb-doc.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'fb-doc.js'), 'utf8');
const D = '\x24';   // a dollar sign, so this file never holds a setting-token literal either

test('lint: no setting-token or Script/Style directive literal in the shared source', () => {
  assert.equal(/\$[A-Z][A-Z0-9_]*\{/.test(SRC), false, 'setting-token literal found');
  assert.equal(SRC.includes('{' + '%'), false, 'directive literal found');
  // fb-doc.js is inlined into pages; report_btn reads the first fb-launch tag.
  assert.equal(/name\s*=\s*["']fb-launch["']/i.test(SRC), false, 'fb-launch meta literal found');
});

test('SOReport.htm: exactly one fb-launch tag, and it is the head meta', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'SOReport.htm'), 'utf8');
  assert.equal((page.match(/fb-launch/g) || []).length, 2, 'the tag + one prose mention');
  const first = page.indexOf('name="fb-launch"');
  assert.ok(first > page.indexOf('<head>') && first < page.indexOf('</head>'), 'the first fb-launch tag sits in <head>');
});

// ---------------------------------------------------------------- param
test('param: substituted, unsubstituted, empty', () => {
  assert.equal(F.param('A4', 'Letter'), 'A4');
  assert.equal(F.param(D + 'PRINT{Page_setup|A4|Print}', 'Letter'), 'A4');
  assert.equal(F.param(D + 'SO{Sales_Order}', '0'), '0');
  assert.equal(F.param('  ', 'x'), 'x');
  assert.equal(F.param(null, 'x'), 'x');
  assert.equal(F.param.bool(D + 'CHECK{Invoice|false|Document}', true), false);
  assert.equal(F.param.bool('1', false), true);
  assert.equal(F.param.bool('true', false), true);
  assert.equal(F.param.int('123', 0), 123);
  assert.equal(F.param.int(D + 'SO{Sales_Order|0|Order}', -1), 0);
  assert.equal(F.param.isToken(D + 'SO{x|1}'), true);
  assert.equal(F.param.isToken('125'), false);
});

// ---------------------------------------------------------------- launch
test('launch.get: object and JSON-string payloads normalise the same', () => {
  const payload = { v: 1, host: 'report_btn', module: 'so', moduleName: 'Sales Order', id: '290', num: ' SO-10042 ', reportId: 41, params: { Invoice: true } };
  const want = { v: 1, host: 'report_btn', module: 'SO', moduleName: 'Sales Order', table: 'so', id: 290, num: 'SO-10042', reportId: 41, params: { Invoice: true }, output: '' };
  assert.deepEqual(F.launch.get({ FB_LAUNCH: payload }), want);
  assert.deepEqual(F.launch.get({ FB_LAUNCH: JSON.stringify(payload) }), want);
  // Document output (LAUNCH_CONTEXT.md §6): only 'pdf' is kept.
  assert.equal(F.launch.get({ FB_LAUNCH: Object.assign({}, payload, { output: 'pdf' }) }).output, 'pdf');
  assert.equal(F.launch.get({ FB_LAUNCH: Object.assign({}, payload, { output: 'html' }) }).output, '');
});

test('launch.get: no launch, junk, missing module', () => {
  assert.equal(F.launch.get({}), null);
  assert.equal(F.launch.get({ FB_LAUNCH: null }), null);
  assert.equal(F.launch.get({ FB_LAUNCH: '' }), null);
  assert.equal(F.launch.get({ FB_LAUNCH: '{not json' }), null);
  assert.equal(F.launch.get({ FB_LAUNCH: [1, 2] }), null);
  assert.equal(F.launch.get({ FB_LAUNCH: 42 }), null);
  assert.equal(F.launch.get({ FB_LAUNCH: { id: 5 } }), null);
  assert.equal(F.launch.get({ FB_LAUNCH: { module: 'S O', id: 5 } }), null);
});

test('launch.get: id <= 0 means no record; a num may still name one', () => {
  for (const id of [0, -1, '-1', 'abc', null, undefined]) {
    const l = F.launch.get({ FB_LAUNCH: { module: 'SO', id } });
    assert.equal(l.id, 0, 'id ' + id);
  }
  assert.equal(F.launch.get({ FB_LAUNCH: { module: 'SO', num: 'SO-7' } }).num, 'SO-7');
  assert.equal(F.launch.get({ FB_LAUNCH: { module: 'SO', reportId: -3 } }).reportId, 0);
  assert.equal(F.launch.get({ FB_LAUNCH: { module: 'ZZZ', id: 1 } }).table, null);
  assert.deepEqual(F.launch.get({ FB_LAUNCH: { module: 'SO', id: 1, params: [1] } }).params, {});
});

test('launch.get: table from the host, else the code map, else null', () => {
  const t = o => F.launch.get({ FB_LAUNCH: Object.assign({ id: 5 }, o) }).table;
  assert.equal(t({ module: 'PART', table: 'part' }), 'part');               // Inventory module: a part id
  assert.equal(t({ module: 'LOC' }), 'location');                           // Consignment / Location
  assert.equal(t({ module: 'SO', table: 'so; DROP TABLE x' }), 'so');       // not an identifier: ignored
  assert.equal(t({ module: 'CALENDAR' }), null);                            // a module with no record type
  assert.equal(t({ module: 'CALENDAR', table: 'Calendar' }), 'calendar');
});

test('launch.id / launch.param: only for the matching module', () => {
  const w = { FB_LAUNCH: { module: 'SO', id: 290, params: { Invoice: false } } };
  assert.equal(F.launch.id('SO', w), 290);
  assert.equal(F.launch.id('so', w), 290);
  assert.equal(F.launch.id('SHIP', w), 0);
  assert.equal(F.launch.id('SO', {}), 0);
  assert.equal(F.launch.param('Invoice', true, w), false);
  assert.equal(F.launch.param('Page_setup', 'A4', w), 'A4');
  assert.equal(F.launch.param('Invoice', 'x', {}), 'x');
  assert.equal(F.launch.MODULES.TO, 'xo');
});

// ---------------------------------------------------------------- page
test('page.resolve: names, orientation, CSS forms, fallback', () => {
  const r = (s, o) => F.page.resolve(s, o);
  let p = r('A4');            assert.deepEqual([p.wMm, p.hMm, p.orientation, p.source], [210, 297, 'portrait', 'setting']);
  p = r('Letter');            assert.deepEqual([p.wMm, p.hMm], [215.9, 279.4]);
  p = r('A4 landscape');      assert.deepEqual([p.wMm, p.hMm, p.orientation], [297, 210, 'landscape']);
  p = r('Letter:landscape');  assert.deepEqual([p.wMm, p.hMm], [279.4, 215.9]);
  p = r('size: 8.5in 11in portrait; margin: 1in;');
  assert.deepEqual([p.wMm, p.hMm], [215.9, 279.4]); assert.equal(p.margin.t, 25.4);
  p = r('@page{size: A4 landscape; margin: 10mm 5mm}');
  assert.deepEqual([p.wMm, p.hMm, p.margin.t, p.margin.r], [297, 210, 10, 5]);
  p = r('216 x 279 mm');      assert.deepEqual([p.wMm, p.hMm], [216, 279]);
  p = r(D + 'PRINT{Page_setup|Letter|Print}'); assert.equal(p.name, 'Letter');
  p = r('nonsense');          assert.equal(p.name, 'A4'); assert.equal(p.warnings.length, 1);
  p = r('', { fallback: 'Letter' }); assert.equal(p.name, 'Letter'); assert.equal(p.source, 'default');
  // Named size without margins -> Jasper margins (20pt top/bottom, 30pt sides)
  p = r('A4'); assert.ok(Math.abs(p.margin.l - 30 / F.units.PT_PER_MM) < 1e-9);
  const g = F.page.geometry(r('A4'));
  const MM = F.units.PX_PER_MM, inset = 0.4 * 25.4;
  // The printable sheet = paper minus the client's 0.4in print margin each side.
  assert.ok(Math.abs(g.W - (210 - 2 * inset) * MM) < 0.1, 'sheet width ' + g.W);
  assert.ok(g.H < (297 - 2 * inset) * MM && g.H > (297 - 2 * inset) * MM - 3, 'sheet height ' + g.H);
  assert.ok(Math.abs(g.paperW - 210 * MM) < 0.1);
  // Jasper margins beyond the inset become sheet padding (top/bottom 20pt < inset -> 0).
  assert.equal(g.pad.t, 0);
  assert.ok(Math.abs(g.pad.l - (30 / F.units.PT_PER_MM - inset) * MM) < 1e-6);
  assert.ok(Math.abs(g.W - g.pad.l - g.pad.r - g.CW) < 1e-9);
  // Content width is unchanged by the inset (it only moves the margin into the printer).
  assert.ok(Math.abs(g.CW - (210 - 2 * 30 / F.units.PT_PER_MM) * MM) < 0.1);
});

// ---------------------------------------------------------------- fmt
test('fmt.number: Fishbowl report patterns', () => {
  const n = F.fmt.number;
  assert.equal(n('$ #,##0.00', 1234.5, { symbol: '$' }), '$ 1,234.50');
  assert.equal(n('$ #,##0.00', -1234.5, { symbol: '$' }), '-$ 1,234.50');
  assert.equal(n('$ #,##0.00', 1234.5, { symbol: '£' }), '£ 1,234.50');
  assert.equal(n('$ #,##0.00', 1234.5, { symbol: '' }), ' 1,234.50');      // Jasper's "NoSymbol" = substring(1)
  assert.equal(n('$ #,##0.00', 1234.5), '$ 1,234.50');                      // literal $ when no symbol given
  assert.equal(n('#,##0.#####', 2.5), '2.5');
  assert.equal(n('#,##0.#####', 1234567.123456), '1,234,567.12346');
  assert.equal(n('#,##0.#####', 10), '10');
  assert.equal(n('#,##0.00', 0.125), '0.12');                               // HALF_EVEN (DecimalFormat default)
  assert.equal(n('#,##0.00', 0.375, { rounding: 'halfUp' }), '0.38');
  assert.equal(n('#,##0.00', 2.5 / 100, { rounding: 'halfUp' }), '0.03');
  assert.equal(n('#,##0.00;(#,##0.00)', -5), '(5.00)');
  assert.equal(n('#.##', 0.5), '.5');
  assert.equal(n('0%', 0.25), '25%');
  assert.equal(n(' #,##0.0#######', 1.5), ' 1.5');
  assert.equal(n('#,##0.00', -0.001), '0.00');                               // never "-0.00"
  assert.equal(n('#,##0.00', ''), '');
  assert.equal(n('#,##0.00', null), '');
});

test('fmt.date: SimpleDateFormat subset, local parse', () => {
  const d = F.fmt.date;
  assert.equal(d('dd/MM/yyyy', '2025-03-12 00:00:00'), '12/03/2025');
  assert.equal(d('MM/dd/yy', '2025-03-02'), '03/02/25');
  assert.equal(d('MMM d, yyyy', '2026-10-08 14:05:09'), 'Oct 8, 2026');
  assert.equal(d('MMMM d, yyyy h:mm a', '2026-10-08 14:05:09'), 'October 8, 2026 2:05 PM');
  assert.equal(d("yyyy-MM-dd'T'HH:mm:ss", '2026-10-08 07:05:09.5'), '2026-10-08T07:05:09');
  assert.equal(d("EEE dd MMM ''yy", '2026-10-08'), "Thu 08 Oct '26");
  assert.equal(d('dd/MM/yyyy', null), '');
  assert.equal(d('dd/MM/yyyy', new Date(2024, 1, 29)), '29/02/2024');
});

test('fmt.currencySymbol', () => {
  assert.equal(F.fmt.currencySymbol('AUD'), '$');
  assert.equal(F.fmt.currencySymbol('USD'), '$');
  assert.equal(F.fmt.currencySymbol('GBP'), '£');
  assert.equal(F.fmt.currencySymbol('EUR'), '€');
  assert.equal(F.fmt.currencySymbol('NZD', true), 'NZD');
});

// ---------------------------------------------------------------- columns
const sum = a => Math.round(a.reduce((x, y) => x + y, 0) * 100) / 100;
test('Columns.fit: always the content width, fixed columns stay standard', () => {
  const W = 535.28;
  const au = F.Columns.fit([{ key: 'line' }, { key: 'num' }, { key: 'desc' }, { key: 'taxCode' }, { key: 'unitPrice' }, { key: 'qty' }, { key: 'total' }], W);
  assert.equal(sum(au.widths), W);
  assert.equal(au.widths[0], 30); assert.equal(au.widths[4], 72); assert.equal(au.widths[6], 72);
  // Hiding columns: the description absorbs the space, numeric columns keep their width.
  const less = F.Columns.fit([{ key: 'line' }, { key: 'num' }, { key: 'desc' }, { key: 'qty' }, { key: 'total' }], W);
  assert.equal(sum(less.widths), W);
  assert.equal(less.widths[4], 72);
  assert.ok(less.widths[2] > au.widths[2]);
  // Same column, same width across documents when there is room.
  assert.equal(au.widths[5], less.widths[3]);
});

test('Columns.fit: overflow shrinks toward min, then compacts; never exceeds', () => {
  const W = 535.28;
  const many = ['line', 'type', 'cf', 'num', 'desc', 'cf', 'taxCode', 'taxAmt', 'curTax', 'date', 'unitPrice', 'curUnitPrice', 'qty', 'total', 'curTotal', 'cf']
    .map((k, i) => ({ key: k + i, kind: k }));
  const r = F.Columns.fit(many, W);
  assert.equal(sum(r.widths), W);
  assert.equal(r.compact, true);
  // Compact tier first: a set that fits at 7pt minimums is not scaled below them.
  const mid = ['line', 'type', 'num', 'desc', 'taxCode', 'taxAmt', 'curTax', 'date', 'unitPrice', 'curUnitPrice', 'qty', 'total', 'curTotal']
    .map(k => ({ key: k }));
  const r3 = F.Columns.fit(mid, W);
  assert.equal(r3.compact, true); assert.equal(sum(r3.widths), W);
  r3.items.forEach((c, i) => assert.ok(r3.widths[i] >= c.min - 0.01, c.key + ' below compact min'));
  const some = ['line', 'num', 'desc', 'taxCode', 'taxAmt', 'date', 'unitPrice', 'qty', 'total'].map(k => ({ key: k }));
  const r2 = F.Columns.fit(some, W);
  assert.equal(sum(r2.widths), W);
  assert.equal(r2.compact, false);
  r2.items.forEach((c, i) => assert.ok(r2.widths[i] >= c.min - 0.01, c.key + ' below min'));
  // No flex columns: strip cells share the width.
  const strip = F.Columns.fit([{ key: 'a', kind: 'strip' }, { key: 'b', kind: 'strip' }, { key: 'c', kind: 'strip' }], 552);
  assert.deepEqual(strip.widths, [184, 184, 184]);
});

// ---------------------------------------------------------------- layout
function capFn(nonLast, last) { return (p, isLast) => (isLast ? last : nonLast); }
function rows(n, h, extra) { return Array.from({ length: n }, () => Object.assign({ h: h }, extra || {})); }
function assigned(pages) {
  // Expand pages into [{i, l?}] in order, for coverage checks.
  return pages.map(p => ({ from: p.from, to: p.to, last: p.last }));
}

test('layout: one page when everything fits', () => {
  const pages = F.layout({ items: rows(3, 10), cap: capFn(100, 80) });
  assert.equal(pages.length, 1); assert.equal(pages[0].last, true);
});

test('layout: empty document is one last page', () => {
  const pages = F.layout({ items: [], cap: capFn(100, 80) });
  assert.equal(pages.length, 1); assert.equal(pages[0].last, true);
});

test('layout: rows flow over pages; last page respects the taller footer', () => {
  // 10 rows x 10, non-last cap 35 (3 rows), last cap 25 (2 rows): greedy, like Jasper
  const pages = F.layout({ items: rows(10, 10), cap: capFn(35, 25) });
  const counts = pages.map(p => p.to.i - p.from.i);
  assert.deepEqual(counts, [3, 3, 3, 1]);
  assert.equal(pages[pages.length - 1].last, true);
  assert.equal(pages.filter(p => p.last).length, 1);
});

test('layout: tail carried so totals never sit alone', () => {
  // 3 rows fit under the normal footer (cap 30) but only 2 with the last footer (cap 25)
  const pages = F.layout({ items: rows(3, 10), cap: capFn(30, 25) });
  assert.deepEqual(pages.map(p => [p.from.i, p.to.i, p.last]), [[0, 2, false], [2, 3, true]]);
});

test('layout: footer-only last page when no break is allowed', () => {
  const items = rows(3, 10); items[0].kwn = true; items[1].kwn = true;   // one unbreakable chain
  const pages = F.layout({ items: items, cap: capFn(30, 25) });
  assert.equal(pages.length, 2);
  assert.deepEqual([pages[1].from.i, pages[1].to.i, pages[1].last], [3, 3, true]);
});

test('layout: table column header costs once per sheet run', () => {
  const items = rows(6, 10, { table: 't' });
  const pages = F.layout({ items: items, chrome: { t: 8 }, cap: capFn(40, 40) });
  // 8 + 3*10 = 38 per sheet
  assert.deepEqual(pages.map(p => p.to.i - p.from.i), [3, 3]);
});

test('layout: keepWithNext moves a group header with its first child', () => {
  const items = rows(4, 10);
  items[2].kwn = true;           // header at index 2 must stay with 3
  const pages = F.layout({ items: items, cap: capFn(30, 30) });
  assert.deepEqual(pages.map(p => [p.from.i, p.to.i]), [[0, 2], [2, 4]]);
});

test('layout: group header repeats "(continued)" on the next sheet', () => {
  const items = [{ h: 10, kwn: true }].concat(rows(6, 10, { grp: ['kit'] }));
  const pages = F.layout({ items: items, groups: { kit: { header: 0, repeatH: 5 } }, cap: capFn(40, 40) });
  assert.deepEqual(pages[0].repeat, []);
  assert.deepEqual(pages[1].repeat, ['kit']);
  // second sheet budget: 40 - 5 (repeat) = 35 -> 3 rows
  assert.deepEqual(pages.map(p => p.to.i - p.from.i), [4, 3]);
});

test('layout: forced break before a page-break item', () => {
  const items = rows(4, 10); items[2].brk = true;
  const pages = F.layout({ items: items, cap: capFn(100, 100) });
  assert.deepEqual(pages.map(p => [p.from.i, p.to.i]), [[0, 2], [2, 4]]);
});

function splitItem(nLines, lineH, pad) {
  const tops = [], bots = [];
  for (let i = 0; i < nLines; i++) { tops.push(pad + i * lineH); bots.push(pad + (i + 1) * lineH); }
  return { h: pad * 2 + nLines * lineH, split: { tops, bots, padT: pad, padB: pad } };
}

test('layout: long text splits by line with orphans/widows', () => {
  const items = [{ h: 30 }, splitItem(10, 10, 2)];       // note of 104px
  const pages = F.layout({ items: items, cap: capFn(64, 64), orphans: 2, widows: 2 });
  // page 1: 30 + (2 + 3 lines*10 + 2 = 34) = 64 -> cut at line 3
  assert.deepEqual(pages[0].to, { i: 1, l: 3 });
  assert.deepEqual(pages[1].from, { i: 1, l: 3 });
  assert.equal(pages[pages.length - 1].last, true);
  // every line placed exactly once
  const cuts = pages.map(p => p.to).filter(t => t.i === 1 && t.l > 0).map(t => t.l);
  assert.ok(cuts.every((c, i) => i === 0 || c > cuts[i - 1]));
});

test('layout: widows — never leave one line alone', () => {
  const items = [splitItem(5, 10, 0)];
  const pages = F.layout({ items: items, cap: capFn(45, 45), orphans: 2, widows: 2 });
  // 4 lines would fit but leave 1 widow -> cut after 3
  assert.deepEqual(pages[0].to, { i: 0, l: 3 });
});

test('layout: atomic item taller than a sheet is forced and terminates', () => {
  const items = [{ h: 10 }, { h: 500 }, { h: 10 }];
  const pages = F.layout({ items: items, cap: capFn(100, 100) });
  assert.ok(pages.some(p => p.forced));
  assert.equal(pages[pages.length - 1].last, true);
});

// Seeded fuzz: invariants over random documents.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
test('layout fuzz: coverage, order, budgets, single last page, termination', () => {
  for (let seed = 1; seed <= 3000; seed++) {
    const R = rng(seed), N = Math.floor(R() * 60);
    const items = [];
    const groups = {};
    let gOpen = null;
    for (let k = 0; k < N; k++) {
      const t = R();
      let it;
      if (t < 0.1) it = splitItem(1 + Math.floor(R() * 30), 8 + Math.floor(R() * 6), Math.floor(R() * 4));
      else it = { h: 4 + Math.floor(R() * 60) };
      if (R() < 0.6) it.table = R() < 0.5 ? 'items' : 'pay';
      if (R() < 0.1) it.kwn = true;
      if (R() < 0.05) it.kwp = true;
      if (R() < 0.03) it.brk = true;
      if (R() < 0.08) { gOpen = 'g' + k; groups[gOpen] = { header: k, repeatH: Math.floor(R() * 12) }; it.kwn = true; }
      else if (gOpen && R() < 0.8) it.grp = [gOpen];
      else gOpen = null;
      items.push(it);
    }
    const nonLast = 120 + Math.floor(R() * 300), last = nonLast - Math.floor(R() * 100);
    const pages = F.layout({ items, chrome: { items: 7, pay: 5 }, groups, cap: capFn(nonLast, last) });
    assert.ok(pages.length >= 1 && pages.length <= N * 40 + 2, 'page count sane, seed ' + seed);
    assert.equal(pages.filter(p => p.last).length, 1, 'one last page, seed ' + seed);
    assert.equal(pages[pages.length - 1].last, true, 'last page is last, seed ' + seed);
    // budgets: recompute each sheet's height (repeat headers + table chrome + fragments)
    const fragH = (it, a, b) => it.split.padT + (it.split.bots[b - 1] - it.split.tops[a]) + it.split.padB;
    pages.forEach((p, pi) => {
      if (p.forced) return;
      let used = (p.repeat || []).reduce((s, g) => s + groups[g].repeatH, 0), tbl = null;
      const endI = p.to.i + (p.to.l > 0 ? 1 : 0);
      for (let k = p.from.i; k < endI && k < N; k++) {
        const it = items[k];
        if (it.table && it.table !== tbl) used += it.table === 'items' ? 7 : 5;
        tbl = it.table || null;
        const a = k === p.from.i ? p.from.l : 0;
        const b = (k === p.to.i && p.to.l > 0) ? p.to.l : (it.split ? it.split.tops.length : 0);
        used += it.split && (a > 0 || b < it.split.tops.length) ? fragH(it, a, b) : it.h;
      }
      assert.ok(used <= (p.last ? last : nonLast) + 0.02, `budget seed ${seed} page ${pi}: ${used} > ${p.last ? last : nonLast}`);
    });
    // contiguous and ordered
    let pos = { i: 0, l: 0 };
    pages.forEach((p, pi) => {
      if (N > 0 || pi > 0) assert.deepEqual(p.from, pos, 'contiguous, seed ' + seed + ' page ' + pi);
      const after = p.to.i > p.from.i || (p.to.i === p.from.i && p.to.l > p.from.l);
      assert.ok(after || (p.last && p.from.i >= N), 'progress, seed ' + seed + ' page ' + pi);
      pos = p.to;
    });
    assert.equal(pos.i, N, 'all items placed, seed ' + seed);
  }
});

// ---------------------------------------------------------------- queries
test('inline binding: escaping, types, placeholder count', () => {
  const b = F._inlineBind;
  const BS = String.fromCharCode(92);   // one backslash
  assert.equal(b('SELECT * FROM so WHERE id = ? AND num LIKE ?', [290, "O'Brien" + BS + '%']),
    "SELECT * FROM so WHERE id = 290 AND num LIKE 'O''Brien" + BS + BS + "%'");
  assert.equal(b('SELECT ?, ?, ?', [null, true, 'x']), "SELECT NULL, 1, 'x'");
  assert.throws(() => b('SELECT ?', []), /placeholders/);
  assert.throws(() => b('SELECT 1', [1]), /parameters/);
  assert.throws(() => b('SELECT ?', [NaN]), /non-finite/);
});

test('errText: strings, Errors, objects', () => {
  assert.equal(F.errText('Data access disabled'), 'Data access disabled');
  assert.equal(F.errText(new Error('boom')), 'boom');
  assert.equal(F.errText({ status: 500 }), '{"status":500}');
  assert.equal(F.errText(null), 'unknown error');
});

test('q: inline by default; a bare-string rejection becomes a readable Error', async () => {
  const seen = [];
  globalThis.runQueryAsync = async (arg) => { seen.push(arg); if (/FAIL/.test(arg)) throw 'Table missing'; return [{ a: 1 }]; };
  try {
    assert.deepEqual(await F.q('SELECT ? AS a', [1]), [{ a: 1 }]);
    assert.equal(seen[0], 'SELECT 1 AS a');                       // a plain string, never the object form
    await assert.rejects(F.q('SELECT FAIL'), /Query failed: Table missing/);
    globalThis.runQueryAsync = async () => [{ Error: 'bad sql' }];
    await assert.rejects(F.q('SELECT 1'), /bad sql/);
  } finally { delete globalThis.runQueryAsync; }
});
