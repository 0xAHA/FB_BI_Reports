#!/usr/bin/env node
// ============================================================================
//  tools/deploy/fbdeploy.js — write reports straight into a Fishbowl server
// ============================================================================
//
// Pushes a repo source into the Fishbowl database over REST, so the next time
// the report is opened in the client it runs the new code. No export, no
// import, no client.
//
//   *.htm          -> biscript (typeId 10, Page) + its bireport row
//   scripts/*.js   -> biscript (typeId 20, Script)
//   scripts/*.css  -> biscript (typeId 30, Style)
//
// The record is found by its Fishbowl name: FB_REPORT.name for a report, the
// file's base name for a shared script (fb-lib, fb-styles, ...).
//
// THE ENDPOINT. GET /api/unsafe/deprecated/data-query runs the SQL in the
// request body. It answers 403 "Unsafe REST API." unless the sysproperty
// FbPartnerApi is true, and the server only accepts statements that START with
// SELECT, UPDATE or INSERT. DELETE is rejected, so this tool can never remove
// a record or revoke access; do that in the client. Writes go straight to the
// tables, so Fishbowl's own history (biscript_aud etc.) gets no row, and the
// response says nothing about success: every write is read back and compared.
//
// CONFIRMATION. A record is overwritten without asking only when Fishbowl
// still holds exactly what this tool last wrote there. Anything else (edited
// in the client's BI editor since, or never deployed from here) is reported
// as "needs-confirm" and left alone until the user agrees and --force is
// passed; --force backs the Fishbowl copy up to tools/deploy/backups/ first.
// An update also bumps dateLastModified (the Hibernate @Version), so a client
// editor still holding the old copy fails to save instead of overwriting it.
//
// OPT-IN. The edit hook deploys only files whose deploy target (targets.js)
// includes Fishbowl. targets.js asks the user about an undecided file, and
// its answer does the first deploy (with --create).
//
// BUILT PAGES. A page with a build step (built.js) deploys its built page,
// and the hook also redeploys the opted-in pages built from an edited file:
// every page that inlines it, and the variants built from an edited page.
//
// The server and login are per machine, in the gitignored
// tools/deploy/fishbowl.local.json:
//   { "server": "http://localhost:2456", "username": "...", "password": "...",
//     "appName": "Claude BI Dev", "appId": "claude-bi-dev-2" }
// FB_SERVER / FB_USERNAME / FB_PASSWORD / FB_MFA_CODE override it. No config =
// no-op, so other clones are unaffected.
//
// USAGE
//   node tools/deploy/fbdeploy.js <file> [...]           update existing records
//   node tools/deploy/fbdeploy.js --create <file>        also create missing ones
//   node tools/deploy/fbdeploy.js --access <groups|all> <file>   grant View (Pages)
//   node tools/deploy/fbdeploy.js --force <file>         overwrite after the user agreed
//   node tools/deploy/fbdeploy.js --rename <old> --to <new> [--type Page|Script|Style]
//        rename a record in place (biscript, and bireport for a Page), so its
//        id, access rows and saved settings survive; refuses if <new> is taken
//   node tools/deploy/fbdeploy.js --status [file ...]    compare repo with Fishbowl
//   node tools/deploy/fbdeploy.js --dry ...              say what would change
//   node tools/deploy/fbdeploy.js --hook                 Claude Code hook (stdin JSON)
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { identityOf, descriptionOf, isPlaceholder } = require('./publish.js');
const built = require('./built.js');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG = path.join(__dirname, 'fishbowl.local.json');
const STATE = path.join(__dirname, 'fishbowl.state.json');   // last hash written, per record
const BACKUPS = path.join(__dirname, 'backups');             // Fishbowl copies we overwrote
const UNSAFE = '/api/unsafe/deprecated/data-query';
const TYPE_ID = { Page: 10, Script: 20, Style: 30 };
const EXT = { Page: '.htm', Script: '.js', Style: '.css' };
const BOM = new RegExp('^' + String.fromCharCode(0xFEFF));

