'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Dates } = require('../../../scripts/fb-report.js');

const at = (preset, today, fyStart) => Dates.resolve({ preset }, { today, fyStart: fyStart || 7 });

test('financial years start in the configured month and end the month before', () => {
    assert.deepStrictEqual(at('current_fy', '2026-10-14'), { from: '2026-07-01', to: '2027-06-30' });
    assert.deepStrictEqual(at('current_fy', '2026-03-01'), { from: '2025-07-01', to: '2026-06-30' });
    assert.deepStrictEqual(at('last_fy', '2026-10-14'), { from: '2025-07-01', to: '2026-06-30' });
    assert.deepStrictEqual(at('current_fy', '2026-10-14', 1), { from: '2026-01-01', to: '2026-12-31' });
    assert.deepStrictEqual(at('fy_to_date', '2026-10-14'), { from: '2026-07-01', to: '2026-10-14' });
});

test('calendar presets', () => {
    assert.deepStrictEqual(at('this_month', '2026-02-10'), { from: '2026-02-01', to: '2026-02-28' });
    assert.deepStrictEqual(at('last_month', '2026-01-10'), { from: '2025-12-01', to: '2025-12-31' });
    assert.deepStrictEqual(at('last_quarter', '2026-02-10'), { from: '2025-10-01', to: '2025-12-31' });
    assert.deepStrictEqual(at('this_week', '2026-10-14'), { from: '2026-10-12', to: '2026-10-18' });   // Monday start
    assert.deepStrictEqual(at('last_7', '2026-03-02'), { from: '2026-02-24', to: '2026-03-02' });
    assert.deepStrictEqual(at('year_to_date', '2026-10-14'), { from: '2026-01-01', to: '2026-10-14' });
});

test('explicit ranges and bad input', () => {
    assert.deepStrictEqual(Dates.resolve({ from: '2026-01-01', to: '2026-01-31' }, {}), { from: '2026-01-01', to: '2026-01-31' });
    assert.deepStrictEqual(Dates.resolve({ from: '2026-01-01' }, {}), { from: '2026-01-01', to: null });
    assert.strictEqual(Dates.resolve({ preset: 'nope' }, { today: '2026-01-01' }), null);
    assert.strictEqual(Dates.resolve({ from: "x' OR 1" }, {}), null);
});
