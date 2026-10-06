import * as THREE from 'three';
import { elevationAt, elevToY, slopeDeg, cellIndex } from '../geo.js';
import { U, GLSL_COMMON } from './common.js';

// Carolina Day School campus, built from the digitized campus map (src/data/campus.js).
import { BUILDINGS, SURFACES, POINTS } from '../data/campus.js';
import { pxToXZ, polyXZ, pointInPoly } from '../campus-geo.js';
import { mulberry32 } from '../geo.js';
/** Simple lit material for man-made objects that still reacts to snow, ice, fog and power. */
export function structureMaterial(color, opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uColor: { value: new THREE.Color().setHex(color, THREE.LinearSRGBColorSpace) }, uRoof: { value: opts.roof ? 1 : 0 },
      uPowered: { value: 1 }, uStatusColor: { value: new THREE.Color(0, 0, 0) } },
    vertexShader: /* glsl */`
      varying vec3 vPos; varying vec3 vNormal; varying float vElev;
      uniform float uBaseElev, uVex;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.); vPos = wp.xyz; vNormal = normalize(mat3(modelMatrix) * normal);
        vElev = wp.y / uVex + uBaseElev; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      uniform vec3 uColor, uStatusColor; uniform float uRoof, uPowered;
      varying vec3 vPos; varying vec3 vNormal; varying float vElev;
      void main(){
        vec3 n = normalize(vNormal);
        vec3 col = uColor;
        if (n.y > .5) col = uRoof > .5 ? vec3(.30,.31,.33) : col * .8;
        // windows on walls: lit at night only when the building has power
        float win = 0.;
        if (n.y < .5) {
          vec2 g = vec2(fract((vPos.x + vPos.z) / 5.), fract(vPos.y / 5.4));
          win = step(.25, g.x) * step(g.x, .75) * step(.35, g.y) * step(g.y, .8);
          col = mix(col, vec3(.16,.2,.26), win * .85);
        }
        float snow = smoothstep(.3, 4., snowAt(vElev)) * smoothstep(.4, .8, n.y);
        col = mix(col, vec3(.94,.96,.99), snow);
        float ice = smoothstep(.5, 8., iceAt(vElev));
        vec3 viewDir = normalize(cameraPosition - vPos);
        vec3 lit = lighting(n, col, 40., .05 + ice * .6 + uWet * .1, viewDir);
        lit += vec3(1.,.82,.5) * win * uPowered * max(uNight, .0) * .9;
        // operations view: tint by power status
        lit = mix(lit, uStatusColor, uRoadStatus * .55 * step(.01, uStatusColor.r + uStatusColor.g + uStatusColor.b));
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


const SURFACE_STYLE = {
  lawn: '#5f8f3e', woods: 'rgba(0,0,0,0)', plaza: '#cfc3a6', playground: '#d9c79c', infield: '#b98a5e', diamond: '#4f8a3c',
  parking: '#5c5f63', outdoor: '#a89a74',
};

/** Paints lawns, lots, fields and plazas into a texture the terrain shader drapes over the ground. */
function paintGround() {
  const pts = [];
  for (const s of SURFACES) if (s.poly) pts.push(...polyXZ(s.poly));
  for (const b of BUILDINGS) for (const p of b.parts || [b.poly]) pts.push(...polyXZ(p));
  const minX = Math.min(...pts.map((p) => p.x)) - 40, maxX = Math.max(...pts.map((p) => p.x)) + 40;
  const minZ = Math.min(...pts.map((p) => p.z)) - 40, maxZ = Math.max(...pts.map((p) => p.z)) + 40;
  const size = Math.max(maxX - minX, maxZ - minZ);
  const R = 1024, k = R / size;
  const cv = document.createElement('canvas'); cv.width = cv.height = R;
  const g = cv.getContext('2d');
  const tx = (p) => [(p.x - minX) * k, (p.z - minZ) * k];
  const path = (poly) => { g.beginPath(); polyXZ(poly).forEach((p, i) => (i ? g.lineTo : g.moveTo).call(g, ...tx(p))); g.closePath(); };
  for (const s of SURFACES) {
    g.fillStyle = SURFACE_STYLE[s.kind];
    if (s.circle) {
      const c = pxToXZ([s.circle[0], s.circle[1]]), r = s.circle[2] * Math.hypot(pxToXZ([1, 0]).x - pxToXZ([0, 0]).x, pxToXZ([1, 0]).z - pxToXZ([0, 0]).z);
      g.beginPath(); g.arc(...tx(c), r * k, 0, Math.PI * 2); g.fill();
      continue;
    }
    path(s.poly); g.fill();
    if (s.kind === 'parking') {
      // stall stripes
      const P = polyXZ(s.poly), x0 = Math.min(...P.map((p) => p.x)), x1 = Math.max(...P.map((p) => p.x));
      const z0 = Math.min(...P.map((p) => p.z)), z1 = Math.max(...P.map((p) => p.z));
      g.save(); path(s.poly); g.clip();
      g.strokeStyle = 'rgba(235,235,225,.75)'; g.lineWidth = Math.max(1, 0.15 * k);
      if (s.rows === 'v') {
        for (let x = x0 + 9; x < x1 - 4; x += 18) for (let z = z0 + 4; z < z1 - 4; z += 2.7) { g.beginPath(); g.moveTo(...tx({ x: x - 5, z })); g.lineTo(...tx({ x: x + 5, z })); g.stroke(); }
      } else {
        for (let z = z0 + 9; z < z1 - 4; z += 18) for (let x = x0 + 4; x < x1 - 4; x += 2.7) { g.beginPath(); g.moveTo(...tx({ x, z: z - 5 })); g.lineTo(...tx({ x, z: z + 5 })); g.stroke(); }
      }
      g.restore();
    }
  }
  // building pads (slightly wider than the walls)
  g.fillStyle = '#b9b2a2';
  for (const b of BUILDINGS) for (const p of b.parts || [b.poly]) { path(p); g.fill(); }
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  return { tex, rect: new THREE.Vector4(minX, minZ, size, 1) };
}

function extrude(poly, base, height, mat) {
  const P = polyXZ(poly);
  const shape = new THREE.Shape(P.map((p) => new THREE.Vector2(p.x, -p.z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false }).rotateX(-Math.PI / 2);
  g.translate(0, base, 0);
  return new THREE.Mesh(g, mat);
}

export function createCampus(labels) {
  const group = new THREE.Group();
  const ground = paintGround();
  const buildings = {};
  for (const b of BUILDINGS) {
    const parts = b.parts || [b.poly];
    let lo = Infinity, hi = -Infinity;
    for (const p of parts) for (const q of polyXZ(p)) { const y = elevToY(elevationAt(q.x, q.z)); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    const H = (b.height || b.floors * 4.2) * 1.15 + (hi - lo) + 1;
    const wall = structureMaterial(b.id === 9 ? 0xb8b3a8 : 0xb79a7c, { roof: b.roof !== 'flat' });
    const meshes = parts.map((p) => extrude(p, lo - 1, H, wall));
    meshes.forEach((m) => group.add(m));
    const c = polyXZ(parts[0]);
    const cx = c.reduce((s, p) => s + p.x, 0) / c.length, cz = c.reduce((s, p) => s + p.z, 0) / c.length;
    buildings[b.id] = { mat: wall, x: cx, z: cz, top: lo + H };
    labels?.add(`${b.id} · ${b.name}`, new THREE.Vector3(cx, lo + H + 6, cz), { cls: 'bldg', group: 'campus', maxDist: 1600 });
  }
  for (const p of POINTS) {
    const q = pxToXZ(p.px);
    labels?.add(p.name, new THREE.Vector3(q.x, elevToY(elevationAt(q.x, q.z)) + 8, q.z), { cls: 'campus-pt', group: 'campus', maxDist: 1100 });
  }
  // trees stay off lawns, lots and buildings; the Woodlands get a dense stand
  const blockers = SURFACES.filter((s) => s.kind !== 'woods' && s.poly).map((s) => polyXZ(s.poly));
  const pads = BUILDINGS.flatMap((b) => (b.parts || [b.poly]).map(polyXZ));
  const mpp = Math.hypot(pxToXZ([1, 0]).x - pxToXZ([0, 0]).x, pxToXZ([1, 0]).z - pxToXZ([0, 0]).z);
  const circles = SURFACES.filter((s) => s.circle).map((s) => ({ c: pxToXZ([s.circle[0], s.circle[1]]), r: s.circle[2] * mpp + 10 }));
  const avoid = (x, z) => blockers.some((P) => pointInPoly(x, z, P)) || pads.some((P) => pointInPoly(x, z, P)
    || P.some((p) => Math.hypot(p.x - x, p.z - z) < 10)) || circles.some((o) => Math.hypot(o.c.x - x, o.c.z - z) < o.r);
  const woods = SURFACES.filter((s) => s.kind === 'woods').map((s) => polyXZ(s.poly));
  const extraTrees = [];
  const rnd = mulberry32(3);
  for (const W of woods) {
    const xs = W.map((p) => p.x), zs = W.map((p) => p.z);
    for (let i = 0; i < 700; i++) {
      const x = Math.min(...xs) + rnd() * (Math.max(...xs) - Math.min(...xs)), z = Math.min(...zs) + rnd() * (Math.max(...zs) - Math.min(...zs));
      if (pointInPoly(x, z, W) && !avoid(x, z)) extraTrees.push({ x, z });
    }
  }
  return { group, ground, buildings, avoid, extraTrees };
}
