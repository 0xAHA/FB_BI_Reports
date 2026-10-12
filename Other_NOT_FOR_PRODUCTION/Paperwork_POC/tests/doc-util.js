// doc-util.js — shared helpers for the paperwork render tests: build, serve the
// BUILT pages through harness.js (runQuery proxied read-only to MySQL), open a
// page in headless Chrome, and check every sheet plus the printed PDF.
//
//   const U = require('./doc-util.js');
//   const T = U.suite(['POReport.htm']);       // builds just these pages; registers before/after
//   test('…', async () => {
//     const page = await T.open('POReport.htm', 'set.PO=12');
//     await T.check(page, 'po-12', { size: U.A4, pg: '.po-foot .pg', last: '.po-last', tables: ['items'] });
//   });
//
// check() options:
//   size    [w, h] pt expected for the PDF MediaBox
//   pg      selector of the "Page X of Y" element in each sheet's footer
//   last    selector of the last-page footer root (only on the last sheet); null to skip
//   tables  data-fbdoc-table names whose colgroup must sum to the content width
//
// Needs: Chrome installed, playwright-core (PLAYWRIGHT_CORE_PATH or the npx
// cache), mysql2 + DB config (see harness.js). PDFs land in FBDOC_OUT.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PWC = process.env.PLAYWRIGHT_CORE_PATH ||
  'C:/Users/andrew.doenau/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright-core';
const H = require('./harness.js');
const OUT = process.env.FBDOC_OUT || path.join(os.tmpdir(), 'fbdoc-render');
const A4 = [595.28, 841.89], LETTER = [612, 792];

// Runs in the page: every sheet's body fits, blocks in order and each placed once,
// a column header on every table, "Page X of Y", the last-page footer only on the
// last sheet, and table colgroups that sum to the content width.
function inspect(o) {
  const sheets = Array.from(document.querySelectorAll('#docCanvas .fbdoc-sheet'));
  const errs = [], seen = [];
  sheets.forEach((s, i) => {
    const body = s.querySelector('.fbdoc-body');
    if (body.scrollHeight > body.clientHeight + 1) errs.push('sheet ' + (i + 1) + ': body overflows ' + (body.scrollHeight - body.clientHeight) + 'px');
    const br = body.getBoundingClientRect();
    s.querySelectorAll('.fbdoc-body [data-fbdoc-block]').forEach(b => {
      const r = b.getBoundingClientRect();
      if (r.bottom > br.bottom + 1) errs.push('sheet ' + (i + 1) + ': block ' + b.dataset.fbdocBlock + ' clipped');
      seen.push(+b.dataset.fbdocBlock);
    });
    s.querySelectorAll('table[data-fbdoc-table]').forEach(t => { if (!t.tHead) errs.push('sheet ' + (i + 1) + ': table without column header'); });
    if (o.pg) {
      const pg = (s.querySelector(o.pg) || {}).textContent;
      if (pg !== 'Page ' + (i + 1) + ' of ' + sheets.length) errs.push('sheet ' + (i + 1) + ': footer reads "' + pg + '"');
    }
    const last = i === sheets.length - 1;
    if (o.last && !!s.querySelector(o.last) !== last) errs.push('sheet ' + (i + 1) + ': last-page footer ' + (last ? 'missing' : 'misplaced'));
    if (!last && !s.querySelector('.fbdoc-body [data-fbdoc-block]')) errs.push('sheet ' + (i + 1) + ': empty non-last sheet');
  });
  for (let k = 1; k < seen.length; k++) if (seen[k] < seen[k - 1]) errs.push('block order ' + seen[k - 1] + ' > ' + seen[k]);
  const total = (window.FBDocApp.lastDoc.blocks || []).length;
  const uniq = new Set(seen).size;
  if (uniq !== total) errs.push('blocks placed ' + uniq + ' of ' + total);
  const cw = FBDoc.last.geometry.CWpt;
  (o.tables || []).forEach(name => {
    document.querySelectorAll('#docCanvas table[data-fbdoc-table="' + name + '"]').forEach(t => {
      const sum = Array.from(t.querySelectorAll('col')).reduce((a, c) => a + parseFloat(c.style.width), 0);
      if (Math.abs(sum - cw) > 0.05) errs.push(name + ' colgroup ' + sum.toFixed(2) + 'pt != content ' + cw.toFixed(2) + 'pt');
    });
  });
  return { sheets: sheets.length, errs: errs, warnings: FBDoc.last.warnings, splits: seen.length - uniq };
}

