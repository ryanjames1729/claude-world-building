// Live weather from public feeds, turned into the same hourly "targets" the simulation uses for scenarios:
//   • National Weather Service (api.weather.gov): gridded forecast for the campus grid square (~2.5 km), latest
//     and past-48 h observations at Asheville Regional Airport (KAVL), and active alerts for campus.
//   • USGS Water Services: gauge height on the French Broad at Asheville (03451500) and the Swannanoa at
//     Biltmore (03451000).
// Parsing is pure and tested with fixtures; fetching happens in the browser (both APIs allow cross-origin requests).
import { HOUR, fromUTC, toUTC } from './clock.js';
import { CENTER } from '../geo-constants.js';

export const USGS_SITES = { frenchBroad: '03451500', swannanoa: '03451000' };

// ---------- helpers ----------
/** "2026-10-07T01:00:00+00:00/PT3H" or ".../P1DT6H" → { start (UTC ms), hours } */
export function parseValidTime(s) {
  const [iso, dur] = s.split('/');
  const m = /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(dur || 'PT1H');
  const hours = (+(m[1] || 0)) * 24 + (+(m[2] || 0)) + (+(m[3] || 0)) / 60;
  return { start: Date.parse(iso), hours: Math.max(hours, 1 / 60) };
}
const unitConv = (uom) => {
  if (!uom) return (v) => v;
  if (uom.endsWith('degF')) return (v) => (v - 32) * 5 / 9;
  if (uom.endsWith('km_h-1')) return (v) => v / 3.6;
  if (uom.endsWith('m_s-1')) return (v) => v;
  if (uom.endsWith('mi_h-1')) return (v) => v / 2.23694;
  if (uom.endsWith(':in')) return (v) => v * 25.4;
  return (v) => v; // degC, mm, percent, degree, m
};

/** Expand an NWS gridData layer into an hourly map: UTC hour (ms) → value (rates for accumulations). */
function expandLayer(layer, { accumulate = false } = {}) {
  const out = new Map();
  if (!layer?.values) return out;
  const conv = unitConv(layer.uom);
  for (const { validTime, value } of layer.values) {
    if (value == null) continue;
    const { start, hours } = parseValidTime(validTime);
    const n = Math.max(1, Math.round(hours));
    const v = conv(value);
    for (let i = 0; i < n; i++) out.set(start + i * HOUR, accumulate ? v / n : v);
  }
  return out;
}

/** Strongest weather type & coverage in an NWS "weather" layer, per hour. */
function expandWeather(layer) {
  const out = new Map();
  if (!layer?.values) return out;
  for (const { validTime, value } of layer.values) {
    const { start, hours } = parseValidTime(validTime);
    const kinds = (value || []).filter((w) => w && w.weather).map((w) => ({ w: w.weather, c: w.coverage || '', i: w.intensity || '' }));
    for (let i = 0; i < Math.max(1, Math.round(hours)); i++) out.set(start + i * HOUR, kinds);
  }
  return out;
}

const COVER = { isolated: 0.25, slight_chance: 0.2, chance: 0.4, scattered: 0.45, patchy: 0.4, areas: 0.6, numerous: 0.7, likely: 0.7, widespread: 0.9, definite: 0.9, occasional: 0.6, frequent: 0.8, periods: 0.6, brief: 0.4, intermittent: 0.5 };

// ---------- parsers ----------
/** NWS gridpoints raw data → array of hourly forecast records { utc, tempC, dewC, cloud, windMs, gustMs, windDir, precipMm, snowMm, iceMm, pop, kinds, visM }. */
export function parseGridData(json) {
  const p = json.properties || json;
  const L = {
    temp: expandLayer(p.temperature), dew: expandLayer(p.dewpoint), sky: expandLayer(p.skyCover),
    wind: expandLayer(p.windSpeed), gust: expandLayer(p.windGust), dir: expandLayer(p.windDirection),
    qpf: expandLayer(p.quantitativePrecipitation, { accumulate: true }), snow: expandLayer(p.snowfallAmount, { accumulate: true }),
    ice: expandLayer(p.iceAccumulation, { accumulate: true }), pop: expandLayer(p.probabilityOfPrecipitation),
    vis: expandLayer(p.visibility), wx: expandWeather(p.weather),
  };
  const hours = [...L.temp.keys()].sort((a, b) => a - b);
  return hours.map((u) => ({
    utc: u, tempC: L.temp.get(u), dewC: L.dew.get(u) ?? L.temp.get(u) - 4, cloud: (L.sky.get(u) ?? 50) / 100,
    windMs: L.wind.get(u) ?? 2, gustMs: L.gust.get(u) ?? (L.wind.get(u) ?? 2) * 1.5, windDir: L.dir.get(u) ?? 220,
    precipMm: L.qpf.get(u) ?? 0, snowMm: L.snow.get(u) ?? 0, iceMm: L.ice.get(u) ?? 0, pop: L.pop.get(u) ?? 0,
    kinds: L.wx.get(u) || [], visM: L.vis.get(u),
  }));
}

