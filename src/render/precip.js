import * as THREE from 'three';
import { U } from './common.js';

// Precipitation particles live in a box that follows the camera and are animated entirely on the GPU.
const RAIN_N = 14000, SNOW_N = 16000;

function particleMaterial(kind) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: U.uTime, uSunColor: U.uSunColor, uSkyAmb: U.uSkyAmb, uFlash: U.uFlash,
      uCenter: { value: new THREE.Vector3() }, uBox: { value: 400 }, uAmount: { value: 0 },
      uWindV: { value: new THREE.Vector2() }, uFallSpeed: { value: 1 }, uStreak: { value: 1 }, uPx: { value: 1 },
    },
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    vertexShader: /* glsl */`
      attribute vec4 aSeed; attribute float aEnd;
      uniform float uTime, uBox, uAmount, uFallSpeed, uStreak, uPx; uniform vec3 uCenter; uniform vec2 uWindV;
      varying float vAlpha;
      void main(){
        float t = uTime * uFallSpeed;
        vec3 p = aSeed.xyz * uBox;
        ${kind === 'snow' ? 'p.x += sin(uTime * (.7 + aSeed.w) + aSeed.w * 30.) * uBox * .012; p.z += cos(uTime * (.6 + aSeed.w) + aSeed.w * 20.) * uBox * .012;' : ''}
        vec3 vel = vec3(uWindV.x, -1., uWindV.y) * uBox;
        p += vel * t * (.8 + aSeed.w * .4);
        p = mod(p - uCenter + uBox * .5, uBox) - uBox * .5 + uCenter;
        ${kind === 'rain' ? 'p -= vel * aEnd * .018 * uStreak;' : ''}
        vAlpha = step(aSeed.w, uAmount);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        ${kind === 'snow' ? 'gl_PointSize = uPx * (2. + aSeed.w * 2.) * uBox / max(1., -mv.z) * .9;' : ''}
      }`,
    fragmentShader: kind === 'snow'
      ? /* glsl */`uniform vec3 uSunColor, uSkyAmb; uniform float uFlash; varying float vAlpha;
        void main(){ if (vAlpha < .5) discard; float d = length(gl_PointCoord - .5); if (d > .5) discard;
          gl_FragColor = vec4(vec3(.95) * (uSkyAmb + uSunColor * .4 + uFlash), (1. - d * 2.) * .9); }`
      : /* glsl */`uniform vec3 uSunColor, uSkyAmb; uniform float uFlash; varying float vAlpha;
        void main(){ if (vAlpha < .5) discard; gl_FragColor = vec4(vec3(.75,.8,.9) * (uSkyAmb + uSunColor * .3 + uFlash), .35); }`,
  });
}

export function createPrecip() {
  const rnd = Math.random;
  // rain: line segments (2 verts per drop)
  const rg = new THREE.BufferGeometry();
  const rPos = new Float32Array(RAIN_N * 6), rSeed = new Float32Array(RAIN_N * 8), rEnd = new Float32Array(RAIN_N * 2);
  for (let i = 0; i < RAIN_N; i++) {
    const s = [rnd(), rnd(), rnd(), rnd()];
    for (let v = 0; v < 2; v++) { rSeed.set(s, (i * 2 + v) * 4); rEnd[i * 2 + v] = v; }
  }
  rg.setAttribute('position', new THREE.BufferAttribute(rPos, 3));
  rg.setAttribute('aSeed', new THREE.BufferAttribute(rSeed, 4));
  rg.setAttribute('aEnd', new THREE.BufferAttribute(rEnd, 1));
  const rain = new THREE.LineSegments(rg, particleMaterial('rain'));
  rain.frustumCulled = false;

  const sg = new THREE.BufferGeometry();
  const sSeed = new Float32Array(SNOW_N * 4);
  for (let i = 0; i < SNOW_N * 4; i++) sSeed[i] = rnd();
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SNOW_N * 3), 3));
  sg.setAttribute('aSeed', new THREE.BufferAttribute(sSeed, 4));
  sg.setAttribute('aEnd', new THREE.BufferAttribute(new Float32Array(SNOW_N), 1));
  const snow = new THREE.Points(sg, particleMaterial('snow'));
  snow.frustumCulled = false;

  const group = new THREE.Group();
  group.add(rain, snow);

  return {
    group,
    update(sim, camera, target, pxRatio) {
      const w = sim.wx;
      const dist = camera.position.distanceTo(target);
      const box = Math.max(80, Math.min(3000, dist * 0.55));
      const center = camera.position.clone().lerp(target, 0.35);
      // which precipitation reaches the ground near the camera? use the campus-level type
      const type = sim.ptype;
      const rate = w.precip;
      const amount = Math.min(1, Math.sqrt(rate / 25));
      const windV = new THREE.Vector2();
      const dir = (w.windDir + 180) * Math.PI / 180;
      const isSnow = type === 'snow' || type === 'sleet';
      const k = isSnow ? 0.35 : 0.12;
      windV.set(Math.sin(dir) * w.windMs * k / 3, -Math.cos(dir) * w.windMs * k / 3);
      for (const [m, on, speed] of [[rain, !isSnow && rate > 0.05, 1.6], [snow, isSnow && rate > 0.03, type === 'sleet' ? 1.2 : 0.28]]) {
        const u = m.material.uniforms;
        m.visible = on;
        u.uCenter.value.copy(center);
        u.uBox.value = box;
        u.uAmount.value = isSnow ? Math.min(1, amount * 1.6) : amount;
        u.uWindV.value.copy(windV);
        u.uFallSpeed.value = speed;
        u.uStreak.value = 1;
        u.uPx.value = pxRatio * (type === 'sleet' ? 0.5 : 1);
      }
    },
  };
}

/** Lightning: brief bolts from the cloud base plus a scene-wide flash. */
export function createLightning(scene) {
  const mat = new THREE.LineBasicMaterial({ color: 0xe8ecff, transparent: true, opacity: 1 });
  const bolts = [];
  return {
    strikes: 0,
    update(sim, dtReal, simRunning, target, groundY) {
      U.uFlash.value *= Math.exp(-dtReal * 9);
      for (let i = bolts.length - 1; i >= 0; i--) {
        bolts[i].life -= dtReal;
        bolts[i].line.material.opacity = Math.max(0, bolts[i].life / 0.25);
        if (bolts[i].life <= 0) { scene.remove(bolts[i].line); bolts[i].line.geometry.dispose(); bolts.splice(i, 1); }
      }
      if (!simRunning || sim.wx.thunder < 0.03) return;
      if (Math.random() < sim.wx.thunder * dtReal * 1.2) {
        this.strikes++;
        U.uFlash.value = 0.6 + Math.random() * 0.6;
        const r = 500 + Math.random() * 5000, a = Math.random() * Math.PI * 2;
        const x = target.x + Math.cos(a) * r, z = target.z + Math.sin(a) * r;
        const gy = groundY(x, z), top = gy + 1500;
        const pts = [];
        let px = x + (Math.random() - 0.5) * 400, pz = z + (Math.random() - 0.5) * 400;
        for (let s = 0; s <= 14; s++) {
          const f = s / 14;
          pts.push(new THREE.Vector3(px, top + (gy - top) * f, pz));
          px += (x - px) * 0.25 + (Math.random() - 0.5) * 120; pz += (z - pz) * 0.25 + (Math.random() - 0.5) * 120;
        }
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat.clone());
        scene.add(line);
        bolts.push({ line, life: 0.25 });
      }
    },
  };
}