async function pdf(page, name) {
  // Margins as the BI Report module applies them (Chromium's default 0.4in).
  const buf = await page.pdf({ preferCSSPageSize: true, printBackground: true,
    margin: { top: '0.4in', right: '0.4in', bottom: '0.4in', left: '0.4in' } });
  fs.writeFileSync(path.join(OUT, name + '.pdf'), buf);
  const s = buf.toString('latin1');
  const pages = (s.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  const mb = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(s);
  return { pages, w: mb ? +mb[1] : 0, h: mb ? +mb[2] : 0 };
}

// Lay the page out as the print path does (print media, viewport = printable
// width): anything wider than the printable area makes Chromium shrink the whole
// page to fit.
async function printFits(page, name) {
  const W = await page.evaluate(() => FBDoc.last.geometry.W);
  const vp = page.viewportSize();
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({ width: Math.floor(W), height: vp.height });
  const r = await page.evaluate(() => {
    const sw = document.documentElement.scrollWidth;
    const sheet = document.querySelector('.fbdoc-sheet').getBoundingClientRect();
    const wide = Array.from(document.querySelectorAll('body *')).filter(e => {
      const b = e.getBoundingClientRect(); return b.width > 0 && b.right > window.innerWidth + 1;
    }).slice(0, 5).map(e => e.className || e.tagName);
    return { sw, sheetW: sheet.width, sheetL: sheet.left, wide };
  });
  await page.emulateMedia({ media: null });   // clear the emulation (page.pdf must use print media)
  await page.setViewportSize(vp);
  assert.ok(r.sw <= Math.floor(W) + 1, name + ': print layout ' + r.sw + 'px wider than printable ' + W.toFixed(1) + 'px: ' + r.wide.join(','));
  assert.ok(Math.abs(r.sheetW - W) < 1 && Math.abs(r.sheetL) < 1, name + ': sheet not at 100% in print (' + r.sheetW + ' @ ' + r.sheetL + ')');
}

async function rendered(page) {
  await page.waitForFunction(() => /page|Error|failed/i.test(document.getElementById('statusLine').textContent), null, { timeout: 30000 });
  const status = await page.textContent('#statusLine');
  if (/Error|failed/i.test(status)) throw new Error('report: ' + status);
  return status;
}

// Registers before/after hooks; returns the helpers bound to the server + browser.
function suite(pages) {
  const { chromium } = require(PWC);
  const ctx = {};
  test.before(async () => {
    execFileSync(process.execPath, [path.join(__dirname, '..', 'build.js')].concat(pages || []));
    fs.mkdirSync(OUT, { recursive: true });
    ctx.h = await H.start(0);
    ctx.browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', headless: true });
  });
  test.after(async () => { if (ctx.browser) await ctx.browser.close(); if (ctx.h) await ctx.h.close(); });

  return {
    get url() { return ctx.h.url; },
    // Open a built page and wait for its first render (or 'Pick …' when expectEmpty).
    async open(file, query, opts) {
      const page = await ctx.browser.newPage({ viewport: { width: 1280, height: 1000 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(ctx.h.url + '/' + file + (query ? '?' + query : ''));
      if (opts && opts.expectEmpty) {
        await page.waitForFunction(() => /^Pick /.test(document.getElementById('statusLine').textContent), null, { timeout: 30000 });
      } else await rendered(page);
      page._errors = errors;
      return page;
    },
    rendered: rendered,
    async check(page, name, o) {
      o = o || {};
      await printFits(page, name);
      const r = await page.evaluate(inspect, { pg: o.pg || null, last: o.last === undefined ? null : o.last, tables: o.tables || [] });
      assert.deepEqual(r.errs, [], name + ': ' + r.errs.join('; '));
      assert.deepEqual(page._errors, [], name + ': page errors');
      const p = await pdf(page, name);
      assert.equal(p.pages, r.sheets, name + ': PDF pages ' + p.pages + ' vs sheets ' + r.sheets);
      if (o.size) assert.ok(Math.abs(p.w - o.size[0]) < 2 && Math.abs(p.h - o.size[1]) < 2, name + ': MediaBox ' + p.w + 'x' + p.h);
      return r;
    },
    // Query the test database directly (rows with lower-case keys), e.g. to pick test records.
    async sql(text, params) {
      const [rows] = await ctx.h.pool.query(text, params || []);
      return rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v])));
    }
  };
}

// FB_LAUNCH query string for T.open (as report_btn inserts it).
function launch(o) { return 'launch=' + encodeURIComponent(JSON.stringify(Object.assign({ v: 1, host: 'test' }, o))); }

module.exports = { suite, launch, A4, LETTER, OUT };
