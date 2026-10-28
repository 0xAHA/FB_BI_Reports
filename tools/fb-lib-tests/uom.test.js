// Desk test: FBLib.Uom, unit conversion over uom / uomconversion rows anchored on SI codes.
//   node --test tools/fb-lib-tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const SRC = fs.readFileSync(require('path').join(__dirname, '..', '..', 'scripts', 'fb-lib.js'), 'utf8');

function lib(extra) {
  const ctx = Object.assign({ console: { log() {}, info() {}, warn() {}, error() {} },
    FB_REPORT: { key: 'cdx.bi.test', name: null, build: 'x' } }, extra || {});
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx.FBLib;
}

// The local server's units: lbs, kg, oz, g, mg, a "20kg" bag; ft, in, m, mm, cm, km, yd, "25m" and "4.8m" lengths; ea, box (12).
const UOMS = [
  { id: 1, code: 'ea', name: 'Each', uomtype: 1, activeflag: 1 },
  { id: 3, code: 'lbs', name: 'Pound', uomtype: 2, activeflag: 1 },
  { id: 8, code: 'kg', name: 'Kilogram', uomtype: 2, activeflag: 1 },
  { id: 15, code: 'g', name: 'Gram', uomtype: 2, activeflag: 1 },
  { id: 29, code: '20kg', name: '20kg bag', uomtype: 2, activeflag: 1 },
  { id: 2, code: 'ft', name: 'Foot', uomtype: 3, activeflag: 1 },
  { id: 7, code: 'in', name: 'Inch', uomtype: 3, activeflag: 1 },
  { id: 10, code: 'm', name: 'Metre', uomtype: 3, activeflag: 1 },
  { id: 12, code: 'mm', name: 'Millimetre', uomtype: 3, activeflag: 1 },
  { id: 27, code: '25m', name: '25 m roll', uomtype: 3, activeflag: 1 },
  { id: 40, code: 'zz', name: 'Unknown length', uomtype: 3, activeflag: 0 },
  { id: 50, code: 'box', name: 'Box of 12', uomtype: 1, activeflag: 1 }
];
// value_in_TO = value_in_FROM * multiply / factor
const CONVS = [
  { fromuomid: 29, touomid: 8, multiply: 20, factor: 1 },     // 1 bag = 20 kg
  { fromuomid: 27, touomid: 10, multiply: 25, factor: 1 },    // 1 roll = 25 m
  { fromuomid: 50, touomid: 1, multiply: 12, factor: 1 }      // 1 box = 12 ea
];
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, (msg || '') + ' ' + a + ' vs ' + b);

test('lengths and weights resolve through SI codes, with or without a stored pair', () => {
  const U = lib().Uom.create(UOMS, CONVS);
  near(U.toMetres(250, 12), 0.25, 'mm');
  near(U.toMetres(10, 7), 0.254, 'in (no in -> m row needed)');
  near(U.toKg(2, 3), 0.90718474, 'lbs');
  near(U.toKg(3, 29), 60, '20kg bag via its conversion row');
  near(U.toMetres(2, 27), 50, '25m roll via its conversion row');
  near(U.ratio(7, 12), 25.4, 'in -> mm through the SI anchor');
  near(U.convert(1, 2, 7), 12, 'ft -> in');
});

test('a unit that reaches no anchor is null, never zero', () => {
  const U = lib().Uom.create(UOMS, CONVS);
  assert.equal(U.toMetres(5, 40), null);
  assert.equal(U.toMetres(5, 999), null);
  assert.equal(U.toKg(5, 10), null, 'a length unit is not a weight');
  assert.equal(U.ratio(1, 8), null, 'each -> kg has no path');
  assert.equal(U.toMetres('abc', 10), null);
});

test('count units convert both ways along a stored pair', () => {
  const U = lib().Uom.create(UOMS, CONVS);
  near(U.convert(2, 50, 1), 24, 'box -> ea');
  near(U.convert(6, 1, 50), 0.5, 'ea -> box (reverse edge)');
  assert.equal(U.ratio(1, 1), 1);
  assert.equal(U.code(50), 'box');
  assert.equal(U.byId[40].active, false);
});

test('SI volume codes convert for capacity fields', () => {
  const L = lib();
  near(L.Uom.convertSI('volume', 1000, 'l', 'm3'), 1);
  near(L.Uom.convertSI('volume', 1, 'ft3', 'm3'), 0.028316846592);
  near(L.Uom.convertSI('length', 120, 'cm', 'm'), 1.2);
  assert.equal(L.Uom.convertSI('volume', 1, 'bogus', 'm3'), null);
});

test('load() reads both tables once and caches the engine', async () => {
  const sql = [];
  const L = lib({ runQueryAsync: async q => { sql.push(q); return /FROM uomconversion/.test(q) ? CONVS : UOMS; } });
  const U = await L.Uom.load();
  near(U.toMetres(1, 2), 0.3048);
  await L.Uom.load();
  assert.equal(sql.length, 2, 'cached');
  assert.ok(sql.every(q => /^SELECT /.test(q)));
  await L.Uom.load({ force: true });
  assert.equal(sql.length, 4);
});
