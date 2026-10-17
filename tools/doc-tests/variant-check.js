#!/usr/bin/env node
// variant-check.js — SOInvoiceReport.htm must stay identical to SOReport.htm
// except the listed lines (the old build.js VARIANTS, now two real files).
//
//   node tools/doc-tests/variant-check.js [folder holding SOReport.htm + SOInvoiceReport.htm]
//
// Checks, below each file's header comment (everything before <html):
//   1. applying the five swaps in variant-swaps.js to SOReport.htm (each must
//      match exactly once) gives SOInvoiceReport.htm byte for byte;
//   2. so the files differ in exactly those lines, and nowhere else.
// And in the header comments: SOInvoiceReport.htm carries the "must stay
// identical" note naming each swapped line, and SOReport.htm points at the variant.
// Exit 0 = OK; 1 = drift (each differing line is printed).
'use strict';
const fs = require('fs');
const path = require('path');
const SW = require('./variant-swaps.js');

const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'iReport_Ports', 'SalesOrder'));
// Each file carries its own build stamp (tools/stamp), so the @fb-build line is
// compared with the stamp blanked out.
const read = f => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n')
  .replace(/build:\s*'[^']*'(\s*\/\/\s*@fb-build)/, "build: ''$1");
const so = read('SOReport.htm'), inv = read('SOInvoiceReport.htm');
const errs = [];

function split(src, name) {
  const at = src.indexOf('<html');
  if (at < 0) { errs.push(name + ': no <html>'); return ['', src]; }
  return [src.slice(0, at), src.slice(at)];
}
const [soHead, soBody] = split(so, 'SOReport.htm');
const [invHead, invBody] = split(inv, 'SOInvoiceReport.htm');

// 1. SOReport + swaps == SOInvoiceReport (below the header comment).
let want = soBody;
for (const [a, b] of SW.body) {
  const n = want.split(a).length - 1;
  if (n !== 1) errs.push('SOReport.htm: swap source found ' + n + ' times (need 1): ' + a);
  else want = want.split(a).join(b);
}
if (want !== invBody) {
  const A = want.split('\n'), B = invBody.split('\n');
  if (A.length !== B.length) errs.push('line count differs below the header: SOReport+swaps ' + A.length + ' vs SOInvoiceReport ' + B.length);
  const off = (so.slice(0, so.indexOf('<html')).split('\n').length - 1);
  const offI = (inv.slice(0, inv.indexOf('<html')).split('\n').length - 1);
  let shown = 0;
  for (let i = 0; i < Math.max(A.length, B.length) && shown < 20; i++) {
    if (A[i] !== B[i]) {
      shown++;
      errs.push('unlisted difference at SOReport.htm:' + (i + off + 1) + ' / SOInvoiceReport.htm:' + (i + offI + 1) +
        '\n    SOReport (+swaps): ' + JSON.stringify(A[i]) + '\n    SOInvoiceReport:   ' + JSON.stringify(B[i]));
    }
  }
}

// 2. The differing lines are exactly the listed ones (count the line pairs).
const soL = soBody.split('\n'), invL = invBody.split('\n');
let diffLines = 0;
if (soL.length === invL.length) for (let i = 0; i < soL.length; i++) if (soL[i] !== invL[i]) diffLines++;
if (diffLines !== SW.body.length) errs.push('expected ' + SW.body.length + ' differing lines below the header, found ' + diffLines);

// 3. Header notes.
if (!/must stay\s+IDENTICAL to\s+SOReport\.htm/i.test(invHead)) errs.push('SOInvoiceReport.htm header: the "must stay identical to SOReport.htm" note is missing');
for (const label of ['Invoice setting token', 'FB_REPORT key', 'FB_REPORT name', 'description meta', '<title>']) {
  if (!invHead.includes(label)) errs.push('SOInvoiceReport.htm header: note does not list "' + label + '"');
}
if (!/SOInvoiceReport\.htm/.test(soHead)) errs.push('SOReport.htm header: no pointer to the SOInvoiceReport.htm variant');
for (const [a, b] of SW.header) {
  if (!soHead.includes(a)) errs.push('SOReport.htm header lacks: ' + a.split('\n')[0]);
  if (!invHead.includes(b)) errs.push('SOInvoiceReport.htm header lacks: ' + b.split('\n')[0]);
}

if (errs.length) {
  console.error('VARIANT CHECK FAILED (' + dir + ')\n- ' + errs.join('\n- '));
  process.exit(1);
}
console.log('variant check OK: SOInvoiceReport.htm = SOReport.htm + ' + SW.body.length + ' listed line swaps (' + dir + ')');
