import * as THREE from 'three';
import { llToXZ, elevationAt, elevToY, cellIndex, RADIUS_M, N, CELL, mulberry32 } from '../geo.js';
import { CAMPUS_OPS } from '../data/campus-ops.js';
import { STREETS, DRIVES } from '../data/campus.js';
import { pxToLL } from '../campus-geo.js';
import { U, GLSL_COMMON } from './common.js';
import { bandElev, BANDS, BAND_ELEV0, BAND_STEP } from '../sim/engine.js';

// Offline fallback: approximate alignments of the major corridors (replaced by real OpenStreetMap roads when online).
export const FALLBACK_ROADS = [
  { name: 'Hendersonville Rd (US-25)', kind: 'primary', pts: [[35.462, -82.522], [35.476, -82.522], [35.488, -82.523], [35.505, -82.525], [35.5236, -82.5262], [35.540, -82.530], [35.555, -82.537], [35.566, -82.545], [35.580, -82.549], [35.595, -82.551]] },
  { name: 'I-40', kind: 'motorway', pts: [[35.552, -82.625], [35.558, -82.605], [35.563, -82.588], [35.566, -82.567], [35.568, -82.547], [35.572, -82.530], [35.577, -82.512], [35.582, -82.490], [35.588, -82.466], [35.593, -82.440]] },
  { name: 'I-26', kind: 'motorway', pts: [[35.448, -82.545], [35.465, -82.548], [35.483, -82.556], [35.500, -82.565], [35.515, -82.574], [35.533, -82.581], [35.550, -82.588], [35.563, -82.590], [35.580, -82.592], [35.600, -82.590]] },
  { name: 'I-240', kind: 'motorway', pts: [[35.566, -82.590], [35.580, -82.575], [35.592, -82.560], [35.597, -82.548]] },
  { name: 'Blue Ridge Parkway', kind: 'secondary', pts: [[35.492, -82.615], [35.505, -82.585], [35.513, -82.562], [35.516, -82.540], [35.519, -82.528], [35.528, -82.512], [35.542, -82.500], [35.556, -82.490], [35.570, -82.482], [35.583, -82.474], [35.600, -82.465]] },
];

/** Fallback road set: approximate corridors plus the streets and drives digitized from the campus map. */
export function fallbackRoads() {
  const campus = [...STREETS, ...DRIVES].map((r) => ({ name: r.name, kind: r.kind, pts: r.px.map(pxToLL) }));
  const hville = campus.find((r) => r.name.startsWith('Hendersonville'));
  const us25 = FALLBACK_ROADS[0];
  // replace the stretch of US-25 passing campus with the map's alignment
  const lat0 = hville.pts[hville.pts.length - 1][0], lat1 = hville.pts[0][0];
  const south = us25.pts.filter((p) => p[0] < lat0), north = us25.pts.filter((p) => p[0] > lat1);
  const merged = { ...us25, pts: [...south, ...hville.pts.slice().reverse(), ...north] };
  return [merged, ...FALLBACK_ROADS.slice(1), ...campus.filter((r) => r !== hville)];
}
/** Campus-map drives only (used alongside real OpenStreetMap roads). */
export const campusDrives = () => DRIVES.map((r) => ({ name: r.name, kind: r.kind, pts: r.px.map(pxToLL) }));

/** Approximate signal locations when OpenStreetMap is unavailable: CDS entrance + every ~700 m along US-25. */
export function fallbackSignals(roads) {
  const out = [], us25 = roads[0];
  let acc = 700;
  for (let i = 1; i < us25.pts.length; i++) {
    const a = llToXZ(...us25.pts[i - 1]), b = llToXZ(...us25.pts[i]), L = Math.hypot(b.x - a.x, b.z - a.z);
    for (let d = 0; d < L; d += 25) { acc += 25; if (acc >= 700) { acc = 0; out.push({ x: a.x + (b.x - a.x) * d / L, z: a.z + (b.z - a.z) * d / L }); } }
  }
  const e = DRIVES.find((d) => d.name === 'Main entrance');
  const p = llToXZ(...pxToLL(e.px[0]));
  out.push({ x: p.x, z: p.z, name: 'CDS main entrance' });
  return out;
}

const KIND = {
  motorway: { w: 26, major: 1 }, trunk: { w: 22, major: 1 }, primary: { w: 18, major: 1 }, secondary: { w: 14, major: 1 },
  tertiary: { w: 11, major: 0 }, unclassified: { w: 8, major: 0 }, residential: { w: 7, major: 0 },
  service: { w: 6, major: 0 }, motorway_link: { w: 10, major: 1 }, trunk_link: { w: 10, major: 1 }, primary_link: { w: 9, major: 1 }, secondary_link: { w: 9, major: 0 },
};

function roadMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...U },
    side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    vertexShader: /* glsl */`
      attribute float aElev; attribute float aHand; attribute float aDrainElev; attribute float aClass;
      attribute float aMajor; attribute float aHazard; attribute float aAcross;
      varying vec3 vPos; varying float vElev; varying float vHand; varying float vDrainElev; varying float vClass;
      varying float vMajor; varying float vHazard; varying float vAcross;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.); vPos = wp.xyz;
        vElev = aElev; vHand = aHand; vDrainElev = aDrainElev; vClass = aClass; vMajor = aMajor; vHazard = aHazard; vAcross = aAcross;
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      varying vec3 vPos; varying float vElev; varying float vHand; varying float vDrainElev; varying float vClass;
      varying float vMajor; varying float vHazard; varying float vAcross;
      void main(){
        vec3 col = mix(vec3(.17,.17,.18), vec3(.23,.23,.24), vMajor);
        float center = (1. - smoothstep(.03, .07, abs(vAcross))) * vMajor;
        col = mix(col, vec3(.75,.65,.2), center * .7);
        float snow = snowAt(vElev) * mix(.85, .3, vMajor);     // main roads get plowed first
        float snowCov = smoothstep(.5, 4., snow);
        col = mix(col, vec3(.9,.92,.95), snowCov * .92);
        float ice = max(uRoadIce, smoothstep(.5, 3., iceAt(vElev)));
        float depth = stageFor(vClass) + vDrainElev - vElev;
        float flooded = smoothstep(.05, .35, depth);
        // bridges & culverts over normally-wet channels only close when the water rises well above normal
        if (vElev - vDrainElev < stageFor(vClass) - riseFor(vClass) + .2) flooded = smoothstep(2.5, 3.2, riseFor(vClass));
        col = mix(col, vec3(.38,.30,.2), flooded);
        if (uRoadStatus > .5) {
          // hazard codes from the road evaluator: 0 clear, 1 snow, 2 ice, 3 flooded, 4 blocked, 5 signal out
          vec3 s = vec3(.2,.8,.35);
          if (vHazard > .5) s = vec3(.95,.95,1.);
          if (vHazard > 1.5) s = vec3(.3,.9,1.);
          if (vHazard > 2.5) s = vec3(.15,.35,1.);
          if (vHazard > 3.5) s = vec3(1.,.15,.1);
          if (vHazard > 4.5) s = vec3(1.,.6,.1);
          gl_FragColor = vec4(s * (.8 + .2 * max(uSunDir.y, 0.)) + s * .2, 1.);
          return;
        }
        if (abs(vHazard - 4.) < .5) col = mix(col, vec3(.35,.25,.12), .6);
        vec3 viewDir = normalize(cameraPosition - vPos);
        vec3 lit = lighting(vec3(0,1,0), col, 60., .05 + ice * .9 + uWet * .25, viewDir);
        gl_FragColor = vec4(applyFog(lit, vPos, vElev), 1.);
      }`,
  });
}

/** Builds draped road ribbons and a sample list used to evaluate road conditions. */
/**
 * opts: { cellIndex, widthScale, clip(x, z) → true to skip, inRadius(x, z) } — the regional level passes its own grid
 * lookup, wider ribbons (seen from tens of miles away) and clips out the detailed 5-mile core.
 */
