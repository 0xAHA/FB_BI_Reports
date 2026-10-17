#!/usr/bin/env node
// build.js — inline fb-doc.js + fb-doc-fonts.css into paste-able reports.
//
//   node Other_NOT_FOR_PRODUCTION/Paperwork_POC/build.js              every page
//   node Other_NOT_FOR_PRODUCTION/Paperwork_POC/build.js POReport.htm  just these (+ their variants)
//   node Other_NOT_FOR_PRODUCTION/Paperwork_POC/build.js --plan        what builds what, as JSON
//
// --plan is the contract tools/deploy/built.js reads, so Fishbowl and SharePoint
// get the built page: [{ src, out, page, inputs }], absolute paths. src is null
// for a variant; page is the argument that builds out; inputs are every file
// out is built from.
//
// Replaces the markers  <!-- @inline-script NAME -->  and  <!-- @inline-style NAME -->
// in every source .htm in this folder with the file's contents, writing
// dist/<name>.htm, plus the VARIANTS below (a page built from another page). The
// fb-lib / fb-styles directives are left alone: Fishbowl expands those from the
// deployed shared records. Fails if an inlined file would smuggle a directive or
// a report-setting token into the page (Fishbowl substitutes both globally).
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const DIST = path.join(HERE, 'dist');
const PLAN = process.argv[2] === '--plan';
const ONLY = PLAN ? [] : process.argv.slice(2);
const MARKER = /<!--\s*@inline-(script|style)\s+([\w.-]+)\s*-->/g;
const PAGES = fs.readdirSync(HERE).filter(f => /.htm$/i.test(f) && (!ONLY.length || ONLY.includes(f))).sort();
if (ONLY.length && !PAGES.length) throw new Error('no such page: ' + ONLY.join(', '));

// Pages built from another page by exact text swaps (each must match once).
// SOInvoiceReport: the Sales Order page with its Invoice setting defaulting on,
// its own settings key and record name. The token text is built, not typed, so
// this file never holds a setting-token literal.
const TOKEN = code => String.fromCharCode(36) + code + '{';
const VARIANTS = [
  { from: 'SOReport.htm', to: 'SOInvoiceReport.htm', swaps: [
    [TOKEN('CHECK') + 'Invoice|false|Document}', TOKEN('CHECK') + 'Invoice|true|Document}'],
    ["key:   'cdx.bi.paperwork.so',", "key:   'cdx.bi.paperwork.soinv',"],
    ["name:  'Sales Order Report',", "name:  'Sales Invoice',"],
    ['<meta name="description" content="The sales order document, ready to print or save as PDF.">', '<meta name="description" content="The sales invoice for a sales order, ready to print or save as PDF.">'],
    ['<title>Sales Order Report</title>', '<title>Sales Invoice</title>']
  ] }
];

function inline(src) {
  return src.replace(MARKER, (m, kind, name) => {
    const body = fs.readFileSync(path.join(HERE, name), 'utf8');
    if (body.includes('{' + '%') || /\$[A-Z][A-Z0-9_]*\{/.test(body)) {
      throw new Error(name + ' contains a directive or setting-token literal');
    }
    // A literal "</script" inside inlined JS would end the tag early.
    if (kind === 'script' && /<\/script/i.test(body)) throw new Error(name + ' contains </script');
    return kind === 'script'
      ? '<script>\n/* ---- inlined ' + name + ' ---- */\n' + body + '\n</script>'
      : '<style>\n/* ---- inlined ' + name + ' ---- */\n' + body + '\n</style>';
  });
}

// Every inline <script> must at least parse: there are no dev tools in the
// client, and a syntax error there shows as a page that never loads.
function syntaxCheck(page, html) {
  const vm = require('vm');
  const re = /<script(?![^>]*type="text\/plain")[^>]*>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = re.exec(html))) {
    n++;
    // Directives are expanded by Fishbowl; stand in an empty statement.
    const code = m[1].replace(/\{%\s*Script\s+[\w-]+\s*%\}/g, ';');
    try { new vm.Script(code, { filename: page + '#script' + n }); }
    catch (e) { throw new Error(page + ' script ' + n + ': ' + e.message + '\n' + String(e.stack).split('\n').slice(0, 3).join('\n')); }
  }
}

function write(page, src) {
  const out = inline(src);
  syntaxCheck(page, out);
  fs.writeFileSync(path.join(DIST, page), out, 'utf8');
  console.log('built dist/' + page + ' (' + Math.round(out.length / 1024) + ' KB)');
}

// The page itself plus every file its markers inline.
function inputsOf(page) {
  const src = fs.readFileSync(path.join(HERE, page), 'utf8');
  return [page].concat([...src.matchAll(MARKER)].map(m => m[2])).map(n => path.join(HERE, n));
}

function build() {
  fs.mkdirSync(DIST, { recursive: true });
  for (const page of PAGES) write(page, fs.readFileSync(path.join(HERE, page), 'utf8'));
  for (const v of VARIANTS.filter(v => PAGES.includes(v.from))) {
    let src = fs.readFileSync(path.join(HERE, v.from), 'utf8');
    for (const [a, b] of v.swaps) {
      const n = src.split(a).length - 1;
      if (n !== 1) throw new Error(v.to + ': "' + a + '" found ' + n + ' times in ' + v.from + ' (need exactly 1)');
      src = src.split(a).join(b);
    }
    write(v.to, src);
  }
}

if (PLAN) {
  const plan = PAGES.map(p => ({ src: path.join(HERE, p), out: path.join(DIST, p), page: p, inputs: inputsOf(p) }))
    .concat(VARIANTS.map(v => ({ src: null, out: path.join(DIST, v.to), page: v.from, inputs: inputsOf(v.from) })));
  process.stdout.write(JSON.stringify(plan));
} else {
  build();
}
