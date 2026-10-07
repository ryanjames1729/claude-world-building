// Animated traffic: cars follow the road network, slow for snow, ice, rain, fog and dark signals,
// stop and turn around at flooded or blocked roads, line up for carpool, and occasionally slide off on ice.
import * as THREE from 'three';
import { llToXZ, groundY } from '../geo.js';
import { U, GLSL_COMMON, VEX_GLSL } from './common.js';
import { trafficProfile, carpool } from '../sim/traffic.js';

const LIMIT = { motorway: 29, trunk: 24, primary: 18, secondary: 16, tertiary: 13, unclassified: 11, residential: 10, service: 4,
  motorway_link: 15, trunk_link: 13, primary_link: 12, secondary_link: 11 };
const WIDTH = { motorway: 26, trunk: 22, primary: 18, secondary: 14, tertiary: 11, residential: 7, unclassified: 8, service: 6 };
const COLORS = [0xf2f2f2, 0x1d1f22, 0x8d9399, 0xb52424, 0x24477a, 0x5d6a74, 0xd8c7a0, 0x2f5d3a, 0x9fa6ad, 0x3b3f45];
const SCALE = 1.35; // slightly enlarged so cars read from the default camera

function carMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...U },
    vertexShader: /* glsl */`
      attribute vec3 aColor; attribute float aFlash;
      varying vec3 vPos; varying vec3 vNormal; varying vec3 vColor; varying float vFlash; varying float vElev;
      ${VEX_GLSL}
      void main(){ vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.); vPos = wp.xyz;
        vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal); vColor = aColor; vFlash = aFlash;
        vElev = elevFromY(wp.y, wp.xz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      varying vec3 vPos; varying vec3 vNormal; varying vec3 vColor; varying float vFlash; varying float vElev;
      void main(){
        vec3 n = normalize(vNormal);
        vec3 col = vColor;
        float snow = smoothstep(.5, 4., snowAt(vElev)) * smoothstep(.6, .9, n.y) * .7;
        col = mix(col, vec3(.95), snow);
        vec3 lit = lighting(n, col, 60., .35, normalize(cameraPosition - vPos));
        lit = mix(lit, vec3(1., .55, .05), vFlash * step(.5, fract(uTime * 1.6)));
        gl_FragColor = vec4(applyFog(lit, vPos, vElev), 1.);
      }`,
  });
}

