#!/usr/bin/env node
// Claude Code PostToolUse hook (Edit|Write|MultiEdit): runs the edit through
// the build stamp, THEN publishes it to SharePoint, THEN deploys it to the
// local Fishbowl server, in that order, so both copies carry the new stamp.
// Each step reads the same tool JSON. Never fails the edit.
//
// Where an edit goes is the user's per-file answer (deploy/targets.js); a
// file with no answer goes nowhere, and targets.js hands Claude the question.
// Messages go to the user (systemMessage) and, where Claude has to act (ask
// for a target, confirm an overwrite), to Claude as additionalContext.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

let input = '';
try { input = fs.readFileSync(0, 'utf8'); } catch (_) {}
const run = (script, timeout) => {
    try {
        return execFileSync(process.execPath, [path.join(__dirname, '..', script), '--hook'],
            { input, encoding: 'utf8', timeout: timeout || 15000 });
    } catch (_) { return ''; }
};
const json = s => { try { return JSON.parse(s || 'null'); } catch (_) { return null; } };
run('stamp/stamp.js');
const asked = json(run('deploy/targets.js'));
const published = run('deploy/publish.js').trim();
const deployed = json(run('deploy/fbdeploy.js', 20000));

const user = [asked && asked.user, published, deployed && deployed.user].filter(Boolean);
const claude = [asked && asked.claude, deployed && deployed.claude].filter(Boolean);
const out = {};
if (user.length) out.systemMessage = user.join('\n');
if (claude.length) out.hookSpecificOutput = { hookEventName: 'PostToolUse', additionalContext: claude.join('\n') };
if (Object.keys(out).length) process.stdout.write(JSON.stringify(out));
