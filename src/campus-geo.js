// Converts campus-map pixels to simulation meters (x east, z south) and back to lat/lon.
import { GEOREF, CONTROL_POINTS, BUILDINGS } from './data/campus.js';
import { llToXZ, xzToLL } from './geo.js';

function makeTransform() {
  if (CONTROL_POINTS.length >= 2) {
    // similarity transform from two control points
    const [a, b] = CONTROL_POINTS;
    const A = llToXZ(a.lat, a.lon), B = llToXZ(b.lat, b.lon);
    const dpx = [b.px[0] - a.px[0], b.px[1] - a.px[1]], dm = [B.x - A.x, B.z - A.z];
    const s = Math.hypot(...dm) / Math.hypot(...dpx);
    const rot = Math.atan2(dm[1], dm[0]) - Math.atan2(dpx[1], dpx[0]);
    return ([x, y]) => {
      const u = x - a.px[0], v = y - a.px[1];
      return { x: A.x + s * (u * Math.cos(rot) - v * Math.sin(rot)), z: A.z + s * (u * Math.sin(rot) + v * Math.cos(rot)) };
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
