#!/usr/bin/env node
// ============================================================================
//  tools/deploy/publish.js — keep the published SharePoint copies current
// ============================================================================
//
// The shared "BI Reports" folder (a SharePoint library synced locally by
// OneDrive) holds the JSON-wrapped, importable copy of every PUBLISHED report,
// arranged in whatever sub-folders the owner likes. This tool never chooses a
// folder, and creates a file only in a folder the user named (--folder):
//
//   * a report is identified by its Fishbowl record name — FB_REPORT.name in
//     the report's identity block (shared scripts use the fixed names below);
//   * the folder is searched RECURSIVELY for a "<name>-<Type>.json" whose
//     record name matches (read from inside the JSON, or from the filename
//     when OneDrive has only a cloud placeholder);
//   * a match is overwritten IN PLACE with the freshly wrapped source,
//     keeping the published description; no match = not published = nothing
//     happens, unless --folder names the existing sub-folder for its first copy.
//
// A page with a build step (built.js) is published as its built page, and an
// edit also republishes the opted-in pages built from the edited file.
//
// The edit hook publishes only files whose deploy target (targets.js) includes
// SharePoint; an undecided file waits for the user's answer. --all skips files
// the user said should not go to SharePoint.
//
// The folder path is per machine, so it lives in tools/deploy/publish.local.json
// (gitignored): { "dir": "C:\\...\\BI Reports" }. No config = no-op, so other
// clones are unaffected.
//
// USAGE
//   node tools/deploy/publish.js <file> [...]   publish these (if published)
//   node tools/deploy/publish.js --folder <sub> <file>   ...creating the first copy in <sub>
//   node tools/deploy/publish.js --all          every source that has a copy
//   node tools/deploy/publish.js --list         what maps where; orphans
//   node tools/deploy/publish.js --folders      the sub-folders a first copy can go in
//   node tools/deploy/publish.js --rename <old name> <file>   move the copy named
//                                               <old name> to the file's current name
//   node tools/deploy/publish.js --dry ...      say what would change, write nothing
//   node tools/deploy/publish.js --hook         Claude Code hook (tool JSON on stdin)
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const W = require('./fbwrap.js');
const built = require('./built.js');   // a page with a build step ships its built page

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG = path.join(__dirname, 'publish.local.json');

// Shared assets have no identity block; their record names are fixed (the
// Script / Style directives in every report resolve by these exact names).
const FIXED = {
    'scripts/fb-lib.js':     { name: 'fb-lib',    type: 'Script' },
    'scripts/fb-mfg.js':     { name: 'fb-mfg',    type: 'Script' },
    'scripts/fb-doc.js':     { name: 'fb-doc',    type: 'Script' },
    'scripts/fb-styles.css': { name: 'fb-styles', type: 'Style' },
    'scripts/fb-doc-fonts.css': { name: 'fb-doc-fonts', type: 'Style' }
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

/* The page's own description, from its <meta name="description">; '' when it has none. */
function descriptionOf(text) {
    const m = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(String(text || ''));
    return m ? m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim() : '';
}

/* A description that says nothing: empty, or just the name again (with or
   without a legacy '- Folder - ' prefix). Only these get the page's own. */
function isPlaceholder(desc, ...names) {
    const n = s => String(s || '').toLowerCase().replace(/^[\s-]*\d+[.)]\s*/, '').replace(/[^a-z0-9]+/g, '');
    const d = n(desc);
    return !d || names.some(x => x && (d === n(x) || d === n(String(x).replace(/^-+\s*[^-]+?\s+-\s+/, ''))));
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
    const data = built.text(file);
    return hits.map(h => {
        // The published description stays, unless it says nothing; then the page's own.
        const desc = !isPlaceholder(h.description, id.name) ? h.description : (descriptionOf(data) || h.description || id.name);
        const next = W.wrap(id.name, desc, data, id.type);
        let cur = null;
        try { cur = fs.readFileSync(h.file, 'utf8'); } catch (_) {}
        if (cur === next) return { target: h.file, action: 'unchanged' };
        if (!dry) fs.writeFileSync(h.file, next, 'utf8');
        return { target: h.file, action: dry ? 'would update' : 'updated' };
    });
}

/* Every sub-folder of the publish folder, as "A/B" paths: where a first copy can go. */
function folders(dir) {
    const out = [];
    (function walk(d) {
        let entries = [];
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
        entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).forEach(e => {
            const p = path.join(d, e.name);
            out.push(path.relative(dir, p).split(path.sep).join('/'));
            walk(p);
        });
    })(dir);
    return out.sort();
}

/* The first copy of an unpublished file, in a sub-folder the user named.
   The sub-folder must already exist; this never creates folders. */
