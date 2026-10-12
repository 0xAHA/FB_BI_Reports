#!/usr/bin/env node
// ============================================================================
//  tools/deploy/targets.js — where each report goes: Fishbowl, SharePoint, both
// ============================================================================
//
// An edit can go to two places: the shared SharePoint "BI Reports" folder
// (publish.js, what consultants import from) and the local Fishbowl server
// (fbdeploy.js). The user decides per file, once, and the answer lives in the
// gitignored targets.local.json:
//   { "SalesOrder/Foo.htm": "both", "scripts/fb-lib.js": "sharepoint" }
// Values: fishbowl | sharepoint | both | none.
//
// An undecided file goes NOWHERE. On its first edit the hook (--hook) hands
// Claude the question to put to the user; the answer is recorded with this
// tool, which also does the first push to each chosen target.
//
// USAGE
//   node tools/deploy/targets.js <fishbowl|sharepoint|both|none> <file> [--folder <sub>]
//        record the answer and push now. SharePoint needs --folder (an existing
//        sub-folder of BI Reports) when the file has no copy there yet.
//   node tools/deploy/targets.js --list      every recorded decision
//   node tools/deploy/targets.js --hook      Claude Code hook (tool JSON on stdin)
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const FILE = path.join(__dirname, 'targets.local.json');
const VALUES = ['fishbowl', 'sharepoint', 'both', 'none'];
// Never offered: superseded copies, generated exports, OneDrive conflict copies.
const NOT_DEPLOYABLE = /^(archived|Deployed)\/|-DESKTOP-/;

function rel(p) { return path.relative(ROOT, path.resolve(p)).split(path.sep).join('/'); }
function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (_) { return {}; } }

