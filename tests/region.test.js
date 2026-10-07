// The outer 30-mile level: terrain, rivers, mountain snow and regional highways.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionHydrology } from '../src/render/region.js';
import { relev, RN, REGION_RADIUS_M } from '../src/geo-region.js';
import { elevationAt, llToXZ } from '../src/geo.js';
import { Simulation, bandAt } from '../src/sim/engine.js';
import { buildHydrology } from '../src/sim/hydrology.js';
import { SITES } from '../src/sim/region.js';

test('regional terrain reaches Mt. Mitchell and joins the detailed core seamlessly', () => {
  let hi = 0; for (const e of relev) hi = Math.max(hi, e);
  assert.ok(hi > 1950 && hi < 2060, `highest point ${hi} m (Mt. Mitchell 2,037 m)`);
  const inside = elevationAt(8790, 0), outside = elevationAt(8810, 0);
  assert.ok(Math.abs(inside - outside) < 15, `seam step ${Math.abs(inside - outside).toFixed(1)} m`);
  assert.ok(REGION_RADIUS_M > 48000);
});

test('regional rivers: the French Broad drains the region', () => {
  const rh = regionHydrology();
  let max = 0; for (const a of rh.acc) max = Math.max(max, a);
  assert.ok(max > 2000, `largest drainage ${max.toFixed(0)} km²`);
  const p = llToXZ(35.565, -82.565); // French Broad near I-40
  const k = Math.round((p.z + 50500) / (101000 / (RN - 1))) * RN + Math.round((p.x + 50500) / (101000 / (RN - 1)));
  let best = 0; for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) best = Math.max(best, rh.acc[k + dj * RN + di] || 0);
  assert.ok(best > 1000, `French Broad at Asheville drains ${best.toFixed(0)} km²`);
});

test('every weather cam sits inside the 30-mile region', () => {
  for (const s of SITES) assert.ok(s.distMi <= 30, s.name);
});

test('Blizzard of 93 buries Mt. Mitchell far deeper than campus', () => {
  const sim = new Simulation(buildHydrology(), 1234);
  sim.setMode('scenario', 'blizzard93');
  for (let i = 0; i < 36 * 12; i++) sim.step(1 / 12);
  const mitchell = bandAt(sim.snowCm, 2037) / 2.54, campus = sim.campus.snowCm / 2.54;
  assert.ok(mitchell > campus * 1.6, `Mitchell ${mitchell.toFixed(0)}" vs campus ${campus.toFixed(0)}"`);
});

test('baked regional highways reach every weather cam and get evaluated', async () => {
  const { bakedRegionOSM } = await import('../src/render/osm.js');
  const ways = bakedRegionOSM();
  assert.ok(ways && ways.length > 2000, 'regional OSM highways baked in');
  const pts = ways.flatMap((w) => w.pts.map(([la, lo]) => llToXZ(la, lo)));
  for (const s of SITES) {
    const p = llToXZ(s.lat, s.lon);
    const d = Math.min(...pts.map((q) => Math.hypot(q.x - p.x, q.z - p.z)));
    assert.ok(d < 1500, `${s.name}: nearest highway ${d.toFixed(0)} m`);
  }
});
