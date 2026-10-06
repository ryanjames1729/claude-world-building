// Campus operations: power, IT and road-safety outcomes for each scenario:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHydrology } from '../src/sim/hydrology.js';
import { Simulation } from '../src/sim/engine.js';
import { buildRoads, makeRoadEvaluator, fallbackRoads, fallbackSignals } from '../src/render/roads.js';
import { LEVEL } from '../src/sim/ops.js';
import { BUILDINGS } from '../src/data/campus.js';
import { BUILDING_XZ } from '../src/campus-geo.js';

const hydro = buildHydrology();
const ways = fallbackRoads();
const roads = buildRoads(ways, hydro);

function run(id, hours, seed = 1234) {
  const sim = new Simulation(hydro, seed);
  sim.roadEvaluator = makeRoadEvaluator(roads, hydro, fallbackSignals(ways));
  sim.setMode('scenario', id);
  const worst = { power: 0, it: 0, roads: 0 }, seen = { utilityOff: false, internetDown: false, signalsOut: 0, icy: 0, routeClosed: false };
  for (let i = 0; i < hours * 12; i++) {
    sim.step(1 / 12);
    const r = sim.opsReport;
    for (const k of Object.keys(worst)) worst[k] = Math.max(worst[k], r[k].level);
    seen.utilityOff ||= !sim.ops.utilityOn;
    seen.internetDown ||= !sim.ops.internetUp;
    seen.signalsOut = Math.max(seen.signalsOut, sim.roads.signalsOut);
    seen.icy = Math.max(seen.icy, sim.roads.icyPct);
    seen.routeClosed ||= sim.roads.routes.some((x) => x.level === 2);
  }
  return { sim, worst, seen };
}

test('campus map is placed sensibly: buildings within ~400 m of center, Nash east of Love Hall', () => {
  for (const b of BUILDINGS) assert.ok(Math.hypot(BUILDING_XZ[b.id].x, BUILDING_XZ[b.id].z) < 450, b.name);
  assert.ok(BUILDING_XZ[9].x > BUILDING_XZ[8].x);
  assert.ok(BUILDING_XZ[5].z < BUILDING_XZ[10].z, 'Upper School is north of Stephens Hall');
});

test('family routes are found on the road network', () => {
  const ev = makeRoadEvaluator(roads, hydro, fallbackSignals(ways));
  const sim = new Simulation(hydro, 1);
  const r = ev(sim);
  assert.equal(r.routes.length, 3);
  assert.ok(r.signalsTotal >= 5);
});

test('a calm day keeps every system normal', () => {
  const sim = new Simulation(hydro, 3);
  sim.roadEvaluator = makeRoadEvaluator(roads, hydro, fallbackSignals(ways));
  sim.setMode('manual');
  Object.assign(sim.manual, { tempF: 70, rainInHr: 0, windMph: 5, gustMph: 8, cloud: 0.2, fog: 0, thunder: 0 });
  for (let i = 0; i < 24 * 12; i++) sim.step(1 / 12);
  const r = sim.opsReport;
  assert.deepEqual([r.power.level, r.it.level, r.roads.level], [LEVEL.ok, LEVEL.ok, LEVEL.ok]);
});

test('Helene knocks out campus power and internet, darkens signals and closes routes', () => {
  const { worst, seen } = run('helene', 90);
  assert.ok(seen.utilityOff, 'utility power lost');
  assert.ok(seen.internetDown, 'internet lost');
  assert.ok(seen.signalsOut > 0, 'traffic signals dark');
  assert.ok(seen.routeClosed, 'a family route closed');
  assert.equal(worst.power, LEVEL.critical);
  assert.equal(worst.it, LEVEL.critical);
  assert.equal(worst.roads, LEVEL.critical);
});

test('the ice storm causes power trouble and icy roads', () => {
  const { worst, seen } = run('ice2005', 40);
  assert.ok(worst.power >= LEVEL.watch);
  assert.ok(seen.icy > 5, `icy roads ${seen.icy.toFixed(1)}%`);
  assert.ok(worst.roads >= LEVEL.watch);
});

test('the January snowstorm makes driving hazardous but campus stays powered', () => {
  const { worst, sim } = run('jansnow', 40);
  assert.ok(worst.roads >= LEVEL.watch);
  assert.ok(sim.ops.utilityOn);
});