const qv = (x) => (x && x.value != null ? unitConv(x.unitCode)(x.value) : null);
/** NWS station observations (FeatureCollection or single Feature) → records like parseGridData's, oldest first. */
export function parseObservations(json) {
  const feats = json.features || [json];
  const recs = feats.map((f) => {
    const p = f.properties || {};
    const tempC = qv(p.temperature);
    if (tempC == null) return null;
    const desc = (p.textDescription || '').toLowerCase();
    const kinds = [];
    if (/freezing (rain|drizzle)/.test(desc)) kinds.push({ w: 'freezing_rain', c: 'definite' });
    else if (/sleet|ice pellets/.test(desc)) kinds.push({ w: 'sleet', c: 'definite' });
    else if (/snow/.test(desc)) kinds.push({ w: 'snow', c: 'definite' });
    else if (/rain|drizzle|showers/.test(desc)) kinds.push({ w: 'rain', c: 'definite' });
    if (/thunder/.test(desc)) kinds.push({ w: 'thunderstorms', c: 'definite' });
    if (/fog|mist/.test(desc)) kinds.push({ w: 'fog', c: /fog/.test(desc) ? 'areas' : 'patchy' });
    const layers = p.cloudLayers || [];
    const cover = { CLR: 0, SKC: 0, FEW: 0.2, SCT: 0.45, BKN: 0.75, OVC: 1, VV: 1 };
    const cloud = layers.length ? Math.max(...layers.map((l) => cover[l.amount] ?? 0.5)) : (/clear|sunny|fair/.test(desc) ? 0.05 : 0.5);
    let precipMm = qv(p.precipitationLastHour);
    if (precipMm == null && kinds.some((k) => k.w !== 'fog' && k.w !== 'thunderstorms')) precipMm = /heavy/.test(desc) ? 6 : /light/.test(desc) ? 0.8 : 2.5;
    return {
      utc: Date.parse(p.timestamp), tempC, dewC: qv(p.dewpoint) ?? tempC - 4, cloud, windMs: qv(p.windSpeed) ?? 2,
      gustMs: qv(p.windGust) ?? (qv(p.windSpeed) ?? 2) * 1.4, windDir: qv(p.windDirection) ?? 220, precipMm: precipMm ?? 0,
      snowMm: 0, iceMm: 0, pop: precipMm ? 100 : 0, kinds, visM: qv(p.visibility), desc: p.textDescription || '', observed: true,
    };
  }).filter(Boolean);
  return recs.sort((a, b) => a.utc - b.utc);
}

/** NWS active alerts → [{ level, text, headline, expires, source: 'NWS' }] */
export function parseAlerts(json) {
  const LV = { Extreme: 'extreme', Severe: 'warning', Moderate: 'warning', Minor: 'advisory', Unknown: 'advisory' };
  return (json.features || []).map((f) => f.properties).filter(Boolean).map((p) => ({
    level: /Warning|Emergency/.test(p.event) ? (p.severity === 'Extreme' ? 'extreme' : 'warning') : LV[p.severity] || 'advisory',
    text: p.event, headline: p.headline || '', expires: p.expires || p.ends, source: 'NWS',
  }));
}

/** USGS instantaneous values → { [siteNo]: { ft, utc, cfs } } using the latest gauge height. */
export function parseUSGS(json) {
  const out = {};
  for (const ts of json?.value?.timeSeries || []) {
    const site = ts.sourceInfo?.siteCode?.[0]?.value, code = ts.variable?.variableCode?.[0]?.value;
    const vals = ts.values?.[0]?.value || [];
    const last = vals[vals.length - 1];
    if (!site || !last) continue;
    const v = parseFloat(last.value);
    if (!Number.isFinite(v) || v < -900) continue;
    out[site] ||= {};
    if (code === '00065') { out[site].ft = v; out[site].utc = Date.parse(last.dateTime); }
    if (code === '00060') out[site].cfs = v;
  }
  return out;
}

// ---------- turning records into simulation targets ----------
function recordToTargets(r) {
  const has = (w) => r.kinds.some((k) => k.w === w);
  const cov = (w) => Math.max(0, ...r.kinds.filter((k) => k.w === w).map((k) => COVER[k.c] ?? 0.5));
  const tC = r.tempC;
  // the forecast says what falls; give the model a warm-layer temperature that makes the same call
  let warmNose = tC > 0 ? tC - 2 : tC - 4;
  if (r.iceMm > 0 || has('freezing_rain') || has('freezing_drizzle')) warmNose = Math.max(3.5, tC + 4);
  else if (has('sleet')) warmNose = 1.5;
  else if (r.snowMm > 0 || has('snow') || has('snow_showers')) warmNose = Math.min(tC - 3, -2.5);
  else if (r.precipMm > 0 && tC < 2) warmNose = tC + 3; // forecast rain near freezing
  const fogV = r.visM != null && r.visM < 1600 ? Math.min(1, (1600 - r.visM) / 1400) : 0;
  const thunder = cov('thunderstorms') * (r.pop >= 30 ? 1 : 0.5);
  return {
    label: r.observed ? `Observed at KAVL${r.desc ? ` · ${r.desc}` : ''}` : 'NWS forecast',
    tempC: tC, dewDep: Math.max(0, tC - r.dewC), cloud: Math.min(1, r.cloud), precip: r.precipMm,
    windMs: r.windMs, gustMs: Math.max(r.windMs, r.gustMs), windDir: r.windDir, warmNose,
    thunder, fog: Math.max(fogV, cov('fog') * (has('fog') ? 1 : 0)),
    coverage: has('thunderstorms') && !has('rain') ? 0.35 : 1,
  };
}