function carGeometry() {
  const body = new THREE.BoxGeometry(4.4, 1.0, 1.85).translate(0, 0.75, 0);
  const cabin = new THREE.BoxGeometry(2.4, 0.75, 1.65).translate(-0.25, 1.6, 0);
  const g = new THREE.BufferGeometry();
  const parts = [body, cabin].map((x) => x.toNonIndexed());
  for (const name of ['position', 'normal']) {
    const arr = new Float32Array(parts.reduce((s, p) => s + p.attributes[name].array.length, 0));
    let o = 0; for (const p of parts) { arr.set(p.attributes[name].array, o); o += p.attributes[name].array.length; }
    g.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  return g.scale(SCALE, SCALE, SCALE);
}

export function createTraffic(maxCars) {
  const mesh = new THREE.InstancedMesh(carGeometry(), carMaterial(), maxCars);
  const colors = new Float32Array(maxCars * 3), flash = new Float32Array(maxCars);
  const c = new THREE.Color();
  for (let i = 0; i < maxCars; i++) { c.setHex(COLORS[i % COLORS.length], THREE.LinearSRGBColorSpace); colors.set([c.r, c.g, c.b], i * 3); }
  mesh.geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
  mesh.geometry.setAttribute('aFlash', new THREE.InstancedBufferAttribute(flash, 1));
  mesh.frustumCulled = false;
  mesh.count = 0;
  // headlights (front) and taillights (rear) as points
  const lightPos = new Float32Array(maxCars * 2 * 3), lightCol = new Float32Array(maxCars * 2 * 3);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(lightPos, 3));
  lg.setAttribute('color', new THREE.BufferAttribute(lightCol, 3));
  const lights = new THREE.Points(lg, new THREE.PointsMaterial({ size: 7, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  lights.frustumCulled = false;
  const group = new THREE.Group();
  group.add(mesh, lights);

  let paths = [], cumW = [], drivePaths = [], cars = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 1, 1);

  /** (Re)build drivable paths from road ways and the hazard samples of the road mesh. */
  function setRoads(ways, samples) {
    const grid = new Map(), key = (x, z) => `${Math.floor(x / 80)},${Math.floor(z / 80)}`;
    for (const s of samples) { const k = key(s.x, s.z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(s); }
    const nearest = (x, z) => {
      let best = null, bd = 90 * 90;
      const gx = Math.floor(x / 80), gz = Math.floor(z / 80);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const s of grid.get(`${gx + a},${gz + b}`) || []) {
        const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; best = s; }
      }
      return best;
    };
    paths = [];
    for (const w of ways) {
      const raw = w.pts.map(([la, lo]) => llToXZ(la, lo));
      const pts = [];
      for (let i = 0; i < raw.length - 1; i++) {
        const a = raw[i], b = raw[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 12));
        for (let s = 0; s < n; s++) pts.push({ x: a.x + (b.x - a.x) * s / n, z: a.z + (b.z - a.z) * s / n });
      }
      pts.push(raw[raw.length - 1]);
      if (pts.length < 3) continue;
      const width = WIDTH[w.kind] || 7;
      for (const p of pts) { p.y = groundY(p.x, p.z) + 2.6 + width * 0.05; p.s = nearest(p.x, p.z); }
      const len = (pts.length - 1) * 12;
      const dCampus = Math.min(...pts.map((p) => Math.hypot(p.x, p.z)));
      const weight = len * (w.kind === 'service' ? 0 : w.kind.startsWith('motorway') ? 2 : w.kind === 'residential' ? 0.5 : 1) * (dCampus < 1500 ? 8 : dCampus < 3500 ? 4 : dCampus < 7000 ? 1 : 0.15);
      paths.push({ name: w.name, kind: w.kind, pts, width, limit: LIMIT[w.kind] || 10, weight, service: w.kind === 'service' });
    }
    cumW = []; let acc = 0; for (const p of paths) { acc += p.weight; cumW.push(acc); }
    drivePaths = paths.filter((p) => p.service);
    cars = [];
  }

  function pickPath() {
    const r = Math.random() * cumW[cumW.length - 1];
    let lo = 0, hi = cumW.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cumW[mid] < r) lo = mid + 1; else hi = mid; }
    return paths[lo];
  }

  function spawn(path) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const u = Math.random() * (path.pts.length - 1);
    cars.push({ path, u, dir, v: path.limit * 0.6, wait: 0, crashed: 0, spin: 0, slot: cars.length });
  }

  const statusToday = (sim) => {
    const k = new Date(sim.t).toISOString().slice(0, 10);
    const st = sim.decisions.get(k)?.status;
    if (st && st !== 'pending') return st;
    const dow = new Date(sim.t).getUTCDay();
    return dow === 0 || dow === 6 ? 'weekend' : 'open';
  };

  function update(sim, dt, enabled, night) {
    group.visible = enabled;
    if (!enabled || !paths.length) return;
    const tr = sim.traffic || { volume: trafficProfile(sim.t), mult: 1 };
    const target = Math.round(maxCars * 0.85 * Math.max(0.02, tr.volume));
    const pool = Math.round(Math.min(60, maxCars * 0.12) * carpool(sim.t, statusToday(sim)));
    const roadCars = cars.filter((c) => !c.path.service), poolCars = cars.filter((c) => c.path.service);
    if (roadCars.length < target && cars.length < maxCars) for (let i = 0; i < Math.min(roadCars.length < target * 0.5 ? 400 : 6, target - roadCars.length); i++) spawn(pickPath());
    if (poolCars.length < pool && drivePaths.length && cars.length < maxCars) spawn(drivePaths[Math.floor(Math.random() * drivePaths.length)]);
    // too many? let surplus cars leave at the end of their road (handled below)
    const surplus = roadCars.length - target, poolSurplus = poolCars.length - pool;
    const lowVis = sim.roads?.lowVis, wet = sim.ptype === 'rain' && sim.wx.precip > 0.5;
    const lightsOn = night > 0.3 || lowVis || sim.wx.precip > 2 || sim.wx.fog > 0.4;
    let removed = 0, poolRemoved = 0;
    for (let i = cars.length - 1; i >= 0; i--) {
      const car = cars[i], P = car.path, pts = P.pts;
      if (car.crashed > 0) { car.crashed -= dt; if (car.crashed <= 0) cars.splice(i, 1); continue; }
      const iu = Math.max(0, Math.min(pts.length - 1, Math.round(car.u)));
      const ahead = pts[Math.max(0, Math.min(pts.length - 1, iu + car.dir * 3))];
      const code = ahead.s ? ahead.s.code || 0 : 0;
      let k = 1;
      if (code === 1) k = 0.45; else if (code === 2) k = 0.35; else if (code === 5) k = 0.4;
      if (wet) k *= 0.8; if (lowVis) k *= 0.6;
      let targetV = P.limit * k;
      if (code === 3 || code === 4) { targetV = 0; car.wait += dt; if (car.wait > 6) { car.dir *= -1; car.wait = 0; } }
      car.v += (targetV - car.v) * Math.min(1, dt * 1.5);
      // sliding off on ice or snow (rate rises with the simulation's crash-risk multiplier)
      const here = pts[iu].s?.code || 0;
      if ((here === 1 || here === 2) && Math.random() < dt * 0.0015 * tr.mult) { car.crashed = 45; car.spin = (Math.random() - 0.5) * 1.6; continue; }
      car.u += car.dir * car.v * dt * 1.5 / 12;
      const atEnd = car.u <= 0 || car.u >= pts.length - 1;
      if (atEnd) {
        if ((P.service && poolRemoved < poolSurplus) || (!P.service && removed < surplus)) { cars.splice(i, 1); P.service ? poolRemoved++ : removed++; continue; }
        if (P.service) { car.dir *= -1; car.u = Math.max(0, Math.min(pts.length - 1, car.u)); }
        else { cars.splice(i, 1); if (cars.length < maxCars) spawn(pickPath()); }
      }
    }
    // write instances
    const n = Math.min(cars.length, maxCars);
    mesh.count = n;
    for (let i = 0; i < n; i++) {
      const car = cars[i], pts = car.path.pts;
      const u = Math.max(0, Math.min(pts.length - 1.001, car.u)), i0 = Math.floor(u), f = u - i0;
      const a = pts[i0], b = pts[i0 + 1];
      const dx = (b.x - a.x) * car.dir, dz = (b.z - a.z) * car.dir, L = Math.hypot(dx, dz) || 1;
      const lane = car.path.service ? 1.6 : Math.max(1.8, car.path.width * 0.22);
      const nx = -dz / L, nz = dx / L; // right-hand side of travel
      pos.set(a.x + (b.x - a.x) * f - nx * lane, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f - nz * lane);
      const yaw = Math.atan2(-dz, dx) + (car.crashed > 0 ? car.spin : 0);
      q.setFromAxisAngle(up, yaw);
      m4.compose(pos, q, scl);
      mesh.setMatrixAt(i, m4);
      flash[i] = car.crashed > 0 ? 1 : 0;
      const fx = Math.cos(yaw), fz = -Math.sin(yaw);
      lightPos.set([pos.x + fx * 3.2 * SCALE, pos.y + 1.0 * SCALE, pos.z + fz * 3.2 * SCALE, pos.x - fx * 3.0 * SCALE, pos.y + 1.0 * SCALE, pos.z - fz * 3.0 * SCALE], i * 6);
      const on = lightsOn ? 1 : 0;
      lightCol.set([1 * on, 0.95 * on, 0.8 * on, 0.9 * on, 0.05 * on, 0.03 * on], i * 6);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.attributes.aFlash.needsUpdate = true;
    lg.setDrawRange(0, n * 2);
    lg.attributes.position.needsUpdate = true;
    lg.attributes.color.needsUpdate = true;
  }

  return { group, setRoads, update, get count() { return cars.length; } };
}
