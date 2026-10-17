// harness.js — serve the BUILT paperwork pages with Fishbowl's bridge stubbed
// and runQuery proxied, read-only, to a real Fishbowl MySQL database.
//
//   node build.js && node tests/harness.js            -> http://127.0.0.1:8732/
//   /SOReport.htm?so=<id>&invoice=true&print=Letter  substitutes the report-
//   setting tokens the way Fishbowl does; omit them to test the fallbacks.
//   Any page: set.<CODE>=value replaces that page's first <CODE> setting token
//   (e.g. set.PO=12, set.PICK=40, set.CHECK=true). launch=<json> inserts the
//   FB_LAUNCH script report_btn would.
//
// DB: FB_DB_HOST/PORT/USER/PASSWORD/NAME, else the mcp_server_mysql block in
// ~/.claude.json (demodb). mysql2 from MYSQL2_PATH or the npx cache.
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');                 // Paperwork_POC
const REPO = path.resolve(ROOT, '..', '..');               // FB_BI_Reports
const PORT = +(process.env.PORT || 8732);
const MYSQL2 = process.env.MYSQL2_PATH ||
  'C:/Users/andrew.doenau/AppData/Local/npm-cache/_npx/57e5b9c57ed85305/node_modules/mysql2/promise';

function dbConfig() {
  if (process.env.FB_DB_PASSWORD) {
    return { host: process.env.FB_DB_HOST || '127.0.0.1', port: +(process.env.FB_DB_PORT || 3306),
             user: process.env.FB_DB_USER || 'gone', password: process.env.FB_DB_PASSWORD, database: process.env.FB_DB_NAME || 'demodb' };
  }
  const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
  for (const k of Object.keys(cfg.projects || {})) {
    const s = (cfg.projects[k].mcpServers || {}).mcp_server_mysql;
    if (s && s.env) return { host: s.env.MYSQL_HOST || '127.0.0.1', port: +(s.env.MYSQL_PORT || 3306),
                              user: s.env.MYSQL_USER || 'gone', password: s.env.MYSQL_PASS, database: process.env.FB_DB_NAME || 'demodb' };
  }
  throw new Error('No DB config: set FB_DB_* env vars');
}

// Browser-side stubs for the Fishbowl bridge, behaving like the 26.9 client:
// runQuery returns a JSON string, runQueryAsync an array; failures reject with
// a BARE STRING (not an Error). The object form {query, parameters} goes to the
// server's runSqlQuery, which is refused unless the company "Data Access API"
// setting is on — emulated as refused unless HARNESS_BIND=1.
const BIND_ALLOWED = process.env.HARNESS_BIND === '1';
const STUBS = `<script>
(function () {
  var BIND = ${BIND_ALLOWED};
  var REFUSED = 'Data access through the API is disabled. Enable it in the Company module.';
  function post(o) { var x = new XMLHttpRequest(); x.open('POST', '/sql', false); x.send(JSON.stringify(o)); if (x.status !== 200) throw x.responseText; return x.responseText; }
  function norm(q) {
    if (typeof q === 'string') return { query: q };
    if (q && q.parameters && q.parameters.length && !BIND) throw REFUSED;
    return q;
  }
  window.runQuery = function (q) { return post(norm(q)); };
  window.runQueryAsync = async function (q) {
    var o = norm(q);
    var r = await fetch('/sql', { method: 'POST', body: JSON.stringify(o) });
    if (!r.ok) throw await r.text(); return r.json();
  };
  function get(u) { var x = new XMLHttpRequest(); x.open('GET', u, false); x.send(); return x.responseText; }
  window.getCompanyAddress = function (lg, c) { return get('/companyAddress?lg=' + encodeURIComponent(lg) + '&country=' + (c ? 1 : 0)); };
  window.getProperty = function (n, d) { var v = get('/prop?name=' + encodeURIComponent(n)); return v === '' ? (d == null ? '' : d) : v; };
  window.getUser = function () { return JSON.stringify({ userName: 'admin', firstName: 'Admin', lastName: 'User' }); };
  window.hasUserAccess = function () { return true; };
  window.getLocationGroupList = function () { return [1]; };
  var store = {};
  window.loadSettings = function (k) { return store[k] || ''; };
  window.saveSettings = function (k, v) { store[k] = v; };
  window.loadReportData = function () { return ''; };
  window.saveReportData = function () {};
  window.currencyLocale = function () { return { locale: 'en-AU', symbol: '$' }; };
  window.openModule = function (m, i) { console.log('openModule', m, i); };
  window.runApiRequest = window.runRestApiAsync = function () { throw new Error('read-only harness'); };
})();
</script>`;

const SETTING_TOKENS = { so: /\$SO\{[^}]*\}/, invoice: /\$CHECK\{Invoice[^}]*\}/, print: /\$PRINT\{[^}]*\}/ };

