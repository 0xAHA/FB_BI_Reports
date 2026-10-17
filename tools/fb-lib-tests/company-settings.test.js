// Desk test: FBLib.Settings company defaults (config.company) and Edit Settings publishers,
// against an emulated userproperties table and bireportaccess rows.
//   node --test tools/fb-lib-tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const LIB = require('path').join(__dirname, '..', '..', 'scripts', 'fb-lib.js');
const SRC = fs.readFileSync(LIB, 'utf8');

// The database: userproperties rows (user, key, value) and who has Edit Settings on the report.
function world(editSettings) {
  return { rows: [], nextId: 1, editSettings: editSettings || [] };
}

// A fresh page for one user: fb-lib loaded in its own context, built-ins stubbed onto the database.
function page(db, user, settingsConfig) {
  const ctx = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    FB_REPORT: { key: 'cdx.bi.test', name: 'Test Report', build: 'x' },
    getUser: () => JSON.stringify({ userName: user }),
    hasUserAccess: () => false,
    loadSettings: key => {
      const r = db.rows.filter(x => x.user === user && x.key === key).pop();
      return r ? r.value : null;
    },
    saveSettings: (key, value) => {
      const r = db.rows.find(x => x.user === user && x.key === key);
      if (r) { r.value = value; r.id = db.nextId++; } else db.rows.push({ id: db.nextId++, user, key, value });
    },
    runQuery: sql => {
      if (/FROM bireportaccess/.test(sql)) {
        return JSON.stringify(db.editSettings.map(u => ({ username: u })));
      }
      if (/FROM userproperties/.test(sql)) {
        const key = /up\.userKey = '([^']+)'/.exec(sql)[1];
        const names = (/LOWER\(su\.userName\) IN \(([^)]*)\)/.exec(sql) || [, ''])[1]
          .split(',').map(s => s.trim().replace(/^'|'$/g, '').toLowerCase()).filter(Boolean);
        const trusted = r => !/LOWER\(su\.userName\) IN/.test(sql) || names.includes(r.user.toLowerCase());
        return JSON.stringify(db.rows.filter(r => r.key === key && trusted(r))
          .sort((a, b) => b.id - a.id).map(r => ({ rowid: r.id, shareddata: r.value })));
      }
      return '[]';
    },
    localStorage: { getItem() { return null; }, setItem() {} }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const S = ctx.FBLib.Settings;
  S.init(Object.assign({ masterStorage: 'userProperties', defaults: { filters: null } }, settingsConfig || {}));
  return S;
}

const same = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const COMPANY = { company: { keys: ['filters'], editors: true } };

test('the company filters win over a user\'s own, every open', () => {
  const db = world();
  const carol = page(db, 'carol', COMPANY);
  carol.setUserKey('filters', { lg: 'carol' }); carol.saveUser();
  same(page(db, 'carol', COMPANY).resolve('filters'), { lg: 'carol' }, 'no company value yet: her own');
  const admin = page(db, 'admin', COMPANY);
  assert.equal(admin.isAdmin(), true);
  assert.equal(admin.publishCompany('filters', { lg: 'company' }), true);
  const again = page(db, 'carol', COMPANY);
  same(again.resolve('filters'), { lg: 'company' }, 'company first');
  assert.equal(again.hasCompany('filters'), true);
  again.setUserKey('filters', { lg: 'carol 2' }); again.saveUser();
  same(page(db, 'carol', COMPANY).resolve('filters'), { lg: 'company' }, 'her change does not carry over');
});

test('Stop using them: users go back to their own', () => {
  const db = world();
  const carol = page(db, 'carol', COMPANY);
  carol.setUserKey('filters', { lg: 'carol' }); carol.saveUser();
  const admin = page(db, 'admin', COMPANY);
  admin.publishCompany('filters', { lg: 'company' });
  admin.publishCompany('docPaper', { size: 'A4', orientation: 'portrait' });
  assert.equal(page(db, 'admin', COMPANY).clearCompany(['filters']), true);
  const after = page(db, 'carol', COMPANY);
  same(after.resolve('filters'), { lg: 'carol' });
  same(after.getMaster().docPaper, { size: 'A4', orientation: 'portrait' }, 'other company settings kept');
});

test('Edit Settings users may publish, and are trusted', () => {
  const db = world(['Bob']);
  const bob = page(db, 'bob', COMPANY);
  assert.equal(bob.isAdmin(), true, 'Edit Settings counts');
  same(bob.editors(), ['Bob']);
  assert.equal(bob.publishCompany('filters', { lg: 'from bob' }), true);
  same(page(db, 'carol', COMPANY).resolve('filters'), { lg: 'from bob' });
});

test('anyone else\'s master row is never believed', () => {
  const db = world(['bob']);
  const mallory = page(db, 'mallory', COMPANY);
  assert.equal(mallory.isAdmin(), false);
  assert.equal(mallory.publishCompany('filters', { lg: 'fake' }), false, 'refused');
  // Even written straight into userproperties, it isn't trusted.
  db.rows.push({ id: db.nextId++, user: 'mallory', key: 'cdx.bi.test.master.v1', value: JSON.stringify({ filters: { lg: 'fake' } }) });
  assert.equal(page(db, 'carol', COMPANY).resolve('filters'), null);
});

test('without config.company nothing changes: the user\'s own value first, admin only', () => {
  const db = world(['bob']);
  const carol = page(db, 'carol');
  carol.setUserKey('filters', { lg: 'carol' }); carol.saveUser();
  page(db, 'admin').publishMaster({ filters: { lg: 'company' } });
  same(page(db, 'carol').resolve('filters'), { lg: 'carol' });
  assert.equal(page(db, 'bob').isAdmin(), false, 'Edit Settings alone is not enough without the opt-in');
});
