// The outer level: coarse terrain, rivers, highways, towns, peaks and the regional weather cams out to 30 miles.
// The detailed 5-mile core is drawn by the inner terrain; this layer cuts a hole for it.
import * as THREE from 'three';
import { HALF_EXTENT_M, elevToY, vexAt, llToXZ, groundY } from '../geo.js';
import { RN, RCELL, relev, REGION_HALF_M, REGION_RADIUS_M, rCellIndex } from '../geo-region.js';
import { buildHydrology } from '../sim/hydrology.js';
import { U, GLSL_COMMON, VEX_GLSL } from './common.js';
import { waterMaterial } from './water.js';
import { buildRoads, makeRoadEvaluator } from './roads.js';
import { TOWNS, PEAKS, REGION_ROADS } from '../data/region-places.js';
import { SITES } from '../sim/region.js';
import { RIVER_INFO } from '../sim/engine.js';

const HOLE = HALF_EXTENT_M - 60; // overlap the core slightly so there is never a seam

export function regionHydrology() {
  return buildHydrology({ N: RN, CELL: RCELL, elev: relev, inflows: [] });
}

function regionGeometry(rh, stride) {
  const n = Math.floor((RN - 1) / stride) + 1;
  const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3);
  const hand = new Float32Array(n * n), drainE = new Float32Array(n * n), cls = new Float32Array(n * n);
  for (let jj = 0; jj < n; jj++) for (let ii = 0; ii < n; ii++) {
    const i = ii * stride, j = jj * stride, k = j * RN + i, v = jj * n + ii;
    const x = -REGION_HALF_M + i * RCELL, z = -REGION_HALF_M + j * RCELL;
    const inside = Math.abs(x) < HOLE - RCELL && Math.abs(z) < HOLE - RCELL;
    pos[v * 3] = x; pos[v * 3 + 1] = elevToY(relev[k], x, z) - (inside ? 40 : 2); pos[v * 3 + 2] = z;
    const vx = vexAt(x, z);
    const l = relev[j * RN + Math.max(0, i - stride)], r = relev[j * RN + Math.min(RN - 1, i + stride)];
    const u = relev[Math.max(0, j - stride) * RN + i], d = relev[Math.min(RN - 1, j + stride) * RN + i];
    const nx = -(r - l) * vx / (2 * RCELL * stride), nz = -(d - u) * vx / (2 * RCELL * stride), len = Math.hypot(nx, 1, nz);
    nor[v * 3] = nx / len; nor[v * 3 + 1] = 1 / len; nor[v * 3 + 2] = nz / len;
    // only rivers & larger streams show as water at this scale
    // at ~200 m cells, flat valley floors sit within a meter of the channel: only the channel itself and the
    // big rivers' immediate banks show water normally; wider areas appear only as stages rise
    const show = rh.drainClass[k] >= 1 && rh.hand[k] < 100;
    const onChannel = rh.cls[k] >= 1;
    hand[v] = show ? (onChannel ? rh.hand[k] : Math.max(rh.hand[k], 0.4) + RIVER_INFO[rh.drainClass[k]].base + 0.5) : 999; drainE[v] = show ? rh.drainElev[k] : -999; cls[v] = show ? rh.drainClass[k] : 0;
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6); let o = 0;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aHand', new THREE.BufferAttribute(hand, 1));
  g.setAttribute('aDrainElev', new THREE.BufferAttribute(drainE, 1));
  g.setAttribute('aClass', new THREE.BufferAttribute(cls, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

function regionMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uHole: { value: HOLE }, uRegionRadius: { value: REGION_RADIUS_M } },
    vertexShader: /* glsl */`
      ${VEX_GLSL}
      varying vec3 vPos; varying vec3 vNormal; varying float vElev;
      void main(){ vPos = (modelMatrix * vec4(position, 1.)).xyz; vNormal = normal; vElev = elevFromY(position.y, position.xz);
        gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.); }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      uniform float uHole, uRegionRadius;
      varying vec3 vPos; varying vec3 vNormal; varying float vElev;
      void main(){
        if (max(abs(vPos.x), abs(vPos.z)) < uHole) discard;
        vec3 n = normalize(vNormal);
        float slope = 1. - n.y;
        float fine = vnoise(vPos.xz * .004) * .6 + vnoise(vPos.xz * .02) * .4;
        float L = leafAt(vElev), F = fallAt(vElev), S = springAt(vElev);
        vec3 summer = mix(vec3(.13,.24,.10), vec3(.20,.31,.13), fine);
        vec3 canopy = mix(mix(summer, vec3(.35,.5,.2), S), mix(vec3(.6,.33,.1), vec3(.68,.52,.15), fine), F);
        canopy = mix(mix(vec3(.33,.29,.25), vec3(.42,.37,.31), fine), canopy, L);
        // spruce-fir forest on the highest peaks stays dark green all year
        canopy = mix(canopy, vec3(.08,.16,.10), smoothstep(1650., 1800., vElev));
        // valley farmland & towns on gentle low ground
        float open = smoothstep(.12, .03, slope) * smoothstep(900., 650., vElev) * smoothstep(.35, .65, vnoise(vPos.xz * .0007 + 3.));
        vec3 field = mix(vec3(.36,.45,.22), vec3(.5,.48,.33), fine);
        field = mix(field, vec3(.48,.44,.32), (1. - L) * .7);
        vec3 col = mix(canopy, field, open);
        col = mix(col, vec3(.4,.38,.35), smoothstep(.5, .75, slope) * .5);
        float snow = snowAt(vElev);
        float cover = mix(smoothstep(2., 25., snow) * .85, smoothstep(.2, 3., snow), open);
        col = mix(col, vec3(.92,.94,.98), cover * (1. - smoothstep(.6, .9, slope) * .5));
        float ice = smoothstep(.5, 8., iceAt(vElev));
        col = mix(col, vec3(.72,.78,.84), ice * .35);
        col *= 1. - uWet * .25;
        vec3 viewDir = normalize(cameraPosition - vPos);
        vec3 lit = lighting(n, col, 20., .03 + ice * .4, viewDir);
        // town lights at night (dark during outages)
        vec2 lc = vPos.xz / 160.;
        float lights = open * step(.6, hash12(floor(lc))) * smoothstep(.2, .05, length(fract(lc) - .5)) * step(uPowerOut, hash12(floor(vPos.xz / 3000.) + 3.));
        lit += vec3(1., .78, .45) * lights * uNight * .8;
        // the 30-mile ring, and gentle dimming beyond it
        float r = length(vPos.xz), camD = length(cameraPosition - vPos), w = max(60., camD * .003);
        float ring = (1. - smoothstep(w * .5, w, abs(r - uRegionRadius))) * uShowRing;
        lit = mix(lit, vec3(.45,.75,1.), ring * .8);
        lit *= mix(1., .7, smoothstep(uRegionRadius, uRegionRadius + 300., r));
        gl_FragColor = vec4(applyFog(lit, vPos, vElev), 1.);
      }`,
  });
}