function rel(p) { return path.relative(ROOT, path.resolve(p)).split(path.sep).join('/'); }
function readJson(f, dflt) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return dflt; } }

function loadConfig() {
    const file = readJson(CONFIG, null);
    if (!file && !process.env.FB_SERVER) return null;
    // The default app is the one already approved on the dev server. A new
    // appId/appName pair must be approved once in Setup > Settings > Integrated Apps.
    const c = Object.assign({ appName: 'Claude BI Dev', appId: 'claude-bi-dev-2',
        appDescription: 'Dev testing' }, file || {});
    if (process.env.FB_SERVER) c.server = process.env.FB_SERVER;
    if (process.env.FB_USERNAME) c.username = process.env.FB_USERNAME;
    if (process.env.FB_PASSWORD) c.password = process.env.FB_PASSWORD;
    if (process.env.FB_MFA_CODE) c.mfaCode = process.env.FB_MFA_CODE;
    c.server = String(c.server || 'http://localhost:2456').replace(/\/+$/, '');
    return c;
}

/* { name, type } for a repo file, or null. Reports carry FB_REPORT.name; any
   shared script is named after its file, the name its directive resolves by. */
function identity(file) {
    const id = identityOf(file);
    if (id) return id;
    const m = /^scripts\/([^/]+)\.(js|css)$/.exec(rel(file));
    return m ? { name: m[1], type: m[2] === 'js' ? 'Script' : 'Style' } : null;
}

/* What Fishbowl stores: the source verbatim (or its built page, built.js), BOM
   dropped, CRLF throughout, the same normalisation fbwrap applies to an import. */
function payload(file) {
    return built.text(file).replace(BOM, '').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
}
function sha256(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }

