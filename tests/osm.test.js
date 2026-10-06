// The baked OpenStreetMap snapshot: alignment with the GPS-placed campus and hazard tests on real roads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bakedOSM } from '../src/render/osm.js';
import { buildHydrology } from '../src/sim/hydrology.js';
import { Simulation } from '../src/sim/engine.js';
import { buildRoads, makeRoadEvaluator, campusDrives } from '../src/render/roads.js';
import { llToXZ } from '../src/geo.js';
import { pxToXZ, BUILDING_XZ, pointInPoly } from '../src/campus-geo.js';

const osm = bakedOSM();
const hydro = buildHydrology();

test('snapshot has real roads, signals and the CDS property', () => {
  assert.ok(osm.roads.length > 1000);
  assert.ok(osm.signals.length > 100);
  assert.ok(osm.school);
});

test('GPS-placed campus lines up with OpenStreetMap', () => {
  const outline = osm.school.pts.map(([la, lo]) => llToXZ(la, lo));
  const inside = Object.values(BUILDING_XZ).filter((b) => pointInPoly(b.x, b.z, outline)).length;
  assert.ok(inside >= 9, `${inside}/10 campus buildings inside the OSM school outline`);
  const hv = osm.roads.filter((r) => r.name.includes('Hendersonville')).flatMap((r) => r.pts.map(([la, lo]) => llToXZ(la, lo)));
  const e = pxToXZ([1042, 465]);
  const d = Math.min(...hv.map((q) => Math.hypot(q.x - e.x, q.z - e.z)));
  assert.ok(d < 25, `main entrance ${d.toFixed(0)} m from Hendersonville Road`);
});

test('Helene closes family routes and darkens real traffic signals', () => {
  const ways = [...osm.roads, ...campusDrives()];
  const roads = buildRoads(ways, hydro);
  const sim = new Simulation(hydro, 1234);
  sim.roadEvaluator = makeRoadEvaluator(roads, hydro, osm.signals.map(([la, lo]) => llToXZ(la, lo)));
  sim.setMode('scenario', 'helene');
  let closed = 0, dark = 0;
  for (let i = 0; i < 60 * 12; i++) {
    sim.step(1 / 12);
    closed = Math.max(closed, sim.roads.routes.filter((r) => r.level === 2).length);
    dark = Math.max(dark, sim.roads.signalsOut);
  }
  assert.equal(sim.roads.routes.length, 3);
  assert.ok(closed >= 2, `${closed} family routes closed`);
  assert.ok(dark > 20, `${dark} signals dark`);
});
