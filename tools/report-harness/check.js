#!/usr/bin/env node
// check.js — static checks on BI reports before they deploy:
//   - the head tags (fb-launch, fb-folder, fb-origin) at most once each, in <head>
//   - every Script / Style directive and every report-setting token exactly once
//     (Fishbowl substitutes them by global text replacement)
//   - window.FB_REPORT with a key of 31 characters or fewer
//   - no control characters (Fishbowl strips 0x00-0x1F from inline scripts)
//   - every inline script parses
//   - a REPORT-chrome page has the company-defaults admin texts (warning only)
//
//   node check.js <report.htm>…      exit 1 when anything fails
'use strict';
const fs = require('fs');

const DOLLAR = String.fromCharCode(36);                    // so this file holds no token literal
const TOKEN_RE = new RegExp('\\' + DOLLAR + '(SO|PO|MO|WO|TO|PICK|SHIP|RECEIPT|PART|PROD|BOM|CUST|CG|VEND|CAR|CLASS|USER|CHECK|TEXT|NUM|QTY|MONEY|DATE|RANGE|COLOR|LG|PRINT)\\{[^}]*\\}', 'g');
const DIRECTIVE_RE = new RegExp('\\{' + '%\\s*(Script|Style)\\s+([A-Za-z0-9_-]+)\\s*%' + '\\}', 'g');

function check(file) {
  const s = fs.readFileSync(file, 'utf8');
  const out = [], bad = [];
  const headStart = s.search(/<head[\s>]/i), headEnd = s.indexOf('</head>');
  const head = headStart >= 0 ? s.slice(headStart, headEnd) : '';
  const meta = n => { const m = new RegExp('<meta name="' + n + '" content="([^"]*)"').exec(head); return m ? m[1] : null; };
  out.push('launch=' + meta('fb-launch') + ' folder=' + meta('fb-folder') + ' origin=' + meta('fb-origin'));
  out.push('description=' + meta('description'));
  ['fb-launch', 'fb-folder', 'fb-origin'].forEach(n => {
    const c = (s.match(new RegExp('name="' + n + '"', 'g')) || []).length;
    if (c > 1) bad.push(n + ' tag written ' + c + ' times');
    if (c === 1 && meta(n) === null) bad.push(n + ' tag outside <head>');
  });
  const id = /key:\s*'([^']*)',(?:\s*\/\/[^\n]*)?\s*name:\s*('([^']*)'|null),(?:\s*\/\/[^\n]*)?\s*build:\s*'([^']*)'/.exec(s);
  if (!id) bad.push('no window.FB_REPORT { key, name, build }');
  else {
    out.push('key=' + id[1] + ' name=' + id[2] + ' build=' + id[4]);
    if (id[1].length > 31) bad.push('FB_REPORT.key longer than 31 characters');
  }
  const counts = {};
  (s.match(DIRECTIVE_RE) || []).forEach(d => { counts[d] = (counts[d] || 0) + 1; });
  (s.match(TOKEN_RE) || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
  Object.keys(counts).forEach(k => { if (counts[k] !== 1) bad.push(k + ' appears ' + counts[k] + ' times'); });
  out.push('directives / tokens: ' + Object.keys(counts).length);
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(s)) bad.push('control character in the file');
  const re = /<script(?![^>]*\bsrc=)(?![^>]*type="text\/plain")[^>]*>([\s\S]*?)<\/script>/gi;
  let m, n = 0;
  while ((m = re.exec(s))) {
    n++;
    const body = m[1].replace(DIRECTIVE_RE, '');
    try { new Function(body); } catch (e) { bad.push('script ' + n + ' does not parse: ' + e.message); }
  }
  if (/class="rpt-page"/.test(s) && !/each time this report opens/.test(s)) out.push('warning: REPORT chrome without the company-defaults admin text');
  return { file, out, bad };
}

module.exports = { check };
if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: node check.js <report.htm>…'); process.exit(2); }
  let fail = 0;
  for (const f of files) {
    const r = check(f);
    console.log('== ' + f + '\n   ' + r.out.concat(r.bad.map(b => '!! ' + b)).join('\n   '));
    if (r.bad.length) fail++;
  }
  process.exitCode = fail ? 1 : 0;
}
