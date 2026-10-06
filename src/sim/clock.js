// Simulation time is kept as "wall-clock" milliseconds for Asheville (America/New_York):
// a Date whose UTC fields equal the local time. This keeps display simple and deterministic.
import { CENTER } from '../geo.js';

export const HOUR = 3600e3;
export const DAY = 24 * HOUR;

export const localMs = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
export function parseLocal(str) { // 'YYYY-MM-DDTHH:MM'
  const [date, time = '00:00'] = str.split('T');
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return localMs(y, mo, d, h, mi);
}

/** US Eastern DST: second Sunday of March 2am -> first Sunday of November 2am. */
export function isDST(t) {
  const d = new Date(t), y = d.getUTCFullYear();
  const nthSunday = (month, n) => { const f = new Date(Date.UTC(y, month, 1)).getUTCDay(); return 1 + ((7 - f) % 7) + 7 * (n - 1); };
  const start = Date.UTC(y, 2, nthSunday(2, 2), 2), end = Date.UTC(y, 10, nthSunday(10, 1), 2);
  return t >= start && t < end;
}
export const toUTC = (t) => t + (isDST(t) ? 4 : 5) * HOUR;

export function dayOfYear(t) {
  const d = new Date(t);
  return (t - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY + 1;
}
export const hourOfDay = (t) => { const d = new Date(t); return d.getUTCHours() + d.getUTCMinutes() / 60; };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function fmt(t, withDow = true) {
  const d = new Date(t);
  let h = d.getUTCHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${withDow ? DOW[d.getUTCDay()] + ' ' : ''}${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} · ${h}:${String(d.getUTCMinutes()).padStart(2, '0')} ${ap} ${isDST(t) ? 'EDT' : 'EST'}`;
}
export const fmtShort = (t) => { const d = new Date(t); let h = d.getUTCHours(); const ap = h >= 12 ? 'p' : 'a'; h = h % 12 || 12; return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${h}${ap}`; };
export const isSchoolDay = (t) => { const w = new Date(t).getUTCDay(); return w >= 1 && w <= 5; };

/** NOAA solar position approximation. Returns elevation & azimuth (deg, azimuth clockwise from north). */
export function sunPosition(t) {
  const utc = toUTC(t);
  const jd = utc / DAY + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * Math.PI / 180;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * Math.PI / 180;
  const eps = (23.439 - 4e-7 * n) * Math.PI / 180;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = (gmst * 15 + CENTER.lon) * Math.PI / 180;
  const ha = lst - ra;
  const lat = CENTER.lat * Math.PI / 180;
  const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha));
  return { elevation: el * 180 / Math.PI, azimuth: ((az * 180 / Math.PI) + 360) % 360 };
}

/** Approximate moon phase illumination (0 new .. 1 full) for nighttime lighting. */
export function moonIllum(t) {
  const days = (toUTC(t) - Date.UTC(2000, 0, 6, 18, 14)) / DAY;
  const phase = ((days % 29.530588) + 29.530588) % 29.530588 / 29.530588;
  return (1 - Math.cos(phase * 2 * Math.PI)) / 2;
}
