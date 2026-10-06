import * as THREE from 'three';
import { N, CELL, HALF_EXTENT_M, elevationAt, elevToY, mulberry32, slopeDeg, cellIndex } from '../geo.js';
import { U, GLSL_COMMON } from './common.js';

// Instanced forest near campus. Each tree knows when (if ever) it fell, and in which direction.
const COUNT_NEAR = 26000, COUNT_FAR = 14000;

function treeMaterial(kind) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U },
    vertexShader: /* glsl */`
      attribute float aFallT; attribute float aFallDir; attribute float aSeed; attribute float aElev;
      attribute float aPart;
      uniform float uTime, uWindStrength; uniform vec2 uWind;
      varying vec3 vPos; varying vec3 vNormal; varying float vSeed; varying float vElev; varying float vPart; varying float vH;
      mat3 rotAxis(vec3 a, float ang){ float s = sin(ang), c = cos(ang), oc = 1. - c;
        return mat3(oc*a.x*a.x + c, oc*a.x*a.y + a.z*s, oc*a.z*a.x - a.y*s,
                    oc*a.x*a.y - a.z*s, oc*a.y*a.y + c, oc*a.y*a.z + a.x*s,
                    oc*a.z*a.x + a.y*s, oc*a.y*a.z - a.x*s, oc*a.z*a.z + c); }
      void main(){
        vec3 p = position; vec3 n = normal;
        vH = position.y;
        // wind sway grows with height
        float sway = uWindStrength * position.y * .05 * (sin(uTime * (1.3 + aSeed) + aSeed * 40.) * .6 + .7);
        p.xz += uWind * sway;
        // falling: rotate about the base
        float fallen = aFallT < 0. ? 0. : clamp((uTime - aFallT) / 1.8, 0., 1.);
        fallen = fallen * fallen;
        vec3 axis = normalize(vec3(cos(aFallDir), 0., sin(aFallDir)));
        mat3 R = rotAxis(axis, fallen * 1.48);
        p = R * p; n = R * n;
        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.);
        vPos = wp.xyz;
        vNormal = normalize(mat3(modelMatrix * instanceMatrix) * n);
        vSeed = aSeed; vElev = aElev; vPart = aPart;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      varying vec3 vPos; varying vec3 vNormal; varying float vSeed; varying float vElev; varying float vPart; varying float vH;
      void main(){
        vec3 n = normalize(vNormal);
        vec3 col;
        if (vPart < .5) col = vec3(.25,.18,.12);
        else {
          ${kind === 'conifer'
            ? 'col = mix(vec3(.07,.17,.09), vec3(.12,.24,.12), vSeed);'
            : `vec3 summer = mix(vec3(.15,.30,.11), vec3(.25,.38,.14), vSeed);
               vec3 spring = mix(vec3(.38,.55,.2), vec3(.48,.6,.25), vSeed);
               vec3 fallc = vSeed < .33 ? vec3(.75,.22,.07) : vSeed < .66 ? vec3(.85,.5,.08) : vec3(.8,.68,.15);
               col = mix(mix(summer, spring, springAt(vElev)), fallc, fallAt(vElev));
               col = mix(vec3(.30,.26,.22), col, smoothstep(.0, .6, leafAt(vElev)));
               if (leafAt(vElev) < .5 && hash12(vec2(vSeed * 91., floor(vPos.y))) > leafAt(vElev) * 2.) discard;`}
        }
        // snow on upward faces, ice glaze everywhere
        float snow = smoothstep(.5, 6., snowAt(vElev)) * smoothstep(.1, .7, n.y);
        col = mix(col, vec3(.93,.95,.98), snow * .85);
        float ice = smoothstep(.5, 8., iceAt(vElev));
        col = mix(col, vec3(.75,.82,.9), ice * .45);
        vec3 viewDir = normalize(cameraPosition - vPos);
        vec3 lit = lighting(n, col, 30., .05 + ice * .9, viewDir);
        gl_FragColor = vec4(applyFog(lit, vPos, vElev), 1.);
      }`,
  });
}

function buildGeometry(kind) {
  const trunk = new THREE.CylinderGeometry(0.35, 0.5, 6, 5, 1).translate(0, 3, 0);
  const crown = kind === 'conifer'
    ? new THREE.ConeGeometry(3.6, 15, 7, 1).translate(0, 12, 0)
    : new THREE.IcosahedronGeometry(5.2, 1).scale(1, 1.15, 1).translate(0, 11, 0);
  const parts = [trunk, crown].map((g, i) => {
    if (g.index) g = g.toNonIndexed();
    g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(i), 1));
    g.deleteAttribute('uv');
    return g;
  });
  const merged = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'aPart']) {
    const arrs = parts.map((p) => p.attributes[name].array);
    const total = arrs.reduce((a, b) => a + b.length, 0);
    const out = new Float32Array(total);
    let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
    merged.setAttribute(name, new THREE.BufferAttribute(out, parts[0].attributes[name].itemSize));
  }
  return merged;
}