export class LiveFeed {
  constructor() {
    this.obs = []; this.forecast = []; this.alerts = []; this.gauges = {};
    this.meta = { gridUpdated: null, office: '', grid: '', obsTime: null, gaugeTime: null, fetchedAt: null, error: null };
  }
  /** Merge observations (past) and forecast (future) into one hourly series keyed by sim time. */
  rebuild() {
    const lastObs = this.obs.length ? this.obs[this.obs.length - 1].utc : -Infinity;
    const recs = [...this.obs, ...this.forecast.filter((r) => r.utc > lastObs + 30 * 60e3)];
    this.series = recs.map((r) => ({ t: fromUTC(r.utc), r, g: recordToTargets(r) }));
    // ease the forecast's first hours toward the latest observation (forecast bias correction)
    const o = this.obs[this.obs.length - 1];
    const f0 = this.series.find((s) => !s.r.observed);
    if (o && f0) {
      const dT = o.tempC - f0.r.tempC, dW = o.windMs - f0.r.windMs;
      for (const s of this.series) {
        if (s.r.observed) continue;
        const h = (s.r.utc - o.utc) / HOUR, w = Math.max(0, 1 - h / 6);
        s.g = { ...s.g, tempC: s.g.tempC + dT * w, windMs: Math.max(0, s.g.windMs + dW * w) };
      }
    }
  }
  get start() { return this.series?.[0]?.t ?? null; }
  get end() { return this.series?.length ? this.series[this.series.length - 1].t + HOUR : null; }
  covers(t) { return this.series?.length && t >= this.start && t < this.end; }
  /** Targets at sim time t: smooth temperature/wind, step-wise precipitation within each hour. */
  targets(t) {
    const S = this.series;
    let i = 0, j = S.length - 1;
    while (i < j) { const m = (i + j + 1) >> 1; if (S[m].t <= t) i = m; else j = m - 1; }
    const a = S[i], b = S[Math.min(S.length - 1, i + 1)];
    const f = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
    const L = (k) => a.g[k] + (b.g[k] - a.g[k]) * f;
    return { ...a.g, tempC: L('tempC'), dewDep: L('dewDep'), cloud: L('cloud'), windMs: L('windMs'), gustMs: L('gustMs'),
      windDir: a.g.windDir + ((((b.g.windDir - a.g.windDir) % 360) + 540) % 360 - 180) * f, warmNose: L('warmNose') };
  }
  hasData() { return !!this.series?.length; }
}

// ---------- fetching (browser) ----------
const NWS = 'https://api.weather.gov';
async function getJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/geo+json' } });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

/** Full refresh: forecast grid, observations (past 48 h), alerts. */
export async function refreshNWS(feed) {
  if (!feed.points) feed.points = (await getJSON(`${NWS}/points/${CENTER.lat.toFixed(4)},${CENTER.lon.toFixed(4)}`)).properties;
  const pts = feed.points;
  const start = new Date(Date.now() - 48 * HOUR).toISOString();
  const [grid, obs, alerts] = await Promise.all([
    getJSON(pts.forecastGridData),
    getJSON(`${NWS}/stations/KAVL/observations?start=${encodeURIComponent(start)}`),
    getJSON(`${NWS}/alerts/active?point=${CENTER.lat.toFixed(4)},${CENTER.lon.toFixed(4)}`).catch(() => ({ features: [] })),
  ]);
  feed.forecast = parseGridData(grid);
  feed.obs = parseObservations(obs);
  feed.alerts = parseAlerts(alerts);
  feed.meta = { ...feed.meta, gridUpdated: grid.properties?.updateTime, office: pts.gridId, grid: `${pts.gridX},${pts.gridY}`,
    obsTime: feed.obs.length ? feed.obs[feed.obs.length - 1].utc : null, fetchedAt: Date.now(), error: null };
  feed.rebuild();
  return feed;
}

export async function refreshUSGS(feed) {
  const sites = Object.values(USGS_SITES).join(',');
  const json = await getJSON(`https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${sites}&parameterCd=00065,00060&period=PT6H`);
  feed.gauges = parseUSGS(json);
  feed.meta.gaugeTime = Math.max(0, ...Object.values(feed.gauges).map((g) => g.utc || 0)) || null;
  return feed;
}

export { toUTC };
