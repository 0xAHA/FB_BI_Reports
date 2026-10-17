// Steps for run.js / ab.js on a record document (FBDoc.Record): open the Filters
// panel, step previous / next, browse the picker and pick its first row.
// Prints one "NAV …" line. The element ids come from REC_IDS="input,prev,next"
// (default recInput,recPrev,recNext).
module.exports = async p => {
  const [inp, prev, next] = (process.env.REC_IDS || 'recInput,recPrev,recNext').split(',');
  const val = () => p.evaluate(i => document.getElementById(i).value, inp);
  const dis = id => p.evaluate(i => { const e = document.getElementById(i); return !e || e.disabled; }, id);
  const log = [];
  await p.evaluate(() => FBLib.Common.togglePanel('filtersPanel', true));
  await p.waitForTimeout(400);
  log.push('start=' + await val());
  log.push('prevDisabled=' + await dis(prev) + ' nextDisabled=' + await dis(next));
  if (!await dis(prev)) { await p.click('#' + prev); await p.waitForTimeout(900); log.push('afterPrev=' + await val()); }
  if (!await dis(next)) { await p.click('#' + next); await p.waitForTimeout(900); log.push('afterNext=' + await val()); }
  await p.click('#' + inp); await p.waitForTimeout(700);
  log.push('browseRows=' + await p.evaluate(() => document.querySelectorAll('.fbdoc-pick-row').length));
  const first = await p.evaluate(() => { const r = document.querySelector('.fbdoc-pick-row .lb'); return r && r.textContent; });
  if (first) {
    await p.dispatchEvent('.fbdoc-pick-row', 'mousedown'); await p.waitForTimeout(900);
    log.push('picked=' + first + ' now=' + await val());
  }
  console.log('NAV ' + log.join(' | '));
};
