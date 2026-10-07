// The regional (outer) grid: ~197 m terrain out past the 30-mile radius, centered on campus like the inner grid.
import { REGION_HALF_M, REGION_GRID, REGION_RADIUS_M } from './geo-constants.js';
import { REGION_TERRAIN_SIZE, REGION_TERRAIN_B64 } from './data/region-terrain.js';

export { REGION_HALF_M, REGION_RADIUS_M };
export const RN = REGION_TERRAIN_SIZE;
export const RCELL = (2 * REGION_HALF_M) / (RN - 1);

function decode(b64) {
  if (typeof atob === 'function') {
    const s = atob(b64); const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return new Uint16Array(bytes.buffer);
  }
  const buf = Buffer.from(b64, 'base64');
  return new Uint16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
export const relev = (() => { const r = decode(REGION_TERRAIN_B64), o = new Float32Array(r.length); for (let i = 0; i < r.length; i++) o[i] = r[i] / 10; return o; })();

export const rxToI = (x) => (x + REGION_HALF_M) / RCELL;
export const rzToJ = (z) => (z + REGION_HALF_M) / RCELL;
export const riToX = (i) => -REGION_HALF_M + i * RCELL;
export const rjToZ = (j) => -REGION_HALF_M + j * RCELL;
export function rCellIndex(x, z) {
  const i = Math.max(0, Math.min(RN - 1, Math.round(rxToI(x)))), j = Math.max(0, Math.min(RN - 1, Math.round(rzToJ(z))));
  return j * RN + i;
}
export function regionElevationAt(x, z) {
  const fi = Math.max(0, Math.min(RN - 1.001, rxToI(x))), fj = Math.max(0, Math.min(RN - 1.001, rzToJ(z)));
  const i = Math.floor(fi), j = Math.floor(fj), a = fi - i, b = fj - j, k = j * RN + i;
  return (relev[k] * (1 - a) + relev[k + 1] * a) * (1 - b) + (relev[k + RN] * (1 - a) + relev[k + RN + 1] * a) * b;
}
