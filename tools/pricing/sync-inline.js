#!/usr/bin/env node
// ============================================================================
//  tools/pricing/sync-inline.js — refresh the inlined copies of fb-pricing.js
// ============================================================================
//
// Most reports load scripts/fb-pricing.js through Fishbowl's Script directive.
// QuickOrder can't: it also runs in portal and standalone mode, where nothing
// expands a directive, so it carries the module inline between two marker
// lines. This rewrites that block from the source.
//
// USAGE
//   node tools/pricing/sync-inline.js           rewrite every stale copy
//   node tools/pricing/sync-inline.js --check   exit 1 if any copy is stale (no writes)
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'scripts', 'fb-pricing.js');
const TARGETS = ['SalesOrder/QuickOrder_v1.2.htm'];   // v1.0 retired to archived/ 2026-10-01
const BEGIN = '// ==== fb-pricing.js (INLINED COPY) BEGIN — regenerate with tools/pricing/sync-inline.js, never edit here ====';
const END = '// ==== fb-pricing.js (INLINED COPY) END ====';

const check = process.argv.includes('--check');
const src = fs.readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n').trimEnd();
// Inside an inline <script>, "</script" would end the block early, and the
// directive text would be expanded by Fishbowl wherever it appears.
if (/<\/script/i.test(src)) throw new Error('fb-pricing.js contains "</script" — it cannot be inlined');
if (src.includes('{' + '% Script') || src.includes('{' + '% Style')) throw new Error('fb-pricing.js contains a directive literal');

let stale = 0;
for (const rel of TARGETS) {
    const file = path.join(ROOT, rel);
    const raw = fs.readFileSync(file, 'utf8');
    const crlf = raw.includes('\r\n');
    const text = raw.replace(/\r\n/g, '\n');
    const a = text.indexOf(BEGIN), b = text.indexOf(END);
    if (a < 0 || b < a || text.indexOf(BEGIN, a + 1) >= 0) throw new Error(rel + ': markers missing or repeated');
    const next = text.slice(0, a + BEGIN.length) + '\n' + src + '\n' + text.slice(b);
    if (next === text) { console.log('current  ' + rel); continue; }
    stale++;
    if (check) { console.log('STALE    ' + rel); continue; }
    fs.writeFileSync(file, crlf ? next.replace(/\n/g, '\r\n') : next);
    console.log('synced   ' + rel);
}
process.exit(check && stale ? 1 : 0);
