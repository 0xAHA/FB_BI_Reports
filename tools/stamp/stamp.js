#!/usr/bin/env node
// ============================================================================
//  tools/stamp/stamp.js — build stamps for reports and shared assets
// ============================================================================
//
// Every production report (.htm) and shared asset (scripts/fb-lib.js,
// fb-mfg.js, fb-styles.css) carries ONE build stamp on the first line that
// contains the marker `@fb-build`:
//
//     build: '2026.09.24-1a2b3c4'   // @fb-build (stamped automatically)
//
// The stamp is <date the content last changed>-<7-hex content hash>. The hash
// is SHA-1 of the file with the stamp itself blanked (and CRLF folded to LF),
// so stamping is idempotent: re-running on unchanged content changes nothing,
// and the date only moves when the content does. Two copies of a report with
// the same stamp are the same code.
//
// USAGE
//   node tools/stamp/stamp.js                 stamp every in-scope file
//   node tools/stamp/stamp.js <file> [...]    stamp just these files
//   node tools/stamp/stamp.js --check         exit 1 if any stamp is stale (no writes)
//   node tools/stamp/stamp.js --list          print each file's current stamp
//   node tools/stamp/stamp.js --hook          Claude Code PostToolUse hook: reads the
//                                             tool JSON on stdin, stamps that one file
//   node tools/stamp/stamp.js --staged        git pre-commit: stamp staged files and
//                                             re-stage them (tools/githooks/pre-commit)
//
// Files without a marker are skipped silently — the marker IS the opt-in.
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const MARKER = '@fb-build';
const TOKEN = /\d{4}\.\d{2}\.\d{2}-[0-9a-f]{7}|UNSTAMPED/;
const IN_SCOPE = /^(?:(?!Other_NOT_FOR_PRODUCTION\/|archived\/|mockups\/|tools\/|node_modules\/|Manufacturing\/Archived\/|Manufacturing\/Temp\/).*\.html?|scripts\/[^/]+\.(?:js|css))$/;

function today() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate());
}

// Returns { text, bom, eol, lines, idx } or null when the file has no marker.
function parse(file) {
    let raw = fs.readFileSync(file, 'utf8');
    const bom = raw.charCodeAt(0) === 0xFEFF;
    if (bom) raw = raw.slice(1);
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const lines = raw.replace(/\r\n/g, '\n').split('\n');
    const idx = lines.findIndex(l => l.includes(MARKER) && TOKEN.test(l));
    if (idx < 0) return null;
    return { bom, eol, lines, idx };
}

function hashOf(p) {
    const blanked = p.lines.slice();
    blanked[p.idx] = blanked[p.idx].replace(TOKEN, 'UNSTAMPED');
    return crypto.createHash('sha1').update(blanked.join('\n'), 'utf8').digest('hex').slice(0, 7);
}

function current(p) { return (p.lines[p.idx].match(TOKEN) || [''])[0]; }

// { file, before, after, changed } or null (no marker).
function stampFile(file, write) {
    const p = parse(file);
    if (!p) return null;
    const before = current(p);
    const h = hashOf(p);
    if (before.slice(-7) === h && before !== 'UNSTAMPED') return { file, before, after: before, changed: false };
    const after = today() + '-' + h;
    if (write) {
        p.lines[p.idx] = p.lines[p.idx].replace(TOKEN, after);
        fs.writeFileSync(file, (p.bom ? '\uFEFF' : '') + p.lines.join(p.eol), 'utf8');
    }
    return { file, before, after, changed: true };
}

function git(args) {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}
function scopeFiles() {
    return git(['ls-files', '-co', '--exclude-standard'])
        .split('\n').filter(f => f && IN_SCOPE.test(f)).map(f => path.join(ROOT, f));
}
function rel(f) { return path.relative(ROOT, f).split(path.sep).join('/'); }

function readStdin() {
    try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; }
}

function main() {
    const args = process.argv.slice(2).map(a => a.trim()).filter(Boolean);   // trim: a CRLF hook script passes '--staged' plus a trailing CR
    const flags = new Set(args.filter(a => a.startsWith('--')));
    const paths = args.filter(a => !a.startsWith('--'));

    if (flags.has('--hook')) {
        // Never fail the edit that triggered us.
        try {
            const input = JSON.parse(readStdin() || '{}');
            const f = (input.tool_input && input.tool_input.file_path) ||
                      (input.tool_response && input.tool_response.filePath);
            if (f && fs.existsSync(f) && IN_SCOPE.test(rel(path.resolve(f)))) {
                const r = stampFile(path.resolve(f), true);
                if (r && r.changed) process.stdout.write(JSON.stringify({ suppressOutput: true }));
            }
        } catch (_) {}
        return 0;
    }

    if (flags.has('--staged')) {
        const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
            .split('\n').filter(f => f && IN_SCOPE.test(f));
        const unstaged = new Set(git(['diff', '--name-only']).split('\n').filter(Boolean));
        let blocked = 0;
        for (const f of staged) {
            const abs = path.join(ROOT, f);
            if (!fs.existsSync(abs)) continue;
            const r = stampFile(abs, false);
            if (!r || !r.changed) continue;
            if (unstaged.has(f)) {
                console.error('stamp: ' + f + ' has unstaged changes, so its build stamp can\'t be refreshed safely.\n' +
                              '       Stage the whole file (or run: node tools/stamp/stamp.js "' + f + '") and commit again.');
                blocked++;
                continue;
            }
            stampFile(abs, true);
            git(['add', '--', f]);
            console.log('stamp: ' + f + '  ' + r.before + ' -> ' + r.after);
        }
        return blocked ? 1 : 0;
    }

    const files = paths.length ? paths.map(p => path.resolve(p)) : scopeFiles();
    const write = !flags.has('--check') && !flags.has('--list');
    let stale = 0;
    for (const f of files) {
        if (!fs.existsSync(f)) { console.error('stamp: missing ' + f); continue; }
        const r = stampFile(f, write);
        if (!r) { if (paths.length) console.log('stamp: no ' + MARKER + ' marker  ' + rel(f)); continue; }
        if (flags.has('--list')) { console.log(r.before.padEnd(19) + (r.changed ? ' (stale)  ' : '          ') + rel(f)); continue; }
        if (r.changed) {
            stale++;
            console.log((write ? 'stamped  ' : 'STALE    ') + rel(f) + '  ' + r.before + ' -> ' + r.after);
        }
    }
    if (flags.has('--check') && stale) { console.error(stale + ' stale build stamp(s). Run: node tools/stamp/stamp.js'); return 1; }
    return 0;
}

process.exitCode = main();
