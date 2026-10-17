#!/usr/bin/env node
// run.js — open a built page in headless Chrome, run optional steps, print what
// it did as JSON: status line, banner, console errors and page errors, the SQL
// it sent, the openModule calls, the PDF view's page count. Needs serve.js running.
//
//   node run.js <built.html> [steps.js] [--shot out.png] [--pdf] [--wide]
//     steps.js   module.exports = async page => { … }  (playwright page)
//     --pdf      switch to the PDF view first and wait for its pages
//     --wide     1600 px wide window (default 1400 x 820)
'use strict';
const path = require('path');
const cfg = require('./config.js');

async function run(file, o) {
  o = o || {};
  const { chromium } = cfg.playwright();
  const b = await chromium.launch(cfg.launchOptions());
  try {
    const p = await b.newPage({ viewport: { width: o.wide ? 1600 : 1400, height: 820 } });
    const logs = [];
    p.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/Failed to load resource/.test(m.text())) logs.push(m.type() + ': ' + m.text()); });
    p.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
    await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
    await p.goto(cfg.url(file));
    await p.waitForTimeout(1500);
    if (o.pdf) await pdfView(p);
    if (o.steps) await require(path.resolve(o.steps))(p);
    const info = await p.evaluate(() => ({
      status: (document.getElementById('statusLine') || {}).textContent,
      banner: (document.getElementById('banner') || {}).textContent || '',
      pdf: (document.querySelector('.fbdoc-vb-info') || {}).textContent || '',
      sheets: document.querySelectorAll('.fbdoc-sheet').length,
      fbDoc: window.FB_DOC || null,
      sql: (window.__sql || []).map(s => s.replace(/\s+/g, ' ').trim()),
      opened: window.__opened || []
    }));
    if (o.shot) await p.screenshot({ path: o.shot });
    return Object.assign({ logs }, info);
  } finally { await b.close(); }
}

/** Switch a page to its PDF view (fb-doc's App / PDF toggle) and wait for the pages. */
async function pdfView(p) {
  const on = await p.evaluate(() => { const a = document.querySelector('.fbdoc-toggle .active'); return a && a.getAttribute('data-view'); });
  if (on === null) return false;
  if (on !== 'pdf') await p.click('.fbdoc-toggle [data-view="pdf"]');
  await p.waitForFunction(() => {
    const t = (document.querySelector('.fbdoc-vb-info') || {}).textContent || '';
    return (/page/.test(t) || /Nothing/.test((document.querySelector('.fbdoc-view-canvas') || {}).textContent || '')) && !document.querySelector('.fbdoc-busy');
  }, null, { timeout: 90000 });
  return true;
}

module.exports = { run, pdfView };
if (require.main === module) {
  const a = process.argv.slice(2), o = {};
  const pos = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--shot') o.shot = a[++i];
    else if (a[i] === '--pdf') o.pdf = true;
    else if (a[i] === '--wide') o.wide = true;
    else pos.push(a[i]);
  }
  if (!pos[0]) { console.error('usage: node run.js <built.html> [steps.js] [--shot out.png] [--pdf] [--wide]'); process.exit(2); }
  o.steps = pos[1];
  run(pos[0], o).then(r => console.log(JSON.stringify(r, null, 1))).catch(e => { console.error(e); process.exit(1); });
}
