#!/usr/bin/env node
// ============================================================================
//  tools/deploy/publish.js — keep the published SharePoint copies current
// ============================================================================
//
// The shared "BI Reports" folder (a SharePoint library synced locally by
// OneDrive) holds the JSON-wrapped, importable copy of every PUBLISHED report,
// arranged in whatever sub-folders the owner likes. This tool never chooses a
// folder and never creates a file there:
//
//   * a report is identified by its Fishbowl record name — FB_REPORT.name in
//     the report's identity block (shared scripts use the fixed names below);
//   * the folder is searched RECURSIVELY for a "<name>-<Type>.json" whose
//     record name matches (read from inside the JSON, or from the filename
//     when OneDrive has only a cloud placeholder);
//   * a match is overwritten IN PLACE with the freshly wrapped source,
//     keeping the published description; no match = not published = nothing
//     happens. Publishing something new = dropping its first copy there.
//
// The folder path is per machine, so it lives in tools/deploy/publish.local.json
// (gitignored): { "dir": "C:\\...\\BI Reports" }. No config = no-op, so other
// clones are unaffected.
//
// USAGE
//   node tools/deploy/publish.js <file> [...]   publish these (if published)
//   node tools/deploy/publish.js --all          every source that has a copy
//   node tools/deploy/publish.js --list         what maps where; orphans
//   node tools/deploy/publish.js --dry ...      say what would change, write nothing
//   node tools/deploy/publish.js --hook         Claude Code hook (tool JSON on stdin)
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const W = require('./fbwrap.js');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG = path.join(__dirname, 'publish.local.json');

// Shared assets have no identity block; their record names are fixed (the
// Script / Style directives in every report resolve by these exact names).
const FIXED = {
    'scripts/fb-lib.js':     { name: 'fb-lib',    type: 'Script' },
    'scripts/fb-mfg.js':     { name: 'fb-mfg',    type: 'Script' },
    'scripts/fb-styles.css': { name: 'fb-styles', type: 'Style' }
};

function rel(p) { return path.relative(ROOT, path.resolve(p)).split(path.sep).join('/'); }
function publishDir() {
    // FB_PUBLISH_DIR overrides the config — used to test against a scratch folder.
    if (process.env.FB_PUBLISH_DIR) return fs.existsSync(process.env.FB_PUBLISH_DIR) ? process.env.FB_PUBLISH_DIR : null;
    try {
        const c = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
        return c && c.dir && fs.existsSync(c.dir) ? c.dir : null;
    } catch (_) { return null; }
}

/* { name, type } for a repo file, or null when it isn't publishable / has no name. */
function identityOf(file) {
    const r = rel(file);
    if (FIXED[r]) return FIXED[r];
    if (!/\.htm$/i.test(r)) return null;
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
    const block = /window\.FB_REPORT\s*=\s*\{([\s\S]*?)\};/.exec(text);
    if (!block) return null;
    const m = /\bname:\s*'((?:[^'\\]|\\.)*)'/.exec(block[1]);
    return m ? { name: m[1].replace(/\\'/g, "'"), type: 'Page' } : null;
}

/* Every published record under the folder: [{ file, name, type, description }]. */
function indexPublished(dir) {
    const out = [];
    (function walk(d) {
        let entries = [];
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
        entries.forEach(e => {
            const p = path.join(d, e.name);
            if (e.isDirectory()) return walk(p);
            const fm = /^(.*)-(Page|Script|Style)\.json$/.exec(e.name);
            if (!fm) return;
            let name = fm[1], type = fm[2], description = null;
            try {
                const rec = (JSON.parse(fs.readFileSync(p, 'utf8')) || [])[0] || {};
                if (rec.name) name = rec.name;
                if (rec.type) type = rec.type;
                if (typeof rec.description === 'string') description = rec.description;
            } catch (_) { /* cloud-only placeholder or unreadable: trust the filename */ }
            out.push({ file: p, name, type, description });
        });
    })(dir);
    return out;
}

/* Publish one repo file. Returns [{ target, action }] (empty = not published). */
function publishFile(file, index, dry) {
    const id = identityOf(file);
    if (!id) return [];
    const hits = index.filter(x => x.name === id.name && x.type === id.type);
    const data = fs.readFileSync(file, 'utf8');
    return hits.map(h => {
        const next = W.wrap(id.name, h.description != null ? h.description : id.name, data, id.type);
        let cur = null;
        try { cur = fs.readFileSync(h.file, 'utf8'); } catch (_) {}
        if (cur === next) return { target: h.file, action: 'unchanged' };
        if (!dry) fs.writeFileSync(h.file, next, 'utf8');
        return { target: h.file, action: dry ? 'would update' : 'updated' };
    });
}

function sources() {
    const { execFileSync } = require('child_process');
    const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
        .split('\n').filter(Boolean);
    return files.filter(f => FIXED[f] || /\.htm$/i.test(f)).map(f => path.join(ROOT, f));
}

function readStdin() { try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; } }

function main() {
    const args = process.argv.slice(2).map(a => a.trim()).filter(Boolean);
    const flags = new Set(args.filter(a => a.startsWith('--')));
    const dry = flags.has('--dry');
    const dir = publishDir();

    if (flags.has('--hook')) {
        // Never fail the edit that triggered us; report what was published.
        try {
            if (!dir) return 0;
            const input = JSON.parse(readStdin() || '{}');
            const f = (input.tool_input && input.tool_input.file_path) || (input.tool_response && input.tool_response.filePath);
            if (!f || !fs.existsSync(f) || rel(f).startsWith('..')) return 0;
            const res = publishFile(path.resolve(f), indexPublished(dir), false).filter(r => r.action === 'updated');
            if (res.length) process.stdout.write('Published ' + rel(f) + ' -> ' +
                res.map(r => path.relative(dir, r.target)).join(', '));
        } catch (_) {}
        return 0;
    }

    if (!dir) {
        console.error('publish: no folder configured. Create ' + rel(CONFIG) + ' with { "dir": "<BI Reports folder>" }.');
        return 1;
    }
    const index = indexPublished(dir);

    if (flags.has('--list')) {
        const claimed = new Set();
        sources().forEach(f => {
            const id = identityOf(f);
            if (!id) return;
            const hits = index.filter(x => x.name === id.name && x.type === id.type);
            hits.forEach(h => claimed.add(h.file));
            console.log((hits.length ? 'PUBLISHED  ' : 'unpublished') + '  ' + rel(f).padEnd(52) + ' ' + id.name +
                (hits.length ? '  ->  ' + hits.map(h => path.relative(dir, h.file)).join(', ') : ''));
        });
        const orphans = index.filter(x => !claimed.has(x.file));
        if (orphans.length) {
            console.log('\nPublished copies with no repo source (name set on no report):');
            orphans.forEach(o => console.log('  ' + path.relative(dir, o.file) + '   [' + o.name + ']'));
        }
        return 0;
    }

    const targets = flags.has('--all') ? sources() : args.filter(a => !a.startsWith('--')).map(a => path.resolve(a));
    let n = 0;
    targets.forEach(f => {
        publishFile(f, index, dry).forEach(r => {
            if (r.action === 'unchanged') return;
            n++;
            console.log(r.action.padEnd(13) + rel(f) + '  ->  ' + path.relative(dir, r.target));
        });
    });
    if (!n) console.log('publish: nothing to ' + (dry ? 'change' : 'update') + '.');
    return 0;
}

module.exports = { identityOf, indexPublished, publishFile };
if (require.main === module) process.exitCode = main();
