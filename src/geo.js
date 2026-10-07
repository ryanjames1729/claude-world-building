import { CENTER, HALF_EXTENT_M, GRID, RADIUS_M, REF_ELEV_M } from './geo-constants.js';
import { TERRAIN_SIZE, TERRAIN_B64 } from './data/terrain.js';

export { CENTER, HALF_EXTENT_M, GRID, RADIUS_M, REF_ELEV_M };

export const M_PER_DEG_LAT = 110574;
export const M_PER_DEG_LON = 111320 * Math.cos(CENTER.lat * Math.PI / 180);
export const N = TERRAIN_SIZE;                 // vertices per side
export const CELL = (2 * HALF_EXTENT_M) / (N - 1);
export const BASE_ELEV = 580;                   // elevation mapped to y = 0
// Vertical exaggeration: true scale (1×) around campus so its gentle grades look right, blending to 1.5× in the
// surrounding mountains so the ridges and valleys read clearly on the 5-mile map.
export const VEX = 1.5;
export const VEX_NEAR = 1.0, VEX_R0 = 1200, VEX_R1 = 3500;
export function vexAt(x, z) {
  const t = Math.max(0, Math.min(1, (Math.hypot(x, z) - VEX_R0) / (VEX_R1 - VEX_R0)));
  return VEX_NEAR + (VEX - VEX_NEAR) * t * t * (3 - 2 * t);
}

export const llToXZ = (lat, lon) => ({ x: (lon - CENTER.lon) * M_PER_DEG_LON, z: -(lat - CENTER.lat) * M_PER_DEG_LAT });
export const xzToLL = (x, z) => ({ lat: CENTER.lat - z / M_PER_DEG_LAT, lon: CENTER.lon + x / M_PER_DEG_LON });
/** World y for an elevation; pass x, z for the local exaggeration (omitted = mountain scale, e.g. cloud decks). */
export const elevToY = (e, x = 1e9, z = 0) => (e - BASE_ELEV) * vexAt(x, z);

function decode(b64) {
  if (typeof atob === 'function') {
    const s = atob(b64);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return new Uint16Array(bytes.buffer);
  }
  const buf = Buffer.from(b64, 'base64');
  return new Uint16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** Elevation in meters, row-major, row 0 = north (z = -HALF_EXTENT_M). */
export const elev = (() => {
  const raw = decode(TERRAIN_B64);
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw[i] / 10;
  return out;
})();

export const xToI = (x) => (x + HALF_EXTENT_M) / CELL;
export const zToJ = (z) => (z + HALF_EXTENT_M) / CELL;
export const iToX = (i) => -HALF_EXTENT_M + i * CELL;
export const jToZ = (j) => -HALF_EXTENT_M + j * CELL;

export function cellIndex(x, z) {
  const i = Math.max(0, Math.min(N - 1, Math.round(xToI(x))));
  const j = Math.max(0, Math.min(N - 1, Math.round(zToJ(z))));
  return j * N + i;
}

/** Bilinear elevation (m) at world x/z. */
export function elevationAt(x, z) {
  const fi = Math.max(0, Math.min(N - 1.001, xToI(x)));
  const fj = Math.max(0, Math.min(N - 1.001, zToJ(z)));
  const i = Math.floor(fi), j = Math.floor(fj), a = fi - i, b = fj - j;
  const k = j * N + i;
  return (elev[k] * (1 - a) + elev[k + 1] * a) * (1 - b) + (elev[k + N] * (1 - a) + elev[k + N + 1] * a) * b;
}
export const groundY = (x, z) => elevToY(elevationAt(x, z), x, z);

/** Slope in degrees (true, unexaggerated) at a cell. */
export function slopeDeg(k) {
  const i = k % N, j = (k / N) | 0;
  const l = elev[j * N + Math.max(0, i - 1)], r = elev[j * N + Math.min(N - 1, i + 1)];
  const u = elev[Math.max(0, j - 1) * N + i], d = elev[Math.min(N - 1, j + 1) * N + i];
  const gx = (r - l) / (2 * CELL), gz = (d - u) / (2 * CELL);
  return Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI;
}

/** Deterministic PRNG so the world (tree layout etc.) is identical every load. */
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
