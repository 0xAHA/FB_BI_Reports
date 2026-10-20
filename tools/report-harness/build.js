#!/usr/bin/env node
// build.js — a BI report as a page a desktop Chrome can open: every Script /
// Style directive expanded from scripts/ (as Fishbowl does when it loads the
// report) and Fishbowl's browser bridge stubbed, answering runQuery from a
// fixture file instead of the database.
//
//   node build.js <report.htm> <fixture.js> [out.html]
//        [--scripts <dir>]        directive files from <dir> first, then scripts/
//        [--launch '<json>']      insert window.FB_LAUNCH as report_btn does
//        [--set <id>=<value>]     replace a report-setting block's text (the
//                                 text/plain block with that id), as Fishbowl
//                                 substitutes the setting; repeatable
//        [--prop <name>=<value>]  a system property getProperty() returns; repeatable
//
// The fixture is a JS/JSON array of [regex, rows] pairs: the first regex that
// matches a query (case-insensitive) answers it; anything else returns [].
// fixture.js captures one from the local Fishbowl server. The built page keeps
// every query in window.__sql and every openModule call in window.__opened.
// Out defaults to <out dir>/<report name>.html (config.js).
'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config.js');

function args(argv) {
  const o = { pos: [], set: [], prop: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scripts') o.scripts = argv[++i];
    else if (a === '--launch') o.launch = argv[++i];
    else if (a === '--set') o.set.push(argv[++i]);
    else if (a === '--prop') o.prop.push(argv[++i]);
    else o.pos.push(a);
  }
  return o;
}

function directive(kind, name, scriptsDir) {
  const ext = kind === 'Script' ? '.js' : '.css';
  for (const dir of [scriptsDir, path.join(cfg.REPO, 'scripts')]) {
    if (dir && fs.existsSync(path.join(dir, name + ext))) return fs.readFileSync(path.join(dir, name + ext), 'utf8');
  }
  console.warn('build: no ' + name + ext + ' for its directive (left empty)');
  return '';
}

function build(report, fixture, out, o) {
  o = o || {};
  let html = fs.readFileSync(report, 'utf8');
  // Directives: each by global replacement, as Fishbowl does.
  html = html.replace(/\{%\s*(Script|Style)\s+([A-Za-z0-9_-]+)\s*%\}/g, (m, kind, name) => directive(kind, name, o.scripts));
  for (const s of o.set || []) {
    const i = s.indexOf('='), id = s.slice(0, i), val = s.slice(i + 1);
    const re = new RegExp('(<script type="text/plain" id="' + id + '"[^>]*>)[\\s\\S]*?(</script>)');
    if (!re.test(html)) throw new Error('no report-setting block id="' + id + '"');
    html = html.replace(re, (m, a, b) => a + val + b);
  }
  const props = {};
  (o.prop || []).forEach(p => { const i = p.indexOf('='); props[p.slice(0, i)] = p.slice(i + 1); });
  const fx = fs.readFileSync(fixture, 'utf8');
  const stub = '<script>\n' +
    (o.launch ? 'window.FB_LAUNCH = ' + JSON.stringify(JSON.parse(o.launch)) + ';\n' : '') +
    'window.__sql = []; window.__opened = [];\n' +
    'const __fx = ' + fx + ';\n' +
    'const __props = ' + JSON.stringify(props) + ';\n' +
    'function __answer(sql) { window.__sql.push(String(sql)); for (const [re, rows] of __fx) if (new RegExp(re, "i").test(sql)) return JSON.parse(JSON.stringify(rows)); return []; }\n' +
    'window.runQueryAsync = async sql => __answer(sql);\n' +
    'window.runQuery = sql => JSON.stringify(__answer(sql));\n' +
    'window.currencyLocale = () => ({ locale: "en-AU", symbol: "$" });\n' +
    'window.getProperty = (n, d) => Object.prototype.hasOwnProperty.call(__props, n) ? __props[n] : (n === "DateFormatShort" ? "dd/MM/yyyy" : d);\n' +
    'window.getLocationGroupList = () => [1, 2, 3];\n' +
    'window.getUser = () => JSON.stringify({ id: 1, userName: "admin", firstName: "A", lastName: "D" });\n' +
    'window.hasUserAccess = () => true;\n' +
    'window.saveSettings = (k, v) => { sessionStorage.setItem("s:" + k, v); };\n' +
    'window.loadSettings = k => sessionStorage.getItem("s:" + k) || "";\n' +
    'window.openModule = (m, n) => window.__opened.push([m, n]);\n' +
    // Writes are never sent: each request is kept in window.__api and answered
    // with success (statusCode 1000), or with window.__apiAnswer(name, json) when a test sets one.
    'window.__api = [];\n' +
    'window.runApiRequest = (name, json) => { window.__api.push([name, json]); const a = window.__apiAnswer ? window.__apiAnswer(name, json) : null;\n' +
    '  if (a) return typeof a === "string" ? a : JSON.stringify(a); const rs = {}; rs[String(name).replace(/Rq$/, "Rs")] = { statusCode: 1000 }; return JSON.stringify(rs); };\n' +
    'window.runRestApiAsync = async req => { window.__api.push(["REST " + ((req && req.method) || "GET") + " " + (req && req.path), req && req.body]);\n' +
    '  return window.__apiAnswer ? window.__apiAnswer("REST", req) : {}; };\n' +
    '</script>';
  html = html.replace(/<meta charset="UTF-8"\s*\/?>/i, m => m + stub);
  out = out || path.join(cfg.out, path.basename(report).replace(/\.htm$/i, '') + '.html');
  fs.writeFileSync(out, html);
  return out;
}

module.exports = { build };
if (require.main === module) {
  const o = args(process.argv.slice(2));
  if (o.pos.length < 2) { console.error('usage: node build.js <report.htm> <fixture.js> [out.html] [--scripts dir] [--launch json] [--set id=value] [--prop name=value]'); process.exit(2); }
  const out = build(path.resolve(o.pos[0]), path.resolve(o.pos[1]), o.pos[2] && path.resolve(o.pos[2]), o);
  console.log('built ' + out + '  ->  ' + cfg.url(out) + ' (node serve.js)');
}