export function buildRoads(ways, hydro, cover, opts = {}) {
  const cIdx = opts.cellIndex || cellIndex, wScale = opts.widthScale || 1;
  const pos = [], attrs = { aElev: [], aHand: [], aDrainElev: [], aClass: [], aMajor: [], aHazard: [], aAcross: [] };
  const index = [];
  const samples = [];
  const rnd = mulberry32(77);
  let vcount = 0;
  const list = [...ways];
  for (const way of list) {
    const K0 = KIND[way.kind] || KIND.residential, K = { ...K0, w: K0.w * wScale };
    let pts = way.xz ? way.pts.map(([x, z]) => ({ x, z })) : way.pts.map(([lat, lon]) => llToXZ(lat, lon));
    if (opts.clip && !way.noClip) {
      // split the way where it enters the clipped area; keep the longest outside run (good enough for highways)
      const runs = []; let cur = [];
      for (const p of pts) { if (opts.clip(p.x, p.z)) { if (cur.length > 1) runs.push(cur); cur = []; } else cur.push(p); }
      if (cur.length > 1) runs.push(cur);
      for (const r of runs.slice(1)) list.push({ ...way, pts: r.map((p) => [p.x, p.z]), xz: true, noClip: true });
      pts = runs[0] || [];
    }
    if (pts.length < 2) continue;
    // resample to ~20 m spacing
    const rs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 20));
      for (let s = 0; s < n; s++) rs.push({ x: a.x + (b.x - a.x) * s / n, z: a.z + (b.z - a.z) * s / n });
    }
    rs.push(pts[pts.length - 1]);
    if (rs.length < 2) continue;
    const start = vcount;
    let acc = 0;
    let blockR = rnd();
    for (let i = 0; i < rs.length; i++) {
      const p = rs[i], q = rs[Math.min(rs.length - 1, i + 1)], o = rs[Math.max(0, i - 1)];
      let dx = q.x - o.x, dz = q.z - o.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      const nx = -dz, nz = dx;
      const e = elevationAt(p.x, p.z);
      const k = cIdx(p.x, p.z);
      const far = hydro.hand[k] > 100;
      for (const side of [-1, 1]) {
        const sx = p.x + nx * side * K.w / 2, sz = p.z + nz * side * K.w / 2;
        const y = Math.max(elevToY(elevationAt(sx, sz), sx, sz), elevToY(e, p.x, p.z)) + 2.5 + K.w * 0.05;
        pos.push(sx, y, sz);
        attrs.aElev.push(e); attrs.aHand.push(far ? 999 : hydro.hand[k]); attrs.aDrainElev.push(far ? -999 : hydro.drainElev[k]);
        attrs.aClass.push(far ? 0 : hydro.drainClass[k]); attrs.aMajor.push(K.major); attrs.aHazard.push(0); attrs.aAcross.push(side * 0.5);
      }
      if (i > 0) { const a = vcount - 2, b = vcount - 1, c = vcount, d = vcount + 1; index.push(a, c, b, b, c, d); }
      vcount += 2;
      if (i > 0) acc += Math.hypot(p.x - o.x, p.z - o.z);
      // condition samples every ~60 m; a "block" draw shared along ~300 m stretches (one fallen tree closes a stretch)
      if (i % 3 === 0) {
        if (i % 15 === 0) blockR = rnd();
        samples.push({ x: p.x, z: p.z, e, k, far, major: K.major, name: way.name || '', len: 60, blockR, verts: [vcount - 2, vcount - 1],
          inR: opts.inRadius ? opts.inRadius(p.x, p.z) : Math.hypot(p.x, p.z) <= RADIUS_M, shade: shadeAt(p.x, p.z, cover), service: way.kind === 'service' });
      }
    }
    // extend each sample's vertex coverage to the following vertices for blocked coloring
    for (let s = samples.length - 1; s >= 0 && samples[s].verts[0] >= start; s--) {
      const v0 = samples[s].verts[0];
      samples[s].verts = [];
      for (let v = v0; v < Math.min(vcount, v0 + 6); v++) samples[s].verts.push(v);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  for (const [k, v] of Object.entries(attrs)) g.setAttribute(k, new THREE.Float32BufferAttribute(v, 1));
  g.setIndex(index);
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, roadMaterial());
  mesh.renderOrder = 2;
  return { mesh, samples };
}

/** 0..1: how shaded a spot is in winter — north-facing slopes and dense tree canopy hold ice longest. */
function shadeAt(x, z, cover) {
  const d = CELL;
  const gx = (elevationAt(x + d, z) - elevationAt(x - d, z)) / (2 * d), gz = (elevationAt(x, z + d) - elevationAt(x, z - d)) / (2 * d);
  const g = Math.hypot(gx, gz), slope = Math.atan(g) * 180 / Math.PI;
  const north = g > 1e-4 ? Math.max(0, gz / g) : 0; // ground rising to the south = facing north
  const canopy = cover && Math.abs(x) < 8800 && Math.abs(z) < 8800 ? (1 - cover[cellIndex(x, z)]) * 0.45 : 0;
  return Math.min(1, Math.min(1, slope / 12) * north + canopy);
}

const bandLookup = (arr, e) => {
  const f = Math.max(0, Math.min(BANDS - 1, (e - BAND_ELEV0) / BAND_STEP)), i = Math.floor(f), t = f - i;
  return arr[i] * (1 - t) + arr[Math.min(BANDS - 1, i + 1)] * t;
};

