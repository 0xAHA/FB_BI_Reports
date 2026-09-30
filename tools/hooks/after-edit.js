#!/usr/bin/env node
// Claude Code PostToolUse hook (Edit|Write|MultiEdit): runs the edit through
// the build stamp, THEN publishes it — in that order, so the published copy
// always carries the new build stamp. Both steps read the same tool JSON.
// Never fails the edit; a publish is reported back as a one-line message.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

let input = '';
try { input = fs.readFileSync(0, 'utf8'); } catch (_) {}
const run = script => {
    try {
        return execFileSync(process.execPath, [path.join(__dirname, '..', script), '--hook'],
            { input, encoding: 'utf8', timeout: 15000 });
    } catch (_) { return ''; }
};
run('stamp/stamp.js');
const published = run('deploy/publish.js').trim();
if (published) process.stdout.write(JSON.stringify({ systemMessage: published }));
