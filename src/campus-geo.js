// Converts campus-map pixels to simulation meters (x east, z south) and back to lat/lon.
import { GEOREF, CONTROL_POINTS, BUILDINGS } from './data/campus.js';
import { llToXZ, xzToLL } from './geo.js';

function makeTransform() {
  if (CONTROL_POINTS.length >= 2) {
    // least-squares similarity transform (position, uniform scale, rotation) through all control points
    const P = CONTROL_POINTS.map((c) => c.px), Q = CONTROL_POINTS.map((c) => llToXZ(c.lat, c.lon));
    const n = P.length;
    const px = P.reduce((s, p) => s + p[0], 0) / n, py = P.reduce((s, p) => s + p[1], 0) / n;
    const qx = Q.reduce((s, q) => s + q.x, 0) / n, qz = Q.reduce((s, q) => s + q.z, 0) / n;
    let a = 0, b = 0, d = 0;
    P.forEach((p, i) => {
      const x = p[0] - px, y = p[1] - py, u = Q[i].x - qx, v = Q[i].z - qz;
      a += x * u + y * v; b += x * v - y * u; d += x * x + y * y;
    });
    const s = Math.hypot(a, b) / d, rot = Math.atan2(b, a);
    return ([x, y]) => {
      const u = x - px, v = y - py;
      return { x: qx + s * (u * Math.cos(rot) - v * Math.sin(rot)), z: qz + s * (u * Math.sin(rot) + v * Math.cos(rot)) };
    };
  }
  const s = GEOREF.metersPerPx, r = GEOREF.rotationDeg * Math.PI / 180;
  return ([x, y]) => {
    const u = (x - GEOREF.anchorPx[0]) * s, v = (y - GEOREF.anchorPx[1]) * s;
    return { x: u * Math.cos(r) - v * Math.sin(r), z: u * Math.sin(r) + v * Math.cos(r) };
  };
}
export const pxToXZ = makeTransform();
export const pxToLL = (p) => { const { x, z } = pxToXZ(p); const ll = xzToLL(x, z); return [ll.lat, ll.lon]; };
export const polyXZ = (poly) => poly.map(pxToXZ);

export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

// Rough outline of the campus property (map pixels), used to keep OpenStreetMap buildings from doubling up.
export const CAMPUS_BOUNDARY = polyXZ([[420, 95], [1035, 95], [1040, 1020], [680, 1020], [290, 700], [290, 380], [420, 360]]);
export const inCampus = (x, z) => pointInPoly(x, z, CAMPUS_BOUNDARY);

/** Building centers in meters, keyed by id. */
export const BUILDING_XZ = Object.fromEntries(BUILDINGS.map((b) => {
  const pts = (b.poly || b.parts[0]).map(pxToXZ);
  return [b.id, { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length }];
}));
