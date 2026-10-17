#!/usr/bin/env node
// ab.js — before / after comparison of a report on the same fixture: A is one
// version (by default the file as committed: git HEAD), B another (by default
// the working copy). For each scenario it compares the SQL sent, the status
// line, the launch lock, the PDF view's sheets (their text, page count) and,
// for document output, window.FB_DOC. Use it to prove a refactor changed
// nothing, or to see exactly what a fix changed. Needs serve.js running.
//
//   node ab.js <report.htm> <fixture.js> [--a <file>|--a-rev <git rev>] [--b <file>]
//        [--a-scripts dir] [--b-scripts dir] [--launch CODE:id] [--steps steps.js]
//
//   --launch CODE:id   also run: launched for that record (CODE as in
//                      FB_LAUNCH.module), document output for it, and document
//                      output from another module (record documents)
//   --steps            steps run on the standalone scenario (both sides)
// Prints one JSON line per scenario and "same" / "DIFFERENT"; details and
// page-1 screenshots go to <out dir>/ab_<report>_*.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const cfg = require('./config.js');
const { build } = require('./build.js');
const { pdfView } = require('./run.js');

function args(argv) {
  const o = { pos: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--a', '--a-rev', '--b', '--a-scripts', '--b-scripts', '--launch', '--steps'].includes(a)) o[a.slice(2).replace('-', '_')] = argv[++i];
    else o.pos.push(a);
  }
  return o;
}
const scrub = s => String(s || '')
  .replace(/\d{1,2} \w+ \d{4} at \d{1,2}:\d{2}:\d{2}( GMT[+-]\d+)?/g, '<stamp>')
  .replace(/\d{1,2}\/\d{1,2}\/\d{2,4},? \d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?/gi, '<stamp>')
  .replace(/\d+ ms\b/g, '<ms>');

async function scenario(browser, page, launch, steps) {
  const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto(cfg.url(page));
  await p.waitForTimeout(1800);
  const r = {};
  if (launch && launch.output) {
    for (let i = 0; i < 120; i++) {
      const st = await p.evaluate(() => window.FB_DOC && window.FB_DOC.state);
      if (st && st !== 'loading') break;
      await p.waitForTimeout(250);
    }
    r.fbDoc = await p.evaluate(() => window.FB_DOC || null);
  } else {
    if (!launch && steps) await require(path.resolve(steps))(p);
    try { await pdfView(p); } catch (e) { r.pdfError = String(e.message).split('\n')[0]; }
    await p.waitForTimeout(300);
  }
  Object.assign(r, await p.evaluate(() => ({
    status: (document.getElementById('statusLine') || {}).textContent,
    banner: (document.getElementById('banner') || {}).textContent || '',
    launched: document.body.classList.contains('is-launched'),
    sheets: document.querySelectorAll('.fbdoc-sheet').length,
    text: [...document.querySelectorAll('.fbdoc-sheet')].map(s => s.innerText).join('\n=====\n'),
    sql: (window.__sql || []).map(s => s.replace(/\s+/g, ' ').trim())
  })));
  r.errs = errs;
  const paper = await p.$('.fbdoc-paper');
  const shot = page.replace(/\.html$/, '.png');
  if (paper) await paper.screenshot({ path: shot }); else await p.screenshot({ path: shot });
  await p.close();
  return r;
}

async function main() {
  const o = args(process.argv.slice(2));
  if (o.pos.length < 2) { console.error('usage: node ab.js <report.htm> <fixture.js> [--a file|--a-rev rev] [--b file] [--a-scripts dir] [--b-scripts dir] [--launch CODE:id] [--steps steps.js]'); process.exit(2); }
  const report = path.resolve(o.pos[0]), fixture = path.resolve(o.pos[1]);
  const name = path.basename(report).replace(/\.htm$/i, '');
  let aFile = o.a && path.resolve(o.a);
  if (!aFile) {
    const rel = path.relative(cfg.REPO, report).split(path.sep).join('/');
    aFile = path.join(cfg.out, 'ab_' + name + '_A_src.htm');
    fs.writeFileSync(aFile, execFileSync('git', ['show', (o.a_rev || 'HEAD') + ':' + rel], { cwd: cfg.REPO, maxBuffer: 64e6 }));
  }
  const bFile = o.b ? path.resolve(o.b) : report;
  const L = [null];
  if (o.launch) {
    const [code, id] = o.launch.split(':');
    const base = { v: 1, host: 'harness', module: code, moduleName: 'Test Module', id: +id };
    L.push({ tag: 'launch', obj: base }, { tag: 'output', obj: Object.assign({ output: 'pdf' }, base) },
      { tag: 'output-wrong', obj: { v: 1, host: 'harness', module: 'ZZZ', moduleName: 'Other', id: 1, output: 'pdf' } });
  }
  const { chromium } = cfg.playwright();
  const browser = await chromium.launch(cfg.launchOptions());
  const res = {};
  try {
    for (const l of L) {
      for (const side of ['A', 'B']) {
        const out = path.join(cfg.out, 'ab_' + name + '_' + side + '_' + (l ? l.tag : 'standalone') + '.html');
        build(side === 'A' ? aFile : bFile, fixture, out, { scripts: side === 'A' ? o.a_scripts : o.b_scripts, launch: l ? JSON.stringify(l.obj) : null });
        res[side + (l ? l.tag : 'standalone')] = await scenario(browser, out, l && l.obj, o.steps);
      }
    }
  } finally { await browser.close(); }
  let diff = 0;
  for (const l of L) {
    const t = l ? l.tag : 'standalone', A = res['A' + t], B = res['B' + t];
    const onlyA = A.sql.filter(s => !B.sql.includes(s)), onlyB = B.sql.filter(s => !A.sql.includes(s));
    const line = { scenario: t, status: [scrub(A.status), scrub(B.status)], launched: [A.launched, B.launched], sheets: [A.sheets, B.sheets],
      sameSheets: scrub(A.text) === scrub(B.text), fbDoc: [A.fbDoc && A.fbDoc.state, B.fbDoc && B.fbDoc.state],
      sqlOnlyA: onlyA.length, sqlOnlyB: onlyB.length, errors: [A.errs.length, B.errs.length] };
    const same = line.status[0] === line.status[1] && line.launched[0] === line.launched[1] && line.sheets[0] === line.sheets[1] && line.sameSheets &&
      line.fbDoc[0] === line.fbDoc[1] && !onlyA.length && !onlyB.length && !B.errs.length;
    if (!same) diff++;
    console.log(JSON.stringify(line) + (same ? '  same' : '  DIFFERENT'));
  }
  fs.writeFileSync(path.join(cfg.out, 'ab_' + name + '.json'), JSON.stringify(res, null, 1));
  console.log(diff ? diff + ' scenario(s) differ; details in ' + path.join(cfg.out, 'ab_' + name + '.json') : 'all scenarios the same');
  process.exitCode = diff ? 1 : 0;
}
main().catch(e => { console.error(e); process.exit(1); });