// SQL literals. Bodies travel as base64 so no quote, backslash or sql_mode can
// break them. Names stay plain quoted literals: a CONVERT() result would carry
// its own collation and can clash with the column's in a WHERE.
function blob(s) { return "CONVERT(FROM_BASE64('" + Buffer.from(String(s), 'utf8').toString('base64') + "') USING utf8mb4)"; }
function q(s) {
    s = String(s);
    if (/[\\\x00-\x1f]/.test(s)) throw new Error('unsupported character in ' + JSON.stringify(s));
    return "'" + s.replace(/'/g, "''") + "'";
}

// ---------------------------------------------------------------- REST client
function request(cfg, method, p, opts) {
    opts = opts || {};
    const u = new URL(p, cfg.server + '/');
    const lib = u.protocol === 'https:' ? require('https') : require('http');
    const body = opts.body == null ? null : Buffer.from(opts.body, 'utf8');
    const headers = { Accept: 'application/json' };
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    if (body) { headers['Content-Type'] = opts.type; headers['Content-Length'] = body.length; }
    // node's http, not fetch: the data-query endpoint is a GET that reads its
    // SQL from the body, and fetch refuses a GET with a body.
    return new Promise((resolve, reject) => {
        const req = lib.request(u, { method, headers, timeout: cfg.timeout || 60000 }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers,
                text: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('timeout', () => req.destroy(new Error(method + ' ' + p + ' timed out')));
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}
function errText(r) {
    try { const j = JSON.parse(r.text); return j.message || j.detail || j.title || r.text; } catch (_) { return r.text; }
}

async function login(cfg) {
    if (!cfg.username || !cfg.password) throw new Error('no username/password in ' + rel(CONFIG));
    const body = { appName: cfg.appName, appDescription: cfg.appDescription, appId: cfg.appId,
        username: cfg.username, password: cfg.password };
    if (cfg.mfaCode) body.mfaCode = cfg.mfaCode;
    const r = await request(cfg, 'POST', '/api/login', { body: JSON.stringify(body), type: 'application/json' });
    if (r.status === 200) {
        const j = JSON.parse(r.text);
        if (j.token) return j.token;
    }
    // MFA arrives as a response header, not in the body.
    if (String(r.headers.mfa || '').toLowerCase() === 'required') {
        throw new Error('user ' + cfg.username + ' has MFA on: set FB_MFA_CODE, or deploy as a user without MFA');
    }
    throw new Error('login failed (' + r.status + '): ' + errText(r));
}

/* Logs in, hands fn a sql(text) -> rows function, always logs out. */
async function withSession(cfg, fn) {
    const token = await login(cfg);
    const sql = async text => {
        const r = await request(cfg, 'GET', UNSAFE, { token, body: text, type: 'application/sql; charset=UTF-8' });
        if (r.status === 403) throw new Error('the server refused the unsafe endpoint (' + errText(r) +
            '). Is the FbPartnerApi sysproperty true?');
        if (r.status !== 200) throw new Error('SQL failed (' + r.status + '): ' + errText(r));
        const rows = r.text ? JSON.parse(r.text) : [];
        // runQuery lowercases keys; REST returns the column labels as written.
        return (Array.isArray(rows) ? rows : []).map(row => {
            const o = {};
            Object.keys(row).forEach(k => { o[k.toLowerCase()] = row[k]; });
            return o;
        });
    };
    try { return await fn(sql); }
    finally { try { await request(cfg, 'POST', '/api/logout', { token }); } catch (_) {} }
}

// -------------------------------------------------------------------- deploy
function stateKey(cfg, id) { return cfg.server + '|' + id.type + '|' + id.name; }
function stamp() {   // local time, YYYYMMDD-HHMMSS
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

async function backup(sql, scriptId, id) {
    const r = await sql('SELECT data FROM biscript WHERE id = ' + scriptId);
    fs.mkdirSync(BACKUPS, { recursive: true });
    const f = path.join(BACKUPS, id.name.replace(/[<>:"/\\|?*]/g, '_') + '-' + id.type + '-' + stamp() + EXT[id.type]);
    fs.writeFileSync(f, (r[0] && r[0].data) || '', 'utf8');
    return rel(f);
}

/* The bireport row that lists a Page in the client. Creates it when asked. */
async function ensureReport(sql, scriptId, name, create) {
    const r = await sql('SELECT id, biScriptId AS sid FROM bireport WHERE name = ' + q(name));
    if (r.length) {
        if (+r[0].sid !== +scriptId) throw new Error('bireport "' + name + '" points at biscript #' + r[0].sid + ', not #' + scriptId);
        return +r[0].id;
    }
    if (!create) return null;
    await sql('INSERT INTO bireport (biScriptId, data, params, name, description, widget, dateLastModified) VALUES (' +
        scriptId + ", '', '{}', " + q(name) + ', ' + q(name) + ', 0, NOW(6))');
    const n = await sql('SELECT id FROM bireport WHERE name = ' + q(name));
    if (!n.length) throw new Error('bireport insert reported success but the row is not there');
    return +n[0].id;
}

/* Adds View rows for the named user groups ('all' = every group). Add-only:
   the server rejects DELETE, so access is revoked in the client. */
async function grant(sql, reportId, groups) {
    const want = groups === 'all' ? null : groups.split(',').map(s => s.trim()).filter(Boolean);
    const gs = await sql('SELECT id, name FROM usergroup' + (want ? ' WHERE name IN (' + want.map(q).join(', ') + ')' : ''));
    if (want) {
        const found = new Set(gs.map(g => String(g.name).toLowerCase()));
        const bad = want.filter(w => !found.has(w.toLowerCase()));
        if (bad.length) throw new Error('no user group named ' + bad.map(b => '"' + b + '"').join(', '));
    }
    const have = () => sql('SELECT userGroupId AS g FROM bireportaccess WHERE biReportId = ' + reportId)
        .then(rows => new Set(rows.map(r => +r.g)));
    const before = await have();
    const add = gs.filter(g => !before.has(+g.id));
    if (add.length) {
        await sql('INSERT INTO bireportaccess (userGroupId, biReportId, accessLevel) VALUES ' +
            add.map(g => '(' + (+g.id) + ', ' + reportId + ", 'View')").join(', '));
        const after = await have();
        const lost = add.filter(g => !after.has(+g.id));
        if (lost.length) throw new Error('access insert did not stick for ' + lost.map(g => g.name).join(', '));
    }
    return add.map(g => g.name);
}

/* Deploy one file. Returns { action, id, note, reason }. action is one of
   created | updated | unchanged | needs-confirm | missing | skipped |
   would create | would update. Throws only on a real failure. */
async function deployOne(sql, cfg, state, file, opts) {
    const id = identity(file);
    if (!id) return { action: 'skipped', note: 'no Fishbowl name (FB_REPORT.name is null?)' };
    if (id.name.length > 64) throw new Error('name is over 64 characters: ' + id.name);
    const typeId = TYPE_ID[id.type];
    const data = payload(file);
    const hash = sha256(data);
    const key = stateKey(cfg, id);
    const last = state[key];
    const notes = [];
    const find = () => sql('SELECT id, SHA2(data, 256) AS h FROM biscript WHERE name = ' + q(id.name) + ' AND typeId = ' + typeId);

    let rows = await find();
    let action;
    if (!rows.length) {
        if (!opts.create) return { action: 'missing', name: id.name, note: 'not in Fishbowl' };
        if (opts.dry) return { action: 'would create', name: id.name };
        await sql('INSERT INTO biscript (active, data, dateLastModified, description, name, note, typeId, published) VALUES (1, ' +
            blob(data) + ', NOW(6), ' + q(descriptionOf(data) || id.name) + ', ' + q(id.name) + ", '', " + typeId + ', ' + (id.type === 'Page' ? 1 : 0) + ')');
        rows = await find();
        if (!rows.length) throw new Error('biscript insert reported success but the record is not there');
        action = 'created';
    } else if (rows[0].h === hash) {
        action = 'unchanged';
    } else {
        // Overwrite unasked only when Fishbowl still holds what we last wrote.
        const ours = !!last && last.hash === rows[0].h;
        if (!ours && !opts.force) {
            return { action: 'needs-confirm', id: +rows[0].id, name: id.name,
                reason: last ? 'was changed in Fishbowl (e.g. in the BI editor) after the last deploy from this repo'
                             : 'differs from the repo and was not deployed from here' };
        }
        if (opts.dry) return { action: 'would update', id: +rows[0].id, name: id.name };
        if (!ours) notes.push('previous Fishbowl copy -> ' + await backup(sql, +rows[0].id, id));
        await sql('UPDATE biscript SET data = ' + blob(data) + ', dateLastModified = NOW(6) WHERE id = ' + (+rows[0].id));
        action = 'updated';
    }

    const scriptId = +rows[0].id;
    if (action !== 'unchanged') {
        const v = await sql('SELECT SHA2(data, 256) AS h FROM biscript WHERE id = ' + scriptId);
        if (!v.length || v[0].h !== hash) throw new Error('read-back does not match what was sent (biscript #' + scriptId + ')');
    }
    state[key] = { id: scriptId, hash, at: new Date().toISOString() };

    let reportId = null;
    if (id.type === 'Page' && !opts.dry) {
        reportId = await ensureReport(sql, scriptId, id.name, opts.create);
        if (reportId == null) notes.push('no bireport row, so the client does not list it; --create adds one');
        else if (opts.access) {
            const added = await grant(sql, reportId, opts.access);
            notes.push(added.length ? 'View access added for ' + added.join(', ') : 'access already granted');
        }
    }
    if (!opts.dry) {
        const d = await syncDescription(sql, scriptId, reportId, id.name, descriptionOf(data));
        if (d) notes.push(d);
    }
    return { action, id: scriptId, name: id.name, note: notes.join('; ') };
}

/* Gives the record the page's <meta name="description"> where its own says
   nothing (empty, or just the name). A description written in Fishbowl stays. */
async function syncDescription(sql, scriptId, reportId, name, want) {
    if (!want) return '';
    const done = [];
    const rows = [['biscript', scriptId]].concat(reportId ? [['bireport', reportId]] : []);
    for (const [table, rid] of rows) {
        const cur = await sql('SELECT description AS d FROM ' + table + ' WHERE id = ' + rid);
        if (!cur.length || !isPlaceholder(cur[0].d, name) || cur[0].d === want) continue;
        await sql('UPDATE ' + table + ' SET description = ' + q(want) + ', dateLastModified = NOW(6) WHERE id = ' + rid);
        done.push(table);
    }
    return done.length ? 'description set (' + done.join(', ') + ')' : '';
}

/* Renames a record in place. The biscript row (by name + type) and, for a
   Page, every bireport row pointing at it take the new name; a description
   that only repeated the old name follows it. Both rows' @Version is bumped.
   The deploy state moves to the new name, so the record stays "ours". */
async function renameRecord(sql, cfg, state, type, from, to, dry) {
    const typeId = TYPE_ID[type];
    if (!typeId) throw new Error('unknown type ' + type);
    if (!to || to.length > 64) throw new Error('the new name must be 1-64 characters');
    const s = await sql('SELECT id, description FROM biscript WHERE name = ' + q(from) + ' AND typeId = ' + typeId);
    if (!s.length) return { action: 'missing', name: from };
    const id = +s[0].id;
    const takenS = await sql('SELECT id FROM biscript WHERE name = ' + q(to) + ' AND typeId = ' + typeId + ' AND id <> ' + id);
    const takenB = type === 'Page'
        ? await sql('SELECT id FROM bireport WHERE name = ' + q(to) + ' AND biScriptId <> ' + id) : [];
    if (takenS.length || takenB.length) {
        return { action: 'taken', id, name: to,
            note: '"' + to + '" already exists (' + (takenS.length ? 'biscript #' + takenS[0].id : 'bireport #' + takenB[0].id) + ')' };
    }
    if (dry) return { action: 'would rename', id, name: to };
    const desc = col => 'CASE WHEN ' + col + ' = ' + q(from) + ' OR ' + col + ' IS NULL THEN ' + q(to) + ' ELSE ' + col + ' END';
    await sql('UPDATE biscript SET name = ' + q(to) + ', description = ' + desc('description') +
        ', dateLastModified = NOW(6) WHERE id = ' + id);
    if (type === 'Page') {
        await sql('UPDATE bireport SET name = ' + q(to) + ', description = ' + desc('description') +
            ', dateLastModified = NOW(6) WHERE biScriptId = ' + id);
    }
    const v = await sql('SELECT name FROM biscript WHERE id = ' + id);
    const vb = type === 'Page' ? await sql('SELECT name FROM bireport WHERE biScriptId = ' + id) : [];
    if (!v.length || v[0].name !== to || vb.some(r => r.name !== to)) {
        throw new Error('read-back does not show the new name (biscript #' + id + ')');
    }
    const oldKey = stateKey(cfg, { type, name: from });
    if (state[oldKey]) { state[stateKey(cfg, { type, name: to })] = state[oldKey]; delete state[oldKey]; }
    return { action: 'renamed', id, name: to, note: vb.length ? 'bireport ' + vb.length + ' row(s)' : '' };
}

// ---------------------------------------------------------------------- status
function sources() {
    const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
        .split('\n').filter(Boolean);
    return files.filter(f => /^scripts\/[^/]+\.(js|css)$/.test(f) || /\.htm$/i.test(f)).map(f => path.join(ROOT, f));
}

async function status(sql, cfg, state, files, explicit) {
    const rows = await sql('SELECT s.id, s.name, s.typeId AS t, SHA2(s.data, 256) AS h, ' +
        '(SELECT MIN(b.id) FROM bireport b WHERE b.biScriptId = s.id) AS rid ' +
        'FROM biscript s WHERE s.typeId IN (10, 20, 30)');
    const T = require('./targets.js');
    files.forEach(f => {
        const id = identity(f);
        if (!id) {
            if (explicit) console.log('-'.padEnd(11) + 'no Fishbowl name'.padEnd(34) + rel(f).padEnd(56) + ' (FB_REPORT.name is null)');
            return;
        }
        const r = rows.find(x => x.name === id.name && +x.t === TYPE_ID[id.type]);
        const last = state[stateKey(cfg, id)];
        let s;
        if (!r) s = 'not in Fishbowl';
        else if (r.h === sha256(payload(f))) s = 'in sync';
        else if (last && last.hash === r.h) s = 'repo is newer';
        else if (last) s = 'EDITED IN FISHBOWL';
        else s = 'differs (not deployed from here)';
        if (r && id.type === 'Page' && r.rid == null) s += ', no bireport';
        const t = T.get(rel(f)) || '-';
        console.log(t.padEnd(11) + s.padEnd(34) + rel(f).padEnd(56) + ' ' + id.name + (r ? '  #' + r.id : ''));
    });
}

// ------------------------------------------------------------------------ hook
/* Messages for the edit hook. "user" is shown to the user; "claude" is added
   to Claude's context, and carries the questions Claude must ask. */
function hookMessages(cfg, r, res) {
    const cmd = flag => 'node tools/deploy/fbdeploy.js ' + flag + ' "' + r + '"';
    const where = 'the local Fishbowl server (' + cfg.server + ')';
    switch (res.action) {
        case 'unchanged': return null;
        case 'needs-confirm': return {
            user: 'Fishbowl: ' + r + ' NOT deployed - the Fishbowl copy ' + res.reason + '. Confirmation needed.',
            claude: 'Fishbowl deploy needs confirmation: the copy of "' + res.name + '" (biscript #' + res.id + ') on ' + where +
                ' ' + res.reason + ', so it was NOT overwritten. Ask the user (AskUserQuestion) whether to overwrite it with ' +
                r + '. Yes: run `' + cmd('--force') + '` (the Fishbowl copy is backed up to tools/deploy/backups/ first). ' +
                'No: leave it. Never pass --force without a yes for this file.' };
        case 'missing': return {
            user: 'Fishbowl: ' + r + ' is set to auto-deploy but "' + res.name + '" is no longer in Fishbowl.',
            claude: 'Fishbowl deploy: "' + res.name + '" (' + r + ') is set to auto-deploy but is no longer on ' + where +
                '. Ask the user whether to recreate it. Yes: run `' + cmd('--create') + '`. If it should no longer go to ' +
                'Fishbowl, record that with `node tools/deploy/targets.js <sharepoint|none> "' + r + '"`.' };
        default: {
            const line = 'Fishbowl: ' + res.action + ' ' + r + (res.id ? ' (biscript #' + res.id + ')' : '') + (res.note ? ' - ' + res.note : '');
            return { user: line, claude: line };
        }
    }
}

// ------------------------------------------------------------------------ main
function readStdin() { try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; } }

function parseArgs(argv) {
    const o = { flags: new Set(), files: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i].trim();
        if (!a) continue;
        if (a === '--access' || a === '--rename' || a === '--to' || a === '--type') o[a.slice(2)] = argv[++i];
        else if (a.startsWith('--')) o.flags.add(a);
        else o.files.push(path.resolve(a));
    }
    return o;
}

function printResult(f, res) {
    let line = res.action.padEnd(14) + rel(f) + (res.id ? '  (biscript #' + res.id + ')' : '');
    if (res.action === 'needs-confirm') line += '  - the Fishbowl copy ' + res.reason + '; NOT overwritten. Re-run with --force once the user agrees (backs it up first).';
    else if (res.action === 'missing') line += '  - not in Fishbowl; --create adds it';
    else if (res.note) line += '  - ' + res.note;
    console.log(line);
}

async function runHook(cfg, state) {
    // Never fail the edit that triggered us; print { user, claude } or nothing.
    // Only files the user sent to Fishbowl, and only records that already
    // exist; targets.js asks about undecided files and creates on the answer.
    let r = '';
    try {
        if (!cfg) return null;
        const input = JSON.parse(readStdin() || '{}');
        const f = (input.tool_input && input.tool_input.file_path) || (input.tool_response && input.tool_response.filePath);
        if (!f || !fs.existsSync(f)) return null;
        r = rel(f);
        if (r.startsWith('..')) return null;
        const T = require('./targets.js');
        const files = [path.resolve(f)].concat(built.dependents(f)).filter(x => {
            const t = T.get(rel(x));
            return t && T.includes(t, 'fishbowl') && identity(x);
        });
        if (!files.length) return null;
        const msgs = [];
        await withSession(cfg, async sql => {
            for (const x of files) {
                const rx = rel(x);
                try {
                    msgs.push(hookMessages(cfg, rx, await deployOne(sql, cfg, state, x, {})));
                } catch (e) {
                    const line = 'Fishbowl deploy FAILED for ' + rx + ': ' + e.message;
                    msgs.push({ user: line, claude: line });
                }
                // Per file, so a hook cut short still knows what it wrote.
                fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n', 'utf8');
            }
        });
        const m = msgs.filter(Boolean);
        return m.length ? { user: m.map(x => x.user).join('\n'), claude: m.map(x => x.claude).join('\n') } : null;
    } catch (e) {
        const line = 'Fishbowl deploy FAILED for ' + r + ': ' + e.message;
        return { user: line, claude: line };
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const cfg = loadConfig();
    const state = readJson(STATE, {});
    const saveState = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n', 'utf8');

    if (args.flags.has('--hook')) {
        const m = await runHook(cfg, state);
        if (m) process.stdout.write(JSON.stringify(m));
        return 0;
    }

    if (!cfg) {
        console.error('fbdeploy: not configured. Create ' + rel(CONFIG) + ' (see tools/deploy/README.md).');
        return 1;
    }

    return withSession(cfg, async sql => {
        if (args.rename != null) {
            if (!args.to) { console.error('fbdeploy: --rename <old> --to <new>'); return 1; }
            const res = await renameRecord(sql, cfg, state, args.type || 'Page', args.rename, args.to, args.flags.has('--dry'));
            console.log(res.action.padEnd(14) + JSON.stringify(args.rename) + ' -> ' + JSON.stringify(args.to) +
                (res.id ? '  (biscript #' + res.id + ')' : '') + (res.note ? '  - ' + res.note : ''));
            if (res.action === 'renamed') saveState();
            return res.action === 'renamed' || res.action === 'would rename' ? 0 : 1;
        }
        if (args.flags.has('--status')) {
            await status(sql, cfg, state, args.files.length ? args.files : sources(), args.files.length > 0);
            return 0;
        }
        if (!args.files.length) {
            console.error('fbdeploy: name at least one file (or --status).');
            return 1;
        }
        const opts = { create: args.flags.has('--create'), force: args.flags.has('--force'),
            dry: args.flags.has('--dry'), access: args.access };
        let failed = 0;
        for (const f of args.files) {
            try {
                const res = await deployOne(sql, cfg, state, f, opts);
                printResult(f, res);
                if (res.action === 'needs-confirm') failed++;
            } catch (e) {
                failed++;
                console.log('FAILED'.padEnd(14) + rel(f) + '  - ' + e.message);
            }
        }
        if (!opts.dry) saveState();
        return failed ? 1 : 0;
    });
}

module.exports = { identity, payload, deployOne, renameRecord, syncDescription, withSession, loadConfig };
if (require.main === module) {
    main().then(code => { process.exitCode = code; },
        e => { console.error('fbdeploy: ' + e.message); process.exitCode = 1; });
}
