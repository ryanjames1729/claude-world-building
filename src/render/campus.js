import * as THREE from 'three';
import { elevationAt, elevToY, slopeDeg, cellIndex } from '../geo.js';
import { U, GLSL_COMMON } from './common.js';

// A schematic Carolina Day School campus. The real building footprints are loaded from
// OpenStreetMap when available (see osm.js); this layout is the offline fallback.
const BUILDINGS = [
  { name: 'Upper School', x: -40, z: -60, w: 70, d: 28, h: 12, rot: 0.15 },
  { name: 'Middle School', x: 60, z: -10, w: 55, d: 26, h: 10, rot: 0.15 },
  { name: 'Lower School', x: -90, z: 40, w: 60, d: 30, h: 9, rot: -0.2 },
  { name: 'Library & Commons', x: 10, z: 40, w: 36, d: 30, h: 11, rot: 0.1 },
  { name: 'Gymnasium', x: 120, z: 70, w: 48, d: 36, h: 14, rot: 0.15 },
  { name: 'Arts Center', x: -10, z: 110, w: 40, d: 22, h: 10, rot: 0.05 },
];

function findFlat(cx, cz, w, d, radius, avoid) {
  let best = null, bs = Infinity;
  for (let a = 0; a < 48; a++) for (let r = 60; r <= radius; r += 25) {
    const x = cx + Math.cos(a / 48 * Math.PI * 2) * r, z = cz + Math.sin(a / 48 * Math.PI * 2) * r;
    if (avoid.some((b) => Math.abs(b.x - x) < (b.w + w) / 2 + 15 && Math.abs(b.z - z) < (b.d + d) / 2 + 15)) continue;
    let s = 0;
    for (const [ox, oz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0]]) s += slopeDeg(cellIndex(x + ox, z + oz));
    s += r * 0.004;
    if (s < bs) { bs = s; best = { x, z }; }
  }
  return best;
}

/** Simple lit material for man-made objects that still reacts to snow, ice and fog. */
export function structureMaterial(color, opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uColor: { value: new THREE.Color().setHex(color, THREE.LinearSRGBColorSpace) }, uRoof: { value: opts.roof ? 1 : 0 } },
    vertexShader: /* glsl */`
      varying vec3 vPos; varying vec3 vNormal; varying float vElev;
      uniform float uBaseElev, uVex;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.); vPos = wp.xyz; vNormal = normalize(mat3(modelMatrix) * normal);
        vElev = wp.y / uVex + uBaseElev; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      uniform vec3 uColor; uniform float uRoof;
      varying vec3 vPos; varying vec3 vNormal; varying float vElev;
      void main(){
        vec3 n = normalize(vNormal);
        vec3 col = uColor;
        // windows on walls
        if (n.y < .5) {
          vec2 g = vec2(fract((vPos.x + vPos.z) / 6.), fract(vPos.y / 4.));
          float win = step(.25, g.x) * step(g.x, .75) * step(.35, g.y) * step(g.y, .8);
          vec3 wcol = mix(vec3(.18,.22,.28), vec3(1.,.85,.55) * step(uPowerOut, .5), uNight);
          col = mix(col, wcol, win * .85);
        }
        float snow = smoothstep(.3, 4., snowAt(vElev)) * smoothstep(.4, .8, n.y);
        col = mix(col, vec3(.94,.96,.99), snow);
        float ice = smoothstep(.5, 8., iceAt(vElev));
        vec3 viewDir = normalize(cameraPosition - vPos);
        vec3 lit = lighting(n, col, 40., .05 + ice * .6 + uWet * .1, viewDir);
        gl_FragColor = vec4(applyFog(lit, vPos, vElev), 1.);
      }`,
  });
}

/** A rectangle draped over the terrain (sports fields, parking). */
export function drapedRect(x, z, w, d, rot, color, lines = false) {
  const seg = 12;
  const g = new THREE.PlaneGeometry(w, d, seg, seg).rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < p.count; i++) {
    const lx = p.getX(i), lz = p.getZ(i);
    const wx = x + lx * c - lz * s, wz = z + lx * s + lz * c;
    p.setXYZ(i, wx, elevToY(elevationAt(wx, wz)) + 1.2, wz);
  }
  g.computeVertexNormals();
  const mat = structureMaterial(color);
  if (lines) {
    mat.fragmentShader = mat.fragmentShader.replace('vec3 col = uColor;',
      `vec3 col = uColor; vec2 q = vPos.xz; float stripe = step(.5, fract((q.x * ${c.toFixed(4)} + q.y * ${s.toFixed(4)}) / 12.));
       col *= .9 + stripe * .12;`);
  }
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 1;
  return m;
}

export function createCampus() {
  const group = new THREE.Group();
  const placed = [];
  const fallback = new THREE.Group();
  for (const b of BUILDINGS) {
    // foundation goes down to the lowest corner so buildings never float on slopes
    let lo = Infinity, hi = -Infinity;
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const e = elevToY(elevationAt(b.x + ox * b.w / 2, b.z + oz * b.d / 2)); lo = Math.min(lo, e); hi = Math.max(hi, e);
    }
    const H = b.h * 1.3 + (hi - lo);
    const box = new THREE.Mesh(new THREE.BoxGeometry(b.w, H, b.d), structureMaterial(0xb7a48c));
    box.position.set(b.x, lo + H / 2 - 1, b.z);
    box.rotation.y = b.rot;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(b.w, b.d) / 2 * 0.95, 7, 4, 1).rotateY(Math.PI / 4).scale(b.w / Math.hypot(b.w, b.d) * 1.42, 1, b.d / Math.hypot(b.w, b.d) * 1.42), structureMaterial(0x4a4f57, { roof: true }));
    roof.position.set(b.x, lo + H - 1 + 3.5, b.z);
    roof.rotation.y = b.rot;
    fallback.add(box, roof);
    placed.push(b);
  }
  // athletic fields and parking on the flattest nearby ground
  const fields = [
    { w: 110, d: 70, color: 0x3f7a35, lines: true, name: 'Athletic field' },
    { w: 100, d: 65, color: 0x46803a, lines: true, name: 'Practice field' },
    { w: 80, d: 45, color: 0x55575a, name: 'Parking' },
  ];
  for (const f of fields) {
    const spot = findFlat(0, 0, f.w, f.d, 420, placed);
    if (!spot) continue;
    const m = drapedRect(spot.x, spot.z, f.w, f.d, 0.15, f.color, f.lines);
    group.add(m);
    placed.push({ x: spot.x, z: spot.z, w: f.w, d: f.d });
  }
  group.add(fallback);
  const avoid = (x, z) => placed.some((b) => Math.abs(b.x - x) < b.w / 2 + 12 && Math.abs(b.z - z) < b.d / 2 + 12);
  return { group, fallback, avoid };
}
