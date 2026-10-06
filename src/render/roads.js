import * as THREE from 'three';
import { llToXZ, elevationAt, elevToY, cellIndex, RADIUS_M, N, mulberry32 } from '../geo.js';
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

const KIND = {
  motorway: { w: 26, major: 1 }, trunk: { w: 22, major: 1 }, primary: { w: 18, major: 1 }, secondary: { w: 14, major: 1 },
  tertiary: { w: 11, major: 0 }, unclassified: { w: 8, major: 0 }, residential: { w: 7, major: 0 },
  motorway_link: { w: 10, major: 1 }, trunk_link: { w: 10, major: 1 }, primary_link: { w: 9, major: 1 }, secondary_link: { w: 9, major: 0 },
};

function roadMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...U },
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    vertexShader: /* glsl */`
      attribute float aElev; attribute float aHand; attribute float aDrainElev; attribute float aClass;
      attribute float aMajor; attribute float aBlocked; attribute float aAcross;
      varying vec3 vPos; varying float vElev; varying float vHand; varying float vDrainElev; varying float vClass;
      varying float vMajor; varying float vBlocked; varying float vAcross;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.); vPos = wp.xyz;
        vElev = aElev; vHand = aHand; vDrainElev = aDrainElev; vClass = aClass; vMajor = aMajor; vBlocked = aBlocked; vAcross = aAcross;
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      varying vec3 vPos; varying float vElev; varying float vHand; varying float vDrainElev; varying float vClass;
      varying float vMajor; varying float vBlocked; varying float vAcross;
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
          vec3 s = vec3(.2,.8,.35);
          if (snowCov > .5) s = vec3(.95,.95,1.);
          if (ice > .6) s = vec3(.3,.9,1.);
          if (flooded > .5) s = vec3(.15,.35,1.);
          if (vBlocked > .5) s = vec3(1.,.15,.1);
          col = s; 
          gl_FragColor = vec4(col * (.75 + .25 * max(dot(vec3(0,1,0), uSunDir), 0.)) + col * .25, 1.);
          return;
        }
        if (vBlocked > .5) col = mix(col, vec3(.35,.25,.12), .6);
        vec3 viewDir = normalize(cameraPosition - vPos);
        vec3 lit = lighting(vec3(0,1,0), col, 60., .05 + ice * .9 + uWet * .25, viewDir);
        gl_FragColor = vec4(applyFog(lit, vPos, vElev), 1.);
      }`,
  });
}

/** Builds draped road ribbons and a sample list used to evaluate road conditions. */
export function buildRoads(ways, hydro) {
  const pos = [], attrs = { aElev: [], aHand: [], aDrainElev: [], aClass: [], aMajor: [], aBlocked: [], aAcross: [] };
  const index = [];
  const samples = [];
  const rnd = mulberry32(77);
  let vcount = 0;
  for (const way of ways) {
    const K = KIND[way.kind] || KIND.residential;
    const pts = way.pts.map(([lat, lon]) => llToXZ(lat, lon));
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
      const k = cellIndex(p.x, p.z);
      const far = hydro.hand[k] > 100;
      for (const side of [-1, 1]) {
        const sx = p.x + nx * side * K.w / 2, sz = p.z + nz * side * K.w / 2;
        const y = Math.max(elevToY(elevationAt(sx, sz)), elevToY(e)) + 1.5 + K.w * 0.04;
        pos.push(sx, y, sz);
        attrs.aElev.push(e); attrs.aHand.push(far ? 999 : hydro.hand[k]); attrs.aDrainElev.push(far ? -999 : hydro.drainElev[k]);
        attrs.aClass.push(far ? 0 : hydro.drainClass[k]); attrs.aMajor.push(K.major); attrs.aBlocked.push(0); attrs.aAcross.push(side * 0.5);
      }
      if (i > 0) { const a = vcount - 2, b = vcount - 1, c = vcount, d = vcount + 1; index.push(a, c, b, b, c, d); }
      vcount += 2;
      if (i > 0) acc += Math.hypot(p.x - o.x, p.z - o.z);
      // condition samples every ~60 m; a "block" draw shared along ~300 m stretches (one fallen tree closes a stretch)
      if (i % 3 === 0) {
        if (i % 15 === 0) blockR = rnd();
        samples.push({ x: p.x, z: p.z, e, k, far, major: K.major, name: way.name || '', len: 60, blockR, verts: [vcount - 2, vcount - 1], inR: Math.hypot(p.x, p.z) <= RADIUS_M });
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

const bandLookup = (arr, e) => {
  const f = Math.max(0, Math.min(BANDS - 1, (e - BAND_ELEV0) / BAND_STEP)), i = Math.floor(f), t = f - i;
  return arr[i] * (1 - t) + arr[Math.min(BANDS - 1, i + 1)] * t;
};

/** Returns a function the simulation calls to summarize road conditions within the 5-mile radius. */
export function makeRoadEvaluator(roads, hydro) {
  const slideCells = new Set();
  let slidesSeen = 0;
  const blockedAttr = roads.mesh.geometry.attributes.aBlocked;
  return (sim) => {
    for (; slidesSeen < sim.landslides.length; slidesSeen++) {
      for (const k of sim.landslides[slidesSeen].path) for (const d of [0, 1, -1, N, -N, N + 1, N - 1, -N + 1, -N - 1]) slideCells.add(k + d);
    }
    if (sim.landslides.length === 0 && slideCells.size) { slideCells.clear(); slidesSeen = 0; }
    let total = 0, flooded = 0, blocked = 0, snow = 0, icy = 0, imp = 0;
    const closures = new Map();
    let dirty = false;
    for (const s of roads.samples) {
      const c = hydro.drainClass[s.k];
      const depth = s.far ? -1 : sim.stages[c] - hydro.hand[s.k];
      // a crossing of a normally-wet channel is a bridge or culvert: it closes only when the water rises ~3 m
      const bridge = !s.far && hydro.hand[s.k] < sim.stages[c] - sim.riseM(c) + 0.2;
      const fl = bridge ? sim.riseM(c) > 3 : depth > 0.25;
      const bl = sim.treesDownFrac * (s.major ? 1.5 : 5) > s.blockR || slideCells.has(s.k);
      const sn = bandLookup(sim.snowCm, s.e) * (s.major ? 0.3 : 0.85) > 2.5;
      const ic = (sim.roadIce > 0.6 && bandLookup(sim.bandT, s.e) < 0.5) || bandLookup(sim.iceMm, s.e) > 1;
      const deepSnow = bandLookup(sim.snowCm, s.e) * (s.major ? 0.3 : 0.85) > 15;
      const im = fl || bl || deepSnow;
      if (s.blocked !== bl) {
        s.blocked = bl; dirty = true;
        for (const v of s.verts) blockedAttr.array[v] = bl ? 1 : 0;
      }
      if (!s.inR) continue;
      total += s.len;
      if (fl) flooded += s.len; if (bl) blocked += s.len; if (sn) snow += s.len; if (ic) icy += s.len; if (im) imp += s.len;
      if (im && s.name) closures.set(s.name, (closures.get(s.name) || 0) + s.len * (s.major ? 3 : 1));
    }
    if (dirty) blockedAttr.needsUpdate = true;
    const pct = (v) => (total ? (100 * v) / total : 0);
    return {
      totalKm: total / 1000, floodedPct: pct(flooded), blockedPct: pct(blocked), snowPct: pct(snow), icyPct: pct(icy), impassablePct: pct(imp),
      closures: [...closures.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map((e) => e[0]),
    };
  };
}
