// Live NWS / USGS feed: parsing (fixtures in tests/fixtures) and the simulation's live mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseValidTime, parseGridData, parseObservations, parseAlerts, parseUSGS, LiveFeed, USGS_SITES } from '../src/sim/live.js';
import { buildHydrology } from '../src/sim/hydrology.js';
import { Simulation } from '../src/sim/engine.js';
import { fromUTC } from '../src/sim/clock.js';

const fx = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));

test('ISO-8601 valid times with durations', () => {
  assert.deepEqual(parseValidTime('2026-01-22T02:00:00+00:00/PT6H'), { start: Date.parse('2026-01-22T02:00:00Z'), hours: 6 });
  assert.equal(parseValidTime('2026-01-21T20:00:00+00:00/P1DT4H').hours, 28);
});

test('grid forecast becomes hourly records; accumulations are spread per hour', () => {
  const recs = parseGridData(fx('nws-grid.json'));
  assert.equal(recs.length, 28);
  const snowHour = recs.find((r) => r.utc === Date.parse('2026-01-22T03:00:00Z'));
  assert.equal(snowHour.precipMm, 1.5);       // 9 mm over 6 h
  assert.equal(snowHour.snowMm, 15);          // 90 mm over 6 h
  assert.ok(Math.abs(snowHour.windMs - 14.8 / 3.6) < 1e-9);
  assert.equal(snowHour.kinds[0].w, 'snow');
});

test('observations, alerts and USGS gauges parse', () => {
  const obs = parseObservations(fx('nws-obs.json'));
  assert.equal(obs.length, 2);
  assert.equal(obs[1].kinds[0].w, 'snow');
  assert.equal(obs[1].precipMm, 0.5);
  const al = parseAlerts(fx('nws-alerts.json'));
  assert.equal(al[0].text, 'Winter Storm Warning');
  assert.equal(al[0].level, 'warning');
  const g = parseUSGS(fx('usgs.json'));
  assert.equal(g[USGS_SITES.frenchBroad].ft, 3.12);
  assert.equal(g[USGS_SITES.frenchBroad].cfs, 2480);
  assert.equal(g[USGS_SITES.swannanoa].ft, 3.55);
});

test('live mode runs the model on the NWS forecast: snow accumulates, the 8 PM call closes, gauges match', () => {
  const feed = new LiveFeed();
  feed.forecast = parseGridData(fx('nws-grid.json'));
  feed.obs = parseObservations(fx('nws-obs.json'));
  feed.alerts = parseAlerts(fx('nws-alerts.json'));
  feed.gauges = parseUSGS(fx('usgs.json'));
  feed.rebuild();
  const sim = new Simulation(buildHydrology(), 7);
  sim.live = feed;
  sim.liveNow = () => fromUTC(Date.parse('2026-01-21T20:00:00Z'));
  sim.setMode('live');
  assert.ok(Math.abs(sim.gaugeFt(3) - 3.12) < 0.05, `French Broad starts at the gauge (${sim.gaugeFt(3).toFixed(2)} ft)`);
  // run from the first observation through the forecast snow
  for (let i = 0; i < 30 * 12; i++) sim.step(1 / 12);
  const snowIn = sim.campus.snowCm / 2.54;
  assert.ok(snowIn > 3, `campus snow ${snowIn.toFixed(1)} in`);
  const d = sim.decisions.get('2026-01-22');
  assert.equal(d.evening.status, 'closed');
  assert.ok(d.evening.reasons.some((r) => /snow/.test(r)));
});

test('rivers stay pinned to the USGS gauges while the clock is at the present', () => {
  const feed = new LiveFeed();
  feed.forecast = parseGridData(fx('nws-grid.json'));
  feed.obs = parseObservations(fx('nws-obs.json'));
  feed.gauges = parseUSGS(fx('usgs.json'));
  feed.meta.gaugeTime = feed.gauges[USGS_SITES.frenchBroad].utc;
  feed.rebuild();
  const sim = new Simulation(buildHydrology(), 7);
  sim.live = feed;
  sim.setMode('live');
  sim.liveNow = () => sim.t; // the clock is always "now"
  for (let i = 0; i < 6 * 12; i++) sim.step(1 / 12);
  assert.ok(Math.abs(sim.gaugeFt(3) - 3.12) < 0.1, `French Broad ${sim.gaugeFt(3).toFixed(2)} ft vs gauge 3.12`);
  assert.ok(Math.abs(sim.gaugeFt(2) - 3.55) < 0.1, `Swannanoa ${sim.gaugeFt(2).toFixed(2)} ft vs gauge 3.55`);
});
