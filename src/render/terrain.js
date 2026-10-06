import * as THREE from 'three';
import { N, CELL, HALF_EXTENT_M, elev, elevToY, slopeDeg, mulberry32, VEX } from '../geo.js';
import { U, GLSL_COMMON } from './common.js';

/** Builds the terrain geometry. Water reuses the same geometry with a different material. */
export function buildTerrainGeometry(hydro) {
  const count = N * N;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const hand = new Float32Array(count), drainE = new Float32Array(count), cls = new Float32Array(count);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      pos[k * 3] = -HALF_EXTENT_M + i * CELL;
      pos[k * 3 + 1] = elevToY(elev[k]);
      pos[k * 3 + 2] = -HALF_EXTENT_M + j * CELL;
      const l = elev[j * N + Math.max(0, i - 1)], r = elev[j * N + Math.min(N - 1, i + 1)];
      const u = elev[Math.max(0, j - 1) * N + i], d = elev[Math.min(N - 1, j + 1) * N + i];
      const nx = -(r - l) * VEX / (2 * CELL), nz = -(d - u) * VEX / (2 * CELL);
      const len = Math.hypot(nx, 1, nz);
      nor[k * 3] = nx / len; nor[k * 3 + 1] = 1 / len; nor[k * 3 + 2] = nz / len;
      uv[k * 2] = i / (N - 1); uv[k * 2 + 1] = 1 - j / (N - 1);
      const far = hydro.hand[k] > 100;
      hand[k] = far ? 999 : hydro.hand[k];
      drainE[k] = far ? -999 : hydro.drainElev[k];
      cls[k] = far ? 0 : hydro.drainClass[k];
    }
  }
  const idx = new Uint32Array((N - 1) * (N - 1) * 6);
  let o = 0;
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aHand', new THREE.BufferAttribute(hand, 1));
  g.setAttribute('aDrainElev', new THREE.BufferAttribute(drainE, 1));
  g.setAttribute('aClass', new THREE.BufferAttribute(cls, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/** Land cover: R = developed/open land, G = stream channel, B = variation noise, A = landslide scar. */
export function buildLandcover(hydro) {
  const data = new Uint8Array(N * N * 4);
  const rnd = mulberry32(42);
  // coarse value noise for patchiness
  const G = 40, grid = new Float32Array((G + 1) * (G + 1)).map(() => rnd());
  const noise = (i, j) => {
    const x = (i / N) * G, y = (j / N) * G, xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const s = (a, b) => grid[Math.min(G, b) * (G + 1) + Math.min(G, a)];
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (s(xi, yi) * (1 - sx) + s(xi + 1, yi) * sx) * (1 - sy) + (s(xi, yi + 1) * (1 - sx) + s(xi + 1, yi + 1) * sx) * sy;
  };
  const cover = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    const s = slopeDeg(k), e = elev[k];
    const n = noise(i, j) * 0.7 + noise(i * 3.1, j * 3.1) * 0.3;
    // north (downtown) is more built-up; the Biltmore Estate west of the river is mostly forest/pasture
    const northBias = Math.max(0, (N * 0.35 - j) / (N * 0.35)) * 0.25;
    let dev = (1 - s / 13) * (1 - (e - 610) / 260) + (n - 0.5) * 0.7 + northBias;
    dev = Math.max(0, Math.min(1, dev));
    cover[k] = dev;
    data[k * 4] = dev * 255;
    const c = hydro.cls[k];
    data[k * 4 + 1] = c < 0 ? 0 : c === 0 ? 120 : c === 1 ? 200 : 255;
    data[k * 4 + 2] = (noise(i * 7.3, j * 7.3) * 0.6 + rnd() * 0.4) * 255;
    data[k * 4 + 3] = 0;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.flipY = true;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return { tex, data, cover };
}

export function terrainMaterial(landTex) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uLand: { value: landTex } },
    vertexShader: /* glsl */`
      attribute float aHand; attribute float aDrainElev; attribute float aClass;
      varying vec3 vPos; varying vec3 vNormal; varying vec2 vUv; varying float vElev;
      varying float vHand; varying float vClass; varying float vDrainElev;
      uniform float uBaseElev, uVex;
      void main(){
        vPos = (modelMatrix * vec4(position, 1.)).xyz;
        vNormal = normal; vUv = uv; vElev = position.y / uVex + uBaseElev;
        vHand = aHand; vClass = aClass; vDrainElev = aDrainElev;
        gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.);
      }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      uniform sampler2D uLand;
      varying vec3 vPos; varying vec3 vNormal; varying vec2 vUv; varying float vElev;
      varying float vHand; varying float vClass; varying float vDrainElev;
      void main(){
        vec4 land = texture2D(uLand, vUv);
        vec3 n = normalize(vNormal);
        float slope = 1. - n.y;
        float dev = land.r, stream = land.g, vari = land.b;
        float fine = vnoise(vPos.xz * .02) * .6 + vnoise(vPos.xz * .07) * .4;
        // ---- forest canopy color by season (Asheville: spring green-up April, peak color late October)
        vec3 summer = mix(vec3(.13,.24,.10), vec3(.20,.31,.13), fine);
        vec3 spring = mix(vec3(.30,.45,.18), vec3(.40,.52,.22), fine);
        vec3 fallc = mix(mix(vec3(.58,.32,.10), vec3(.66,.52,.16), fine), vec3(.52,.20,.10), smoothstep(.6,.9,vari) * .8);
        fallc = mix(fallc, vec3(.36,.30,.16), .25); // muted browns of oaks between the brighter maples & poplars
        vec3 bare = mix(vec3(.33,.29,.25), vec3(.42,.37,.31), fine);
        float evergreen = smoothstep(.55, .9, vnoise(vPos.xz * .004 + 3.)) * .7 + smoothstep(.2,.5,slope) * .2; // pine, hemlock, rhododendron
        vec3 canopy = mix(summer, spring, springAt(vElev));
        canopy = mix(canopy, fallc, fallAt(vElev));
        canopy = mix(bare, canopy, leafAt(vElev));
        canopy = mix(canopy, vec3(.10,.20,.10), evergreen * (1. - leafAt(vElev) * .7));
        // ---- open / developed land: lawns, pasture, roofs & pavement
        float paved = smoothstep(.45, .8, vnoise(vPos.xz * .015 + 9.)) * dev;
        vec3 grass = mix(vec3(.30,.40,.18), vec3(.45,.47,.25), fine);
        grass = mix(grass, vec3(.48,.44,.32), (1. - leafAt(vElev)) * .8);
        vec3 urban = mix(vec3(.36,.36,.35), vec3(.47,.45,.42), fine);
        vec3 open = mix(grass, urban, paved);
        vec3 col = mix(canopy, open, smoothstep(.35, .75, dev));
        // rock on the steepest slopes
        col = mix(col, vec3(.38,.36,.33), smoothstep(.45, .7, slope) * .6);
        // stream channels
        float wetChan = stream * smoothstep(1.2, 0., vHand);
        col = mix(col, vec3(.16,.2,.17), wetChan * .7);
        // ---- landslide scars (fresh mud & rock)
        col = mix(col, mix(vec3(.40,.30,.19), vec3(.50,.42,.31), fine), land.a);
        // ---- flood mud left behind where water reached but has receded
        float peakDepth = peakFor(vClass) + vDrainElev - vElev;
        float nowDepth = stageFor(vClass) + vDrainElev - vElev;
        float mud = smoothstep(0., .4, peakDepth) * smoothstep(.2, -.3, nowDepth);
        col = mix(col, vec3(.40,.33,.24) * (.85 + fine * .3), mud * .85);
        // ---- wet surfaces darken
        col *= 1. - uWet * .28;
        // ---- snow: thin snow shows through trees first on open ground, deep snow covers all
        float snow = snowAt(vElev);
        float openCover = smoothstep(.2, 3., snow);
        float forestCover = smoothstep(2., 25., snow) * .85;
        float cover = mix(forestCover, openCover, smoothstep(.35, .75, dev));
        cover *= 1. - smoothstep(.55, .85, slope) * .6;
        vec3 snowCol = vec3(.92,.94,.98) * (.92 + fine * .08);
        col = mix(col, snowCol, cover);
        // ---- ice glaze
        float ice = smoothstep(.5, 8., iceAt(vElev));
        col = mix(col, vec3(.72,.78,.84), ice * .35);
        vec3 viewDir = normalize(cameraPosition - vPos);
        vec3 lit = lighting(n, col, 24., .04 + ice * .5 + uWet * .06 + cover * .05, viewDir);
        // ---- city lights at night (go dark with power outages)
        vec2 lc = vPos.xz / 38.;
        float lightsHere = smoothstep(.5, .9, dev) * step(.55, hash12(floor(lc))) * smoothstep(.16, .04, length(fract(lc) - .5));
        lightsHere *= smoothstep(300., 1500., length(cameraPosition - vPos)); // a view-from-afar effect
        float powered = step(uPowerOut, hash12(floor(vPos.xz / 600.) + 7.));
        lit += vec3(1., .78, .45) * lightsHere * powered * uNight * .9;
        // ---- 5-mile radius ring and gentle dimming outside it
        float r = length(vPos.xz);
        float camD = length(cameraPosition - vPos);
        float w = max(12., camD * .0025);
        float ring = (1. - smoothstep(w * .5, w, abs(r - uRadius))) * uShowRing;
        lit = mix(lit, vec3(1., .82, .2), ring * .85);
        lit *= mix(1., .78, smoothstep(uRadius, uRadius + 60., r) * uShowRing);
        gl_FragColor = vec4(applyFog(lit, vPos, vElev), 1.);
      }`,
  });
}

/** Paints a landslide scar into the landcover alpha channel. */
export function paintScar(land, path) {
  for (let p = 0; p < path.length; p++) {
    const k = path[p], i = k % N, j = (k / N) | 0;
    const rad = p < 3 ? 1.6 : 1.1;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const d = Math.hypot(di, dj);
      if (d > rad) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const kk = jj * N + ii;
      land.data[kk * 4 + 3] = Math.max(land.data[kk * 4 + 3], 255 * (1 - d / (rad + 0.6)));
    }
  }
  land.tex.needsUpdate = true;
}
export function clearScars(land) {
  for (let k = 0; k < N * N; k++) land.data[k * 4 + 3] = 0;
  land.tex.needsUpdate = true;
}
