// Conditions within ~30 miles of campus, as seen on interstate / highway weather cams.
// The storm over Asheville drives everything; each site differs by elevation (temperature, rain vs. snow,
// extra mountain precipitation), local rivers, and exposure. Locations and elevations are approximate.
import { BANDS, BAND_ELEV0, BAND_STEP, precipType } from './engine.js';

const MI = 1609.34;
export const SITES = [
  { id: 'i26-airport', name: 'I-26 at the airport (Fletcher)', road: 'I-26', lat: 35.436, lon: -82.541, elev: 640, river: 3, riverFt: 15 },
  { id: 'i26-weaverville', name: 'I-26 at Weaverville', road: 'I-26', lat: 35.698, lon: -82.560, elev: 660 },
  { id: 'i26-hendersonville', name: 'I-26 at Hendersonville', road: 'I-26', lat: 35.318, lon: -82.452, elev: 655, river: 1, riverFt: 9 },
  { id: 'i26-marshill', name: 'I-26 near Mars Hill', road: 'I-26', lat: 35.822, lon: -82.553, elev: 720, exposure: 1.15 },
  { id: 'i40-blackmtn', name: 'I-40 at Black Mountain', road: 'I-40', lat: 35.611, lon: -82.322, elev: 730, river: 2, riverFt: 8 },
  { id: 'i40-oldfort', name: 'I-40 Old Fort Mountain grade', road: 'I-40', lat: 35.627, lon: -82.268, elev: 820, exposure: 1.2, steep: true },
  { id: 'i40-canton', name: 'I-40 at Canton', road: 'I-40', lat: 35.531, lon: -82.840, elev: 790, river: 2, riverFt: 10 },
  { id: 'us23-waynesville', name: 'US-23/74 at Waynesville', road: 'US-23/74', lat: 35.478, lon: -82.985, elev: 830 },
  { id: 'brp-pisgah', name: 'Blue Ridge Parkway near Mt. Pisgah', road: 'BRP', lat: 35.402, lon: -82.750, elev: 1480, exposure: 1.3, steep: true },
];

const CAMPUS = { lat: 35.5236, lon: -82.5272 };
for (const s of SITES) {
  const dx = (s.lon - CAMPUS.lon) * 111320 * Math.cos(CAMPUS.lat * Math.PI / 180), dz = (s.lat - CAMPUS.lat) * 110574;
  s.distMi = Math.hypot(dx, dz) / MI;
  s.dir = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((Math.atan2(dx, dz) * 180 / Math.PI) + 360) % 360 / 45) % 8];
}

function band(arr, e) {
  const f = (e - BAND_ELEV0) / BAND_STEP;
  if (f >= BANDS - 1) return arr[BANDS - 1] * (1 + (f - (BANDS - 1)) * 0.25); // above the highest band: a bit more
  const c = Math.max(0, f), i = Math.floor(c), t = c - i;
  return arr[i] * (1 - t) + arr[Math.min(BANDS - 1, i + 1)] * t;
}

export const COND = {
  clear: { label: 'Clear', level: 0 },
  wet: { label: 'Wet', level: 0 },
  fog: { label: 'Fog', level: 1 },
  slush: { label: 'Slushy', level: 1 },
  patchy: { label: 'Patchy black ice', level: 1 },
  snow: { label: 'Snow-covered', level: 2 },
  ice: { label: 'Icy', level: 2 },
  debris: { label: 'Trees down', level: 2 },
  flooded: { label: 'Flooded', level: 2 },
  closed: { label: 'Closed', level: 2 },
};

/** Evaluates every camera site for the current simulation state. */
export function regionalConditions(sim) {
  const w = sim.wx;
  return SITES.map((s, i) => {
    const T = w.tempC - 0.0065 * (s.elev - 650);
    const local = w.coverage >= 1 ? 1 : (Math.sin(i * 12.9898 + Math.floor(sim.t / 3.6e6 / 6) * 78.233) * 0.5 + 0.5) < w.coverage * 1.6 ? 1 : 0.1;
    const precip = w.precip > 0.05 ? w.precip * local * Math.max(0.85, 1 + 0.4 * (s.elev - 650) / 500) : 0;
    const type = precip > 0.05 ? precipType(T, w.warmNose) : 'none';
    const snowCm = band(sim.snowCm, s.elev) * (s.exposure || 1);
    const iceMm = band(sim.iceMm, s.elev);
    const gustMph = w.gustMs * 2.23694 * (s.exposure || 1);
    // interstates & US highways are plowed and salted first, and are mostly clear within a day of the snow ending
    const plowed = s.road === 'BRP' ? 1 : 0.35 * Math.max(0.05, 1 - (sim.sinceSnowH ?? 99) / 20);
    const roadSnow = snowCm * plowed;
    let cond = 'clear';
    if (precip > 0.1 || sim.roadIce > 0.3) cond = 'wet';
    if (w.fog > 0.5 && s.elev < 760) cond = 'fog';
    if (s.elev > 1300 && w.cloud > 0.85 && precip > 0.2) cond = 'fog'; // ridge-top in the clouds
    if ((type === 'snow' && precip > 0.3) || roadSnow > 1) cond = 'slush';
    if ((type === 'snow' && precip > 1.2 && T < 0) || roadSnow > 3 * (s.steep ? 0.6 : 1)) cond = T > 1 ? 'slush' : 'snow';
    if (sim.roadIce > 0.5 && T < 0) cond = cond === 'snow' ? cond : 'patchy';
    if (iceMm > 0.8 || type === 'fzra' || (type === 'sleet' && T < 0) || (sim.roadIce > 0.9 && T < -1 && s.steep)) cond = 'ice';
    if (sim.treesDownFrac * (s.exposure || 1) * Math.max(0.2, 1 - sim.clearance) > 0.08) cond = 'debris';
    if (s.river != null && sim.riseM(s.river) * 3.281 > s.riverFt) cond = 'flooded';
    // the Parkway closes for ice/snow and high winds; Old Fort grade gets closed for wrecks in snow
    if (s.road === 'BRP' && (snowCm > 1 || iceMm > 0.3 || gustMph > 55 || sim.treesDownFrac > 0.02)) cond = 'closed';
    const visMi = Math.max(0.05, (cond === 'fog' ? 0.15 : 10) / (1 + (type === 'snow' ? 4 * precip : 0.12 * precip)));
    return { ...s, T, type, precip, snowCm, iceMm, gustMph, cond, level: COND[cond].level, label: COND[cond].label, visMi };
  });
}

/** One-line summary of the 30-mile check used in school decisions. */
export function regionalSummary(sites) {
  const bad = sites.filter((s) => s.level >= 2 && s.road !== 'BRP');
  const watch = sites.filter((s) => s.level === 1 && s.road !== 'BRP');
  return { bad, watch, interstateBad: bad.filter((s) => s.road.startsWith('I-')).length };
}
