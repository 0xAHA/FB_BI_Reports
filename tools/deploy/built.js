// ============================================================================
//  tools/deploy/built.js — pages that are built before they ship
// ============================================================================
//
// Most sources go to Fishbowl and SharePoint as they are. A folder can instead
// build its pages: each source carries markers such as
//   <!-- @inline-script fb-doc.js -->
// that the build.js beside it replaces, writing dist/<page>. Only the built
// page runs, so that is what fbdeploy.js deploys and publish.js publishes.
// Other_NOT_FOR_PRODUCTION/Paperwork_POC is the one such folder today.
//
// A build.js takes part by answering --plan (its text must mention it):
//   node build.js --plan       prints JSON [{ src, out, page, inputs }]
//       src     the source page, or null for a variant (a page built from
//               another page, which exists only as out)
//       out     the built file
//       page    the argument that builds out:  node build.js <page>
//       inputs  every file out is built from
// Paths are absolute. A file is deployed under the name src (or out, for a
// variant), so that is the path its deploy target is recorded against.
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const plans = new Map();   // folder -> plan, or null when it builds nothing
const done = new Set();    // build.js + page already built in this process

const norm = p => { const r = path.resolve(p); return process.platform === 'win32' ? r.toLowerCase() : r; };
const same = (a, b) => !!a && !!b && norm(a) === norm(b);

function planFor(dir) {
    const key = norm(dir);
    if (plans.has(key)) return plans.get(key);
    let plan = null;
    const b = path.join(dir, 'build.js');
    let text = '';
    try { text = fs.readFileSync(b, 'utf8'); } catch (_) {}
    if (text.includes('--plan')) {
        plan = JSON.parse(execFileSync(process.execPath, [b, '--plan'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
        plan.forEach(e => { e.builder = b; });
    }
    plans.set(key, plan);
    return plan;
}

/* The plan entry that ships this file (a built source, or a dist file), or null. */
function entryOf(file) {
    const f = path.resolve(file);
    for (const dir of [path.dirname(f), path.dirname(path.dirname(f))]) {
        const e = (planFor(dir) || []).find(x => same(x.src, f) || same(x.out, f));
        if (e) return e;
    }
    return null;
}

/* What ships for a file: its built page when it has one, else the file itself. */
function text(file) {
    const e = entryOf(file);
    if (!e) return fs.readFileSync(file, 'utf8');
    const k = norm(e.builder) + '|' + e.page;
    if (!done.has(k)) {
        try {
            execFileSync(process.execPath, [e.builder, e.page], { cwd: path.dirname(e.builder), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (err) {
            const why = String(err.stderr || err.message).split('\n').filter(Boolean).slice(0, 3).join(' | ');
            throw new Error('the build failed (' + path.basename(e.builder) + ' ' + e.page + '): ' + why);
        }
        done.add(k);
    }
    return fs.readFileSync(e.out, 'utf8');
}

/* Files whose built page is made from this one, other than itself: every page
   that inlines an edited fb-doc.js, or the variants of an edited page. Each is
   the path its deploy target is recorded against. */
function dependents(file) {
    const f = path.resolve(file);
    const plan = planFor(path.dirname(f)) || [];
    return plan.filter(e => e.inputs.some(i => same(i, f)))
        .map(e => e.src || e.out)
        .filter(k => !same(k, f));
}

module.exports = { text, dependents, entryOf };
