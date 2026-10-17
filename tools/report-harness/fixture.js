#!/usr/bin/env node
// fixture.js — capture a fixture for build.js from the local Fishbowl server
// (tools/deploy/fishbowl.local.json, the deploy tool's REST session). It runs
// the page, takes the SQL it sent, answers each new query from the server, and
// repeats until no new query appears, so the fixture covers every query the
// page (and the steps) make. Only SELECTs are sent; anything else is refused.
// Needs serve.js running.
//
//   node fixture.js <report.htm> <out fixture.js> [steps.js]
//        [--launch '<json>'] [--set id=value] [--scripts dir] [--max-rows N] [--rounds N]
//
// Keys are the whole query as an anchored regex (whitespace runs as \s+), so
// near-identical queries stay apart. Edit the fixture by hand to add edge cases
// (keep a copy: <name>_edge.js), or loosen a key to a shorter regex.
'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config.js');
const { build } = require('./build.js');
const { run } = require('./run.js');

function keyOf(sql) {
  return '^\\s*' + sql.trim().split(/\s+/).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+') + '\\s*$';
}

async function capture(report, out, o) {
  const { withSession, loadConfig } = require(path.join(cfg.REPO, 'tools/deploy/fbdeploy.js'));
  const fbcfg = loadConfig();
  if (!fbcfg) throw new Error('no tools/deploy/fishbowl.local.json: fixture.js reads the local Fishbowl server through it');
  const tmpFx = path.join(cfg.out, path.basename(out) + '.tmp.js');
  const page = path.join(cfg.out, 'fx_' + path.basename(report).replace(/\.htm$/i, '') + '.html');
  return withSession(fbcfg, async sql => {
    const fx = [], seen = new Set();
    for (let round = 0; round < (o.rounds || 8); round++) {
      fs.writeFileSync(tmpFx, JSON.stringify(fx));
      build(report, tmpFx, page, o);
      const r = await run(page, { steps: o.steps });
      let added = 0;
      for (const q of r.sql) {
        const k = keyOf(q);
        if (seen.has(k) || /userproperties/i.test(q)) continue;
        seen.add(k);
        if (!/^\s*SELECT\b/i.test(q)) { console.warn('skipped (not a SELECT): ' + q.slice(0, 80)); continue; }
        let rows = await sql(q);
        if (o.maxRows && rows.length > o.maxRows) rows = rows.slice(0, o.maxRows);
        fx.push([k, rows]);
        added++;
        console.log('round ' + round + ': ' + rows.length + ' rows  ' + q.replace(/\s+/g, ' ').slice(0, 100));
      }
      console.log('status: ' + r.status + (r.logs.length ? ' | ' + r.logs.slice(0, 2).join(' | ') : ''));
      if (!added) break;
    }
    fs.writeFileSync(out, JSON.stringify(fx));
    try { fs.unlinkSync(tmpFx); } catch (_) {}
    console.log('wrote ' + out + ' (' + fx.length + ' queries)');
  });
}

if (require.main === module) {
  const a = process.argv.slice(2), o = { set: [], prop: [] }, pos = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--launch') o.launch = a[++i];
    else if (a[i] === '--set') o.set.push(a[++i]);
    else if (a[i] === '--scripts') o.scripts = a[++i];
    else if (a[i] === '--max-rows') o.maxRows = +a[++i];
    else if (a[i] === '--rounds') o.rounds = +a[++i];
    else pos.push(a[i]);
  }
  if (pos.length < 2) { console.error('usage: node fixture.js <report.htm> <out fixture.js> [steps.js] [--launch json] [--set id=value] [--max-rows N]'); process.exit(2); }
  o.steps = pos[2];
  capture(path.resolve(pos[0]), path.resolve(pos[1]), o).catch(e => { console.error(e.stack || e); process.exit(1); });
}