export function createForest(landcover, campusAvoid) {
  const rnd = mulberry32(2024);
  const recs = [];
  const tryPlace = (x, z) => {
    if (Math.abs(x) > HALF_EXTENT_M - 50 || Math.abs(z) > HALF_EXTENT_M - 50) return;
    const k = cellIndex(x, z);
    const dev = landcover.cover[k];
    if (rnd() < dev * 1.25) return;           // fewer trees on developed/open land
    if (landcover.data[k * 4 + 1] > 150) return; // not in big rivers
    if (campusAvoid(x, z)) return;
    const s = slopeDeg(k);
    const e = elevationAt(x, z);
    const conifer = rnd() < 0.18 + Math.min(0.3, s / 120) + (e > 900 ? 0.15 : 0);
    recs.push({ x, z, e, conifer, scale: 0.75 + rnd() * 0.6, cell: k });
  };
  // dense near campus, sparser across the rest of the map
  let guard = 0;
  while (recs.length < COUNT_NEAR && guard++ < COUNT_NEAR * 6) {
    const r = Math.sqrt(rnd()) * 3200, a = rnd() * Math.PI * 2;
    tryPlace(Math.cos(a) * r, Math.sin(a) * r);
  }
  guard = 0;
  while (recs.length < COUNT_NEAR + COUNT_FAR && guard++ < COUNT_FAR * 6) {
    tryPlace((rnd() * 2 - 1) * HALF_EXTENT_M, (rnd() * 2 - 1) * HALF_EXTENT_M);
  }
  const group = new THREE.Group();
  const meshes = {};
  const byCell = new Map();
  for (const kind of ['deciduous', 'conifer']) {
    const list = recs.filter((r) => (kind === 'conifer') === r.conifer);
    const geo = buildGeometry(kind);
    const n = list.length;
    const mesh = new THREE.InstancedMesh(geo, treeMaterial(kind), n);
    const fallT = new Float32Array(n).fill(-1), fallDir = new Float32Array(n), seed = new Float32Array(n), el = new Float32Array(n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    list.forEach((r, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
      const s = r.scale * 1.25;
      sc.set(s, s, s);
      m.compose(new THREE.Vector3(r.x, elevToY(r.e) - 0.5, r.z), q, sc);
      mesh.setMatrixAt(i, m);
      seed[i] = rnd(); el[i] = r.e; fallDir[i] = rnd() * Math.PI * 2;
      r.mesh = kind; r.i = i;
      if (!byCell.has(r.cell)) byCell.set(r.cell, []);
      byCell.get(r.cell).push(r);
    });
    geo.setAttribute('aFallT', new THREE.InstancedBufferAttribute(fallT, 1));
    geo.setAttribute('aFallDir', new THREE.InstancedBufferAttribute(fallDir, 1));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    geo.setAttribute('aElev', new THREE.InstancedBufferAttribute(el, 1));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    meshes[kind] = mesh;
  }
  const order = recs.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  let fallenCount = 0;
  const fell = (r, t, dir) => {
    if (r.down) return false;
    r.down = true;
    const geo = meshes[r.mesh].geometry;
    geo.attributes.aFallT.array[r.i] = t;
    if (dir != null) geo.attributes.aFallDir.array[r.i] = dir;
    geo.attributes.aFallT.needsUpdate = true;
    geo.attributes.aFallDir.needsUpdate = true;
    return true;
  };
  return {
    group,
    total: recs.length,
    get fallen() { return fallenCount; },
    /** Make trees fall until the fraction down matches the simulation. */
    sync(frac, now, windDir) {
      const target = Math.floor(frac * recs.length);
      let p = 0;
      while (fallenCount < target && p < order.length) {
        const r = recs[order[p++]];
        if (fell(r, now + Math.random() * 2, (windDir + 180) * Math.PI / 180 - Math.PI / 2 + (Math.random() - 0.5) * 0.8)) fallenCount++;
      }
    },
    /** Trees in a landslide's path go down with it. */
    slide(path, now) {
      for (const k of path) {
        for (const dk of [0, 1, -1, N, -N]) {
          const list = byCell.get(k + dk);
          if (list) for (const r of list) if (fell(r, now + Math.random(), Math.random() * 6.28)) fallenCount++;
        }
      }
    },
    reset() {
      for (const r of recs) r.down = false;
      fallenCount = 0;
      for (const m of Object.values(meshes)) { m.geometry.attributes.aFallT.array.fill(-1); m.geometry.attributes.aFallT.needsUpdate = true; }
    },
  };
}