export function createRegion(labels, mobile) {
  const rh = regionHydrology();
  const geo = regionGeometry(rh, mobile ? 2 : 1);
  const group = new THREE.Group();
  const terrain = new THREE.Mesh(geo, regionMaterial());
  terrain.renderOrder = -1;
  const water = new THREE.Mesh(geo, waterMaterial(HOLE));
  water.renderOrder = 3;
  group.add(terrain, water);

  // labels: towns, peaks, rivers
  const at = (lat, lon, lift) => { const p = llToXZ(lat, lon); return new THREE.Vector3(p.x, groundY(p.x, p.z) + lift, p.z); };
  for (const t of TOWNS) labels.add(t.name, at(t.lat, t.lon, 120), { cls: 'town', group: 'region', maxDist: 160000, minDist: 6000 });
  for (const p of PEAKS) labels.add(`▲ ${p.name}`, at(p.lat, p.lon, 150), { cls: 'peak', group: 'region', maxDist: 160000, minDist: 6000 });

  // regional weather cams on the map: a pole with a status beacon + a live label
  const cams = SITES.map((s) => {
    const p = llToXZ(s.lat, s.lon), y = groundY(p.x, p.z);
    const mat = new THREE.MeshBasicMaterial({ color: 0x3ecf73 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 900, 6).translate(0, 450, 0), new THREE.MeshBasicMaterial({ color: 0x1b2430 }));
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(260, 16, 12), mat);
    pole.position.set(p.x, y, p.z); beacon.position.set(p.x, y + 1000, p.z);
    group.add(pole, beacon);
    const label = labels.add(`📷 ${s.name}`, new THREE.Vector3(p.x, y + 1400, p.z), { cls: 'cam', group: 'region', maxDist: 170000, minDist: 3000, priority: 1 });
    return { site: s, mat, label };
  });

  // highways (approximate until a regional OpenStreetMap snapshot is baked)
  let roads = null, evaluate = null;
  const setRoads = (ways) => {
    if (roads) { group.remove(roads.mesh); roads.mesh.geometry.dispose(); }
    roads = buildRoads(ways, rh, null, {
      cellIndex: rCellIndex, widthScale: 3,
      clip: (x, z) => Math.abs(x) < HOLE && Math.abs(z) < HOLE,
      inRadius: (x, z) => Math.hypot(x, z) <= REGION_RADIUS_M,
    });
    roads.mesh.renderOrder = 2;
    group.add(roads.mesh);
    evaluate = makeRoadEvaluator(roads, rh, [], { noSlides: true });
  };
  setRoads(REGION_ROADS);

  const LEVEL_COLOR = [0x3ecf73, 0xf5d142, 0xff3d6e];
  let summary = null;
  return {
    group, hydro: rh, setRoads,
    get summary() { return summary; },
    /** Re-evaluate regional road hazards and refresh the cam beacons (call a few times a second). */
    update(sim, show) {
      group.visible = show;
      if (!show) return;
      if (evaluate) summary = evaluate(sim);
      if (sim.region) sim.region.forEach((s, i) => {
        const c = cams[i];
        c.mat.color.setHex(LEVEL_COLOR[s.level]);
        const text = `📷 ${s.name} · ${Math.round(s.T * 9 / 5 + 32)}°F · ${s.label}`;
        if (c.label.div.textContent !== text) { c.label.div.textContent = text; c.label.w = undefined; }
        c.label.div.dataset.level = s.level;
      });
    },
  };
}