/** Returns a function the simulation calls to summarize road conditions within the 5-mile radius. */
export function makeRoadEvaluator(roads, hydro, signals = [], opts = {}) {
  const slideCells = new Set();
  let slidesSeen = 0;
  const hazAttr = roads.mesh.geometry.attributes.aHazard;
  const rnd = mulberry32(99);
  const sig = signals.map((p) => ({ ...p, r: 0.08 + rnd() * 0.85 }));
  // which samples sit near a signal (so a dark signal marks that stretch)
  for (const s of roads.samples) s.signal = sig.find((g) => Math.hypot(g.x - s.x, g.z - s.z) < 45) || null;
  const routes = CAMPUS_OPS.roads.routes.map((r) => ({ ...r, samples: roads.samples.filter((s) => {
    if (!s.name.includes(r.road) || Math.hypot(s.x, s.z) > 4500) return false;
    return r.side === 'north' ? s.z < -250 : r.side === 'south' ? s.z > 250 : true;
  }) }));
  return (sim) => {
    if (opts.noSlides) slidesSeen = sim.landslides.length;
    for (; slidesSeen < sim.landslides.length; slidesSeen++) {
      for (const k of sim.landslides[slidesSeen].path) for (const d of [0, 1, -1, N, -N, N + 1, N - 1, -N + 1, -N - 1]) slideCells.add(k + d);
    }
    if (sim.landslides.length === 0 && slideCells.size) { slideCells.clear(); slidesSeen = 0; }
    const backup = CAMPUS_OPS.roads.trafficSignalsHaveBackup;
    for (const g of sig) g.out = !backup && (sim.powerOut > g.r || (g.name === 'CDS main entrance' && sim.ops && !sim.ops.utilityOn));
    let total = 0, flooded = 0, blocked = 0, snow = 0, icy = 0, imp = 0, haz = 0;
    const closures = new Map();
    let dirty = false;
    for (const s of roads.samples) {
      const c = hydro.drainClass[s.k];
      const depth = s.far ? -1 : sim.stages[c] - hydro.hand[s.k];
      // a crossing of a normally-wet channel is a bridge or culvert: it closes only when the water rises ~3 m
      const bridge = !s.far && hydro.hand[s.k] < sim.stages[c] - sim.riseM(c) + 0.2;
      const fl = bridge ? sim.riseM(c) > 3 : depth > 0.25;
      const cleared = Math.max(0, 1 - sim.clearance * (s.major ? 2 : 1));
      const bl = sim.treesDownFrac * (s.major ? 1.5 : 5) * cleared > s.blockR || slideCells.has(s.k);
      const snowCm = bandLookup(sim.snowCm, s.e) * (s.major ? 0.3 : 0.85);
      const sn = snowCm > 2.5;
      const T = bandLookup(sim.bandT, s.e);
      // bridges and shaded stretches freeze first; open sunny roads only when black ice is widespread
      const ic = (T < 0.5 && (sim.roadIce > 0.6 || (sim.roadIce > 0.2 && (bridge || s.shade > 0.4)))) || bandLookup(sim.iceMm, s.e) > 1;
      const sigOut = s.signal && s.signal.out;
      const im = fl || bl || snowCm > 15;
      const code = bl ? 4 : fl ? 3 : ic ? 2 : sigOut ? 5 : sn ? 1 : 0;
      s.code = code; s.icy = ic; s.flooded = fl; s.blocked = bl; s.imp = im; s.snow = sn; s.bridge = bridge;
      if (s.lastCode !== code) {
        s.lastCode = code; dirty = true;
        for (const v of s.verts) hazAttr.array[v] = code;
      }
      if (!s.inR || s.service) continue;
      total += s.len;
      if (fl) flooded += s.len; if (bl) blocked += s.len; if (sn) snow += s.len; if (ic) icy += s.len; if (im) imp += s.len;
      if (code) haz += s.len;
      if (im && s.name) closures.set(s.name, (closures.get(s.name) || 0) + s.len * (s.major ? 3 : 1));
    }
    if (dirty) hazAttr.needsUpdate = true;
    const pct = (v) => (total ? (100 * v) / total : 0);
    const routeReport = routes.map((r) => {
      const n = (f) => r.samples.filter(f).length;
      const nImp = n((s) => s.imp), nFl = n((s) => s.flooded), nBl = n((s) => s.blocked), nIce = n((s) => s.icy), nSn = n((s) => s.snow);
      const nSig = new Set(r.samples.filter((s) => s.signal && s.signal.out).map((s) => s.signal)).size;
      const parts = [];
      if (nFl) parts.push(`flooded in ${nFl > 3 ? 'several places' : 'places'}`);
      if (nBl) parts.push('trees/debris blocking lanes');
      if (nIce) parts.push(nIce === r.samples.filter((s) => s.bridge || s.shade > 0.4).length && nIce < r.samples.length / 2 ? 'icy bridges & shaded curves' : 'icy');
      if (nSn) parts.push('snow-covered');
      if (nSig) parts.push(`${nSig} signal${nSig > 1 ? 's' : ''} dark`);
      const level = nImp ? 2 : parts.length ? 1 : 0;
      return { name: r.name, share: r.share, level, text: parts.length ? (nImp ? 'CLOSED — ' : '') + parts.join(', ') : 'clear' };
    });
    return {
      totalKm: total / 1000, floodedPct: pct(flooded), blockedPct: pct(blocked), snowPct: pct(snow), icyPct: pct(icy), impassablePct: pct(imp),
      hazardPct: pct(haz), signalsOut: sig.filter((g) => g.out).length, signalsTotal: sig.length, lowVis: sim.visibilityMi() < 0.5,
      routes: routeReport,
      closures: [...closures.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map((e) => e[0]),
    };
  };
}
