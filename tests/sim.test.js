// Sanity & calibration tests for the simulation core:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHydrology, RIVER_CLASS } from '../src/sim/hydrology.js';
import { Simulation, precipType, IN } from '../src/sim/engine.js';
import { localMs, sunPosition } from '../src/sim/clock.js';
import { N, elev } from '../src/geo.js';

const hydro = buildHydrology();

function run(id, hours) {
  const sim = new Simulation(hydro, 1234);
  sim.setMode('scenario', id);
  for (let i = 0; i < hours * 12; i++) sim.step(1 / 12);
  return sim;
}

test('terrain covers the Asheville valley and surrounding ridges', () => {
  let lo = Infinity, hi = -Infinity;
  for (const e of elev) { lo = Math.min(lo, e); hi = Math.max(hi, e); }
  assert.ok(lo > 560 && lo < 620, `lowest point ${lo} m should be the French Broad (~600 m)`);
  assert.ok(hi > 1100 && hi < 1400, `highest point ${hi} m`);
});

test('river network includes the French Broad and Swannanoa', () => {
  let fb = 0, sw = 0;
  for (const c of hydro.cls) { if (c === RIVER_CLASS.FRENCH_BROAD) fb++; if (c === RIVER_CLASS.SWANNANOA) sw++; }
  assert.ok(fb > 300, `French Broad cells: ${fb}`);
  assert.ok(sw > 150, `Swannanoa cells: ${sw}`);
  // HAND is zero on channels and never negative
  for (let k = 0; k < N * N; k += 97) assert.ok(hydro.hand[k] >= 0);
});

test('precipitation type follows the temperature profile', () => {
  assert.equal(precipType(10, 8), 'rain');
  assert.equal(precipType(-4, -6), 'snow');
  assert.equal(precipType(-1.5, 4), 'fzra');
  assert.equal(precipType(-1.5, 1.5), 'sleet');
});

test('sun is high at noon in June and below the horizon at midnight', () => {
  assert.ok(sunPosition(localMs(2026, 6, 21, 13, 30)).elevation > 70);
  assert.ok(sunPosition(localMs(2026, 6, 21, 0, 0)).elevation < -20);
});

test('Helene scenario reproduces record river crests', () => {
  const sim = run('helene', 90);
  const rain = sim.rainTotalMm / IN;
  assert.ok(rain > 13 && rain < 19, `rain total ${rain.toFixed(1)} in`);
  assert.ok(sim.peak.fb > 21 && sim.peak.fb < 28, `French Broad crest ${sim.peak.fb.toFixed(1)} ft (Helene: 24.67)`);
  assert.ok(sim.peak.sw > 22 && sim.peak.sw < 30, `Swannanoa crest ${sim.peak.sw.toFixed(1)} ft (Helene: ~26)`);
  assert.ok(sim.landslides.length > 5, 'saturated slopes should fail');
  assert.ok(sim.powerOut > 0.5, 'widespread outages');
  assert.equal([...sim.decisions.values()].find((d) => d.status !== 'weekend' && d.t > localMs(2024, 9, 27)).status, 'closed');
});

test('Blizzard of 93 buries the campus and the ridges get more', () => {
  const sim = run('blizzard93', 36);
  const campus = sim.campus.snowCm / 2.54, ridge = sim.snowCm[7] / 2.54;
  assert.ok(campus > 14 && campus < 30, `campus snow ${campus.toFixed(1)} in`);
  assert.ok(ridge > campus, 'orographic enhancement on ridges');
});

test('ice storm accretes damaging glaze but no snow', () => {
  const sim = run('ice2005', 30);
  const iceIn = Math.max(...sim.iceMm) / IN;
  assert.ok(iceIn > 0.3 && iceIn < 1.2, `ice ${iceIn.toFixed(2)} in`);
  assert.ok(sim.treesDownFrac > 0.01);
});

test('local thunderstorm floods creeks without a big French Broad rise', () => {
  const sim = run('tstorm', 8);
  assert.ok(sim.peak.fb < 9, `French Broad ${sim.peak.fb.toFixed(1)} ft`);
  assert.ok(sim.alerts.length > 0 || sim.history.some((h) => h.rainIn > 1.5), 'a flash-flood-producing downpour occurred');
});

test('automatic climate stays near Asheville normals', () => {
  const sim = new Simulation(hydro, 5);
  sim.setMode('auto');
  sim.reset(localMs(2026, 7, 1, 0, 0));
  let sum = 0, n = 0;
  for (let i = 0; i < 24 * 30 * 2; i++) { sim.step(0.5); sum += sim.wx.tempC; n++; }
  const meanF = (sum / n) * 9 / 5 + 32;
  assert.ok(meanF > 66 && meanF < 82, `July mean ${meanF.toFixed(1)} °F (normal ~74)`);
  const rain = sim.rainTotalMm / IN;
  assert.ok(rain > 1 && rain < 14, `July rain ${rain.toFixed(1)} in (normal ~4)`);
});