function servePage(file, query) {
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace(/\{%\s*Script\s+([\w-]+)\s*%\}/g, (m, n) => fs.readFileSync(path.join(REPO, 'scripts', n + '.js'), 'utf8'));
  html = html.replace(/\{%\s*Style\s+([\w-]+)\s*%\}/g, (m, n) => fs.readFileSync(path.join(REPO, 'scripts', n + '.css'), 'utf8'));
  for (const k of Object.keys(SETTING_TOKENS)) {
    if (query.has(k)) html = html.replace(SETTING_TOKENS[k], query.get(k));
  }
  for (const [k, v] of query) {
    const m = /^set\.([A-Z][A-Z0-9_]*)$/.exec(k);
    if (m) html = html.replace(new RegExp('\\$' + m[1] + '\\{[^}]*\\}'), () => v);
  }
  // launch=<json>: the FB_LAUNCH script the report_btn plugin inserts after <head>.
  if (query.has('launch')) html = insertLaunch(html, JSON.parse(query.get('launch')));
  return html.replace(/<meta charset="UTF-8">/i, m => m + '\n' + STUBS);
}

// Mirrors report_btn's AppLauncher.insertLaunch: after the first head tag that is
// not inside a comment (else at the top), and the same encoding: no "<" (cannot
// close the script), no "$" (cannot form a setting token for Fishbowl's
// parameter substitution).
function insertLaunch(html, payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\$/g, '\\u0024');
  const tag = '<script>window.FB_LAUNCH=' + json + ';</script>';
  const head = /<head(\s[^>]*)?>/gi;
  for (let m; (m = head.exec(html));) {
    if (html.lastIndexOf('<!--', m.index) <= html.lastIndexOf('-->', m.index)) {
      const at = m.index + m[0].length;
      return html.slice(0, at) + tag + html.slice(at);
    }
  }
  return tag + html;
}

function lowerKeys(rows) {
  return rows.map(r => {
    const o = {};
    for (const k of Object.keys(r)) {
      let v = r[k];
      if (Buffer.isBuffer(v)) v = v.length === 1 ? String.fromCharCode(v[0]) : v.toString('utf8');
      o[k.toLowerCase()] = v;
    }
    return o;
  });
}

async function start(port) {
  const mysql = require(MYSQL2);
  const pool = mysql.createPool(Object.assign(dbConfig(), { dateStrings: true, connectionLimit: 4, decimalNumbers: false }));
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    try {
      if (req.method === 'POST' && u.pathname === '/sql') {
        let body = ''; for await (const ch of req) body += ch;
        const o = JSON.parse(body);
        if (!/^\s*(select|show)\b/i.test(o.query)) { res.writeHead(400); return res.end('read-only harness: SELECT only'); }
        const [rows, fields] = await pool.query(o.query, o.parameters || []);
        // Fishbowl's server reads results through the MariaDB driver and calls
        // Class.forName(getColumnClassName()) per column. A string-typed column in
        // the binary charset (63) — a bare NULL literal, CAST(... AS BINARY) —
        // reports "byte[]", which fails, and the client gets this generic error.
        const BINARY_STRING_TYPES = [6, 15, 253, 254];   // NULL, VARCHAR, VAR_STRING, STRING
        const bad = (fields || []).filter(f => f.characterSet === 63 && BINARY_STRING_TYPES.includes(f.columnType));
        if (bad.length) {
          res.writeHead(500);
          return res.end('An unknown error has occurred. [harness: binary string column(s) ' + bad.map(f => f.name).join(', ') + ']');
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(lowerKeys(rows)));
      }
      if (u.pathname === '/prop') {
        const [rows] = await pool.query('SELECT sysValue AS v FROM sysproperties WHERE sysKey = ?', [u.searchParams.get('name')]);
        res.writeHead(200); return res.end(rows.length ? String(rows[0].v) : '');
      }
      if (u.pathname === '/companyAddress') {
        // Approximates Fishbowl's getCompanyReportAddress: the location group's
        // company address, else the company default.
        const lg = +u.searchParams.get('lg') || 0;
        const [rows] = await pool.query(
          'SELECT a.address, a.city, st.code AS state, a.zip, cc.name AS country FROM address a ' +
          'JOIN company c ON c.id = 1 AND a.accountId = c.accountId ' +
          'LEFT JOIN stateconst st ON st.id = a.stateId LEFT JOIN countryconst cc ON cc.id = a.countryId ' +
          'ORDER BY (a.locationGroupId = ?) DESC, (a.defaultFlag + 0) DESC, a.id LIMIT 1', [lg]);
        const a = rows[0];
        const txt = a ? [a.address, [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')]
          .concat(u.searchParams.get('country') === '1' && a.country ? [a.country] : []).filter(Boolean).join('\n') : '';
        res.writeHead(200); return res.end(txt);
      }
      if (u.pathname === '/' ) {
        res.writeHead(200, { 'content-type': 'text/html' });
        const pages = fs.readdirSync(path.join(ROOT, 'dist')).filter(n => /\.htm$/.test(n)).sort();
        return res.end(pages.map(n => '<a href="/' + n + '">' + n + '</a>').join('<br>'));
      }
      const file = path.join(ROOT, 'dist', path.basename(u.pathname));
      if (/\.htm$/.test(file) && fs.existsSync(file)) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(servePage(file, u.searchParams));
      }
      res.writeHead(404); res.end('not found');
    } catch (e) {
      res.writeHead(500); res.end(String(e && e.message || e));
    }
  });
  await new Promise(r => server.listen(port == null ? PORT : port, '127.0.0.1', r));
  return { server, pool, url: 'http://127.0.0.1:' + server.address().port,
           close: async () => { server.close(); await pool.end(); } };
}

module.exports = { start };
if (require.main === module) start().then(h => console.log('harness on ' + h.url));