/* The recorded decision for a repo-relative path, or null when undecided. */
function get(r) { const v = load()[r]; return VALUES.includes(v) ? v : null; }
function includes(v, target) { return v === 'both' || v === target; }
function set(r, v) {
    const all = load();
    all[r] = v;
    const sorted = {};
    Object.keys(all).sort().forEach(k => { sorted[k] = all[k]; });
    fs.writeFileSync(FILE, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}

// publish.js and fbdeploy.js both require this module, so they are loaded
// lazily here to keep the require graph acyclic at load time.
const P = () => require('./publish.js');
const F = () => require('./fbdeploy.js');

/* What each target can do for a file: { name, sp: {dir, hits} | null, fb: cfg | null }. */
function reach(file) {
    const spId = P().identityOf(file), fbId = F().identity(file);
    const dir = P().publishDir(), cfg = F().loadConfig();
    const sp = dir && spId ? { dir, hits: P().indexPublished(dir).filter(x => x.name === spId.name && x.type === spId.type) } : null;
    const fb = cfg && fbId ? cfg : null;
    return { name: (fbId || spId || {}).name, sp, fb };
}

/* The question for an undecided file, as { user, claude }, or null. */
function question(file) {
    const r = rel(file);
    if (r.startsWith('..') || NOT_DEPLOYABLE.test(r) || get(r)) return null;
    const { name, sp, fb } = reach(file);
    if (!sp && !fb) return null;
    const choices = sp && fb ? ['fishbowl', 'sharepoint', 'both', 'none'] : fb ? ['fishbowl', 'none'] : ['sharepoint', 'none'];
    const labels = { fishbowl: 'Fishbowl', sharepoint: 'SharePoint', both: 'Both', none: 'Neither' };
    const parts = [];
    if (fb) parts.push('Fishbowl = the local server (' + fb.server + '); it asks again before overwriting a copy it did not write.');
    if (sp) {
        parts.push('SharePoint = the shared BI Reports folder consultants import from. ' + (sp.hits.length
            ? 'It is already there as ' + sp.hits.map(h => '"' + path.relative(sp.dir, h.file) + '"').join(', ') +
              ', which is overwritten on every edit if SharePoint is chosen.'
            : 'It has no copy there yet, so if SharePoint is chosen also ask which folder it goes in (' +
              P().folders(sp.dir).map(f => '"' + f + '"').join(', ') + ') and pass --folder "<folder>".'));
    }
    return {
        user: 'Deploy: ' + r + ' has no deploy target yet, so this edit was not published or deployed.',
        claude: 'Deploy targets: ' + r + ' ("' + name + '") has no deploy decision, so this edit was NOT published to ' +
            'SharePoint or deployed to Fishbowl. Ask the user (AskUserQuestion; group any other files waiting on the same ' +
            'question) where every edit to it should go: ' + choices.map(c => labels[c]).join(', ') + '. ' + parts.join(' ') +
            ' Record the answer with `node tools/deploy/targets.js <' + choices.join('|') + '> "' + r + '"`' +
            (sp && !sp.hits.length ? ' (add --folder "<folder>" when it includes SharePoint)' : '') +
            '; that also pushes it now.'
    };
}

function runTool(script, args) {
    const r = spawnSync(process.execPath, [path.join(__dirname, script)].concat(args), { stdio: 'inherit' });
    return r.status == null ? 1 : r.status;
}

function setCmd(value, file, folder) {
    const r = rel(file);
    if (!VALUES.includes(value)) { console.error('targets: the target is one of ' + VALUES.join(', ')); return 1; }
    if (!fs.existsSync(file) || r.startsWith('..')) { console.error('targets: no such repo file: ' + file); return 1; }
    const { sp, fb } = reach(file);
    // Validate everything before recording, so a refused answer leaves the
    // file undecided and the question comes back.
    if (includes(value, 'sharepoint')) {
        if (!sp) { console.error('targets: SharePoint is not available for ' + r + ' (no tools/deploy/publish.local.json, or no FB_REPORT.name).'); return 1; }
        const subs = P().folders(sp.dir);
        if (!sp.hits.length && !subs.includes(folder)) {
            console.error('targets: ' + r + ' has no SharePoint copy yet. ' + (folder ? 'There is no folder "' + folder + '". ' : '') +
                'Re-run with --folder "<folder>", one of: ' + subs.map(f => '"' + f + '"').join(', '));
            return 1;
        }
    }
    if (includes(value, 'fishbowl') && !fb) {
        console.error('targets: Fishbowl is not available for ' + r + ' (no tools/deploy/fishbowl.local.json, or no Fishbowl name).');
        return 1;
    }
    set(r, value);
    console.log('deploy target for ' + r + ': ' + value);
    let code = 0;
    if (includes(value, 'sharepoint')) code = runTool('publish.js', (folder ? ['--folder', folder] : []).concat([file])) || code;
    if (includes(value, 'fishbowl')) code = runTool('fbdeploy.js', ['--create', file]) || code;
    return code;
}

function main() {
    const argv = process.argv.slice(2).map(a => a.trim()).filter(Boolean);
    if (argv[0] === '--hook') {
        // Never fail the edit; print { user, claude } or nothing.
        try {
            const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
            const f = (input.tool_input && input.tool_input.file_path) || (input.tool_response && input.tool_response.filePath);
            const q = f && fs.existsSync(f) ? question(path.resolve(f)) : null;
            if (q) process.stdout.write(JSON.stringify(q));
        } catch (_) {}
        return 0;
    }
    if (argv[0] === '--list') {
        const all = load();
        const keys = Object.keys(all);
        if (!keys.length) console.log('targets: no decisions recorded yet.');
        keys.forEach(k => console.log(String(all[k]).padEnd(12) + k));
        return 0;
    }
    const i = argv.indexOf('--folder');
    const folder = i >= 0 ? argv[i + 1] : null;
    const rest = i < 0 ? argv : argv.filter((a, j) => j !== i && j !== i + 1);
    if (rest.length !== 2) {
        console.error('usage: node tools/deploy/targets.js <' + VALUES.join('|') + '> <file> [--folder <sub>]');
        return 1;
    }
    return setCmd(rest[0], path.resolve(rest[1]), folder);
}

module.exports = { get, includes, question };
if (require.main === module) process.exitCode = main();