function createFile(file, dir, folder, dry) {
    const id = identityOf(file);
    if (!id) return [];
    if (/[<>:"/\\|?*]/.test(id.name)) throw new Error('the name "' + id.name + '" is not a valid file name');
    const sub = path.resolve(dir, folder);
    if (path.relative(dir, sub).startsWith('..') || !fs.existsSync(sub) || !fs.statSync(sub).isDirectory()) {
        throw new Error('no sub-folder "' + folder + '" in the BI Reports folder (it is never created): ' + folders(dir).join(', '));
    }
    const target = path.join(sub, W.fileNameFor(id.name, id.type));
    const data = built.text(file);
    if (!dry) fs.writeFileSync(target, W.wrap(id.name, descriptionOf(data) || id.name, data, id.type), 'utf8');
    return [{ target, action: dry ? 'would create' : 'created' }];
}

/* Renames a published copy: the "<old>-<Type>.json" record for the file's
   type moves, in its own folder, to the file's current name, and is rewritten
   with the current source. A description that only repeated the old name
   follows it. Refuses when a copy under the new name already exists.
   An import keys on the name, so a server that imported the old copy gets a
   second report from the renamed one; the old one is removed in the client. */
function renameFile(file, dir, index, from, dry) {
    const id = identityOf(file);
    if (!id) throw new Error(rel(file) + ' has no record name');
    if (/[<>:"/\\|?*]/.test(id.name)) throw new Error('the name "' + id.name + '" is not a valid file name');
    const olds = index.filter(x => x.name === from && x.type === id.type);
    if (!olds.length) return [];
    if (index.some(x => x.name === id.name && x.type === id.type)) {
        throw new Error('a copy named "' + id.name + '" is already published');
    }
    return olds.map(o => {
        const target = path.join(path.dirname(o.file), W.fileNameFor(id.name, id.type));
        const data = built.text(file);
        const desc = !isPlaceholder(o.description, from, id.name) ? o.description : (descriptionOf(data) || id.name);
        if (!dry) {
            fs.renameSync(o.file, target);
            fs.writeFileSync(target, W.wrap(id.name, desc, data, id.type), 'utf8');
        }
        return { target, from: o.file, action: dry ? 'would rename' : 'renamed' };
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
    const argv = process.argv.slice(2).map(a => a.trim()).filter(Boolean);
    const flags = new Set(), files = [];
    let folder = null, renameFrom = null;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--folder') folder = argv[++i];
        else if (argv[i] === '--rename') renameFrom = argv[++i];
        else if (argv[i].startsWith('--')) flags.add(argv[i]);
        else files.push(path.resolve(argv[i]));
    }
    const dry = flags.has('--dry');
    const dir = publishDir();
    const T = require('./targets.js');

    if (flags.has('--hook')) {
        // Never fail the edit that triggered us; report what was published.
        // Only files the user sent to SharePoint; targets.js asks about the rest.
        try {
            if (!dir) return 0;
            const input = JSON.parse(readStdin() || '{}');
            const f = (input.tool_input && input.tool_input.file_path) || (input.tool_response && input.tool_response.filePath);
            if (!f || !fs.existsSync(f) || rel(f).startsWith('..')) return 0;
            // Plus the opted-in pages built from this file (built.js).
            const index = indexPublished(dir), lines = [];
            [path.resolve(f)].concat(built.dependents(f)).forEach(x => {
                const t = T.get(rel(x));
                if (!t || !T.includes(t, 'sharepoint')) return;
                const res = publishFile(x, index, false).filter(r => r.action === 'updated');
                if (res.length) lines.push('Published ' + rel(x) + ' -> ' + res.map(r => path.relative(dir, r.target)).join(', '));
            });
            if (lines.length) process.stdout.write(lines.join('\n'));
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

    if (flags.has('--folders')) {
        folders(dir).forEach(f => console.log(f));
        return 0;
    }

    if (renameFrom != null) {
        if (files.length !== 1) { console.error('publish: --rename <old name> <file>'); return 1; }
        try {
            const res = renameFile(files[0], dir, index, renameFrom, dry);
            if (!res.length) { console.log('publish: no copy named "' + renameFrom + '" is published.'); return 0; }
            res.forEach(r => console.log(r.action.padEnd(13) + path.relative(dir, r.from) + '  ->  ' + path.relative(dir, r.target)));
            return 0;
        } catch (e) { console.error('publish: ' + e.message); return 1; }
    }

    // --all leaves out files the user decided should not go to SharePoint.
    const targets = flags.has('--all')
        ? sources().filter(f => { const t = T.get(rel(f)); return !t || T.includes(t, 'sharepoint'); })
        : files;
    let n = 0;
    targets.forEach(f => {
        let res = publishFile(f, index, dry);
        if (!res.length && folder && !flags.has('--all')) {
            try { res = createFile(f, dir, folder, dry); }
            catch (e) { console.error('publish: ' + e.message); process.exitCode = 1; }
        }
        res.forEach(r => {
            if (r.action === 'unchanged') return;
            n++;
            console.log(r.action.padEnd(13) + rel(f) + '  ->  ' + path.relative(dir, r.target));
        });
    });
    if (!n) console.log('publish: nothing to ' + (dry ? 'change' : 'update') + '.');
    return process.exitCode || 0;
}

module.exports = { identityOf, descriptionOf, isPlaceholder, indexPublished, publishFile, renameFile, publishDir, folders };
if (require.main === module) process.exitCode = main();
