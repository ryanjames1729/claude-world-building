// The simulation core: weather state, elevation-band snow/ice physics, soil moisture,
// river hydrology, and impacts (trees, power, landslides, roads, school operations, alerts).
// Pure JavaScript — no rendering — so it can be unit-tested in Node.
import { elev, N, slopeDeg, mulberry32, REF_ELEV_M } from '../geo.js';
import { ClimateGenerator, cToF, fToC } from './climate.js';
import { SCENARIOS } from './scenarios.js';
import { HOUR, DAY, parseLocal, hourOfDay, dayOfYear, sunPosition, isSchoolDay, localMs } from './clock.js';

export const BANDS = 8;
export const BAND_ELEV0 = 600;
export const BAND_STEP = 85;            // bands cover ~600 m (river) .. ~1200 m (ridgetops)
export const bandElev = (b) => BAND_ELEV0 + b * BAND_STEP;
export const MPH = 2.23694;
export const IN = 25.4;

// River reservoirs: creeks respond in under an hour, the French Broad over a day.
const RIVERS = [
  { name: 'Creeks',            tau: 0.6,  a: 0.42, base: 0.35 },
  { name: 'Larger streams',    tau: 2.5,  a: 0.75, base: 0.8 },
  { name: 'Swannanoa River',   tau: 7,    a: 1.30, base: 1.4, gaugeBaseFt: 3.0 },
  { name: 'French Broad River',tau: 13,   a: 1.45, base: 1.8, gaugeBaseFt: 2.2 },
];
export const RIVER_INFO = RIVERS;
const STAGE_EXP = 0.62;

const SOIL_CAP_MM = 130;

export function precipType(tC, noseC) {
  if (tC > 1.5) return noseC < -2 && tC < 3 ? 'snow' : 'rain';
  if (tC > 0) return noseC > 1 ? 'rain' : 'snow';      // wet snow / rain-snow mix near freezing
  if (noseC > 2.5) return 'fzra';
  if (noseC > 0.5) return 'sleet';
  return 'snow';
}
export const PTYPE_LABEL = { none: 'None', rain: 'Rain', snow: 'Snow', sleet: 'Sleet', fzra: 'Freezing rain' };

export class Simulation {
  constructor(hydro, seed = 1234) {
    this.hydro = hydro;
    this.rng = mulberry32(seed);
    this.climate = new ClimateGenerator(mulberry32(seed + 7));
    this.mode = 'auto';
    this.scenario = null;
    this.manual = { tempF: 45, noseF: 0, noseAuto: true, windMph: 8, gustMph: 15, rainInHr: 0, cloud: 0.5, fog: 0, thunder: 0 };
    this.listeners = { landslide: [], decision: [], reset: [] };
    this.roadEvaluator = null;
    this.bandAreaFrac = this.computeBandAreas();
    this.slideCandidates = this.computeSlideCandidates();
    const now = new Date();
    this.reset(localMs(now.getFullYear(), now.getMonth() + 1, now.getDate(), 7, 0));
  }

  on(ev, fn) { this.listeners[ev].push(fn); }
  emit(ev, data) { for (const fn of this.listeners[ev]) fn(data); }

  computeBandAreas() {
    const f = new Float64Array(BANDS);
    for (let k = 0; k < elev.length; k++) {
      const b = Math.max(0, Math.min(BANDS - 1, Math.round((elev[k] - BAND_ELEV0) / BAND_STEP)));
      f[b]++;
    }
    return Array.from(f, (v) => v / elev.length);
  }

  computeSlideCandidates() {
    const out = [];
    for (let k = 0; k < elev.length; k += 1) {
      const i = k % N, j = (k / N) | 0;
      if (i < 3 || j < 3 || i > N - 4 || j > N - 4) continue;
      const s = slopeDeg(k);
      if (s > 24 && this.hydro.hand[k] > 25) out.push(k);
    }
    return out;
  }

  /** Clears accumulated impacts and resets state at time t. */
  reset(t, init = {}) {
    this.t = t;
    this.lastT = t;
    this.wx = { tempC: 12, dewC: 8, windMs: 3, gustMs: 5, windDir: 220, cloud: 0.4, precip: 0, warmNose: 8, thunder: 0, fog: 0, label: '' };
    this.snowCm = new Float64Array(BANDS);
    this.iceMm = new Float64Array(BANDS);
    this.roadIce = 0;            // 0..1 black-ice potential
    this.soil = init.soil ?? 0.45;
    this.Q = new Float64Array(4);
    const base = this.baseflow();
    for (let i = 0; i < 4; i++) this.Q[i] = base;
    this.stages = new Float32Array(4);
    this.updateStages();
    this.treesDownFrac = 0;
    this.powerOut = 0;
    this.landslides = [];
    this.rainTotalMm = 0;
    this.snowfallCm = 0;
    this.maxGustMph = 0;
    this.peak = { fb: 0, sw: 0 };
    this.history = [];
    this.lastHist = -Infinity;
    this.decisions = new Map();
    this.roads = null;
    this.note = '';
    this.alerts = [];
    // spin up the weather so it isn't stuck at defaults
    if (this.mode === 'auto') { for (let i = 0; i < 12; i++) this.applyTargets(this.climate.target(t, 1), 1, 1); }
    else this.applyTargets(this.currentTargets(0), 1, 1);
    this.computeBands();
    this.emit('reset', this);
  }

  baseflow() { return 0.08 + 0.35 * this.soil ** 3; }

  setMode(mode, scenarioId) {
    this.mode = mode;
    if (mode === 'scenario') {
      this.scenario = SCENARIOS.find((s) => s.id === scenarioId);
      this.scenario.keysT = this.scenario.keys.map((k) => ({ ...k, ms: parseLocal(k.t) }));
      this.scenario.endMs = parseLocal(this.scenario.end);
      this.reset(parseLocal(this.scenario.start), this.scenario.init);
    } else {
      this.scenario = null;
    }
  }

  scenarioTargets(t) {
    const K = this.scenario.keysT;
    let a = K[0], b = K[K.length - 1];
    if (t <= a.ms) b = a;
    else if (t >= b.ms) a = b;
    else for (let i = 0; i < K.length - 1; i++) if (t >= K[i].ms && t < K[i + 1].ms) { a = K[i]; b = K[i + 1]; break; }
    const f = a === b ? 0 : (t - a.ms) / (b.ms - a.ms);
    const L = (k, d = 0) => (a[k] ?? d) + ((b[k] ?? d) - (a[k] ?? d)) * f;
    // last note at or before t
    let note = '';
    for (const k of K) if (k.ms <= t && k.note) note = k.note;
    this.note = note;
    const tC = fToC(L('tF'));
    const nose = a.noseF != null || b.noseF != null ? fToC(L('noseF', a.noseF ?? b.noseF)) : (tC > 0 ? tC - 2 : tC - 4);
    const rain = L('rain') * IN;
    // add a little convective variability so rates aren't perfectly smooth
    const wob = 1 + 0.25 * Math.sin(t / 7.3e5) * Math.sin(t / 2.9e6);
    return {
      label: this.scenario.name, tempC: tC, dewDep: rain > 0 ? 0.3 : 3, cloud: L('cloud', 1), precip: rain * wob,
      windMs: L('wind') / MPH, gustMs: L('gust') / MPH, windDir: a.dir + (((b.dir - a.dir + 540) % 360) - 180) * f,
      warmNose: nose, thunder: L('thunder'), fog: L('fog'), coverage: this.scenario.coverage ?? 1,
    };
  }

  manualTargets() {
    const m = this.manual, tC = fToC(m.tempF);
    return {
      label: 'Manual control', tempC: tC, dewDep: m.rainInHr > 0 ? 0.3 : m.fog > 0.3 ? 0.2 : 5, cloud: Math.max(m.cloud, m.rainInHr > 0 ? 0.85 : 0),
      precip: m.rainInHr * IN, windMs: m.windMph / MPH, gustMs: Math.max(m.windMph, m.gustMph) / MPH, windDir: 220,
      warmNose: m.noseAuto ? (tC > 0 ? tC - 2 : tC - 4) : fToC(m.noseF), thunder: m.thunder, fog: m.fog,
    };
  }

  currentTargets(dtH) {
    if (this.mode === 'scenario' && this.scenario) {
      if (this.t <= this.scenario.endMs) return this.scenarioTargets(this.t);
      this.note = 'Scenario complete — weather now follows Asheville\'s normal climate while impacts play out.';
      return this.climate.target(this.t, dtH);
    }
    if (this.mode === 'manual') return this.manualTargets();
    return this.climate.target(this.t, dtH);
  }

  applyTargets(g, dtH, snap = 0) {
    const w = this.wx;
    const k = (tau) => (snap ? 1 : 1 - Math.exp(-dtH / tau));
    const tauT = this.mode === 'auto' ? 1.2 : 0.15, tauP = this.mode === 'auto' ? 0.4 : 0.08;
    w.tempC += (g.tempC - w.tempC) * k(tauT);
    w.dewC = Math.min(w.tempC, w.dewC + ((g.tempC - g.dewDep) - w.dewC) * k(tauT));
    w.cloud += (g.cloud - w.cloud) * k(tauP * 2);
    w.precip += (g.precip - w.precip) * k(tauP);
    if (w.precip < 0.02) w.precip = g.precip === 0 ? 0 : w.precip;
    w.windMs += (g.windMs - w.windMs) * k(tauP * 2);
    w.gustMs += (g.gustMs - w.gustMs) * k(tauP * 2);
    w.windDir = g.windDir;
    w.warmNose += (g.warmNose - w.warmNose) * k(tauT);
    w.thunder += (g.thunder - w.thunder) * k(tauP);
    w.fog += (g.fog - w.fog) * k(tauP * 2);
    w.label = g.label;
    w.coverage = g.coverage ?? 1;
    w.regime = g.regime;
  }

  computeBands() {
    const w = this.wx, sun = sunPosition(this.t);
    this.sun = sun;
    // nighttime inversion: clear + calm nights make valleys colder than slopes (thermal belts)
    const inv = sun.elevation < 0 ? (1 - w.cloud) * Math.max(0, 1 - w.windMs / 5) * 3.5 : 0;
    this.bandT = [];
    this.bandType = [];
    for (let b = 0; b < BANDS; b++) {
      const e = bandElev(b);
      const t = w.tempC - 0.0065 * (e - REF_ELEV_M) + inv * Math.max(-0.3, Math.min(1, (e - REF_ELEV_M) / 350));
      this.bandT.push(t);
      this.bandType.push(w.precip > 0.05 ? precipType(t, w.warmNose) : 'none');
    }
    const ref = Math.round((REF_ELEV_M - BAND_ELEV0) / BAND_STEP);
    this.refBand = ref;
    this.ptype = w.precip > 0.05 ? precipType(w.tempC, w.warmNose) : 'none';
  }

  /** Orographic enhancement: ridges get more precipitation than valleys. */
  oro(b) { return Math.max(0.85, 1 + 0.4 * (bandElev(b) - REF_ELEV_M) / 500); }

  step(dtH) {
    if (!(dtH > 0)) return;
    const w = this.wx;
    this.t += dtH * HOUR;
    this.applyTargets(this.currentTargets(dtH), dtH);
    this.computeBands();

    // --- Snow & ice per elevation band, and liquid water reaching the ground
    let liquid = 0;
    const sunMelt = this.sun.elevation > 5 ? Math.sin(this.sun.elevation * Math.PI / 180) * (1 - w.cloud * 0.8) : 0;
    for (let b = 0; b < BANDS; b++) {
      const T = this.bandT[b], P = w.precip * this.oro(b) * dtH, type = this.bandType[b];
      let liq = 0;
      if (type === 'snow') {
        const ratio = T < -8 ? 16 : T < -4 ? 13 : T < -1 ? 11 : 8;
        this.snowCm[b] += P * ratio / 10 * (T > 0.5 && this.snowCm[b] < 1 ? 0.4 : 1);
      } else if (type === 'sleet') {
        this.snowCm[b] += P * 0.3;
      } else if (type === 'fzra') {
        this.iceMm[b] += P * 0.55;
        liq += P * 0.45;
      } else if (type === 'rain') {
        liq += P;
      }
      // melt
      if (this.snowCm[b] > 0) {
        const melt = Math.min(this.snowCm[b], (Math.max(0, T) * 0.12 + (type === 'rain' ? P * 0.3 : 0) + sunMelt * 0.25 * (T > -3 ? 1 : 0.2)) * dtH);
        this.snowCm[b] -= melt; liq += melt * 0.35;
        this.snowCm[b] *= 1 - 0.004 * dtH; // settling/compaction
      }
      if (this.iceMm[b] > 0) {
        const m = Math.min(this.iceMm[b], (Math.max(0, T + 0.5) * 0.6 + sunMelt * 0.3 + w.windMs * 0.01) * dtH);
        this.iceMm[b] -= m; liq += m;
      }
      liquid += liq * this.bandAreaFrac[b];
      if (b === this.refBand) {
        if (type === 'snow') this.snowfallCm += P * (T < -4 ? 1.3 : 1.0);
        this.rainTotalMm += w.precip * dtH;
      }
    }

    // --- black ice on roads: wet pavement that refreezes
    const Tref = this.bandT[this.refBand];
    const wet = w.precip > 0.05 && Tref > 0 || this.snowCm[this.refBand] > 0.5 && Tref > 0;
    if (wet) this.roadIce = Math.max(this.roadIce, 0.4);
    if (Tref <= -0.5 && this.roadIce > 0) this.roadIce = Math.min(1, this.roadIce + dtH * 0.3);
    if (this.ptype === 'fzra') this.roadIce = 1;
    if (Tref > 1 && !wet) this.roadIce = Math.max(0, this.roadIce - dtH * (this.sun.elevation > 0 ? 0.25 : 0.1));
    if (Tref > 3) this.roadIce = Math.max(0, this.roadIce - dtH * 0.5);

    // --- soil moisture & runoff (mm/h)
    const sat = this.soil;
    const runFrac = Math.min(0.95, 0.08 + 0.87 * sat ** 2.5);
    const inRate = liquid / dtH;
    const runoff = inRate * runFrac;
    this.soil += (inRate * (1 - runFrac) * dtH) / SOIL_CAP_MM;
    const et = (w.tempC > 5 && this.sun.elevation > 0 ? 0.12 : 0.02) * (1 - w.cloud * 0.6);
    this.soil -= (et + 0.05 * sat) * dtH / SOIL_CAP_MM * 4;
    this.soil = Math.max(0.05, Math.min(1, this.soil));

    // --- rivers: linear reservoirs (catchments respond on different time scales)
    // Big rivers integrate rain over basins far larger than this map; a local thunderstorm barely moves them.
    const cov = w.coverage ?? 1;
    for (let r = 0; r < 4; r++) {
      const share = r <= 1 ? 1 : r === 2 ? 0.3 + 0.7 * cov : cov;
      const inflow = runoff * share + this.baseflow();
      this.Q[r] += (inflow - this.Q[r]) * (1 - Math.exp(-dtH / RIVERS[r].tau));
    }
    this.updateStages();
    this.peak.fb = Math.max(this.peak.fb, this.gaugeFt(3));
    this.peak.sw = Math.max(this.peak.sw, this.gaugeFt(2));

    // --- wind & ice damage to trees
    const gustMph = w.gustMs * MPH;
    this.maxGustMph = Math.max(this.maxGustMph, gustMph);
    const iceIn = this.iceMm[this.refBand + 1] / IN;
    const heavySnow = this.snowCm[this.refBand] > 25 ? 6 : 0;
    const thr = 58 - 22 * sat ** 3 - 40 * Math.min(1, iceIn / 0.6) - heavySnow;
    const windRate = 2e-5 * Math.max(0, gustMph - thr) ** 2;
    const iceRate = 0.008 * Math.max(0, iceIn - 0.25);
    const remaining = 1 - this.treesDownFrac;
    this.treesDownFrac += remaining * Math.min(0.5, (windRate + iceRate) * dtH);

    // --- power: damage drives outages; crews restore after the weather calms
    const target = Math.min(0.97, this.treesDownFrac * 4 + Math.max(0, iceIn - 0.2) * 0.6 + Math.max(0, gustMph - 45) * 0.012);
    if (target > this.powerOut) this.powerOut += (target - this.powerOut) * Math.min(1, dtH * 1.5);
    else if (gustMph < 30 && iceIn < 0.1) this.powerOut = Math.max(0, this.powerOut - dtH * (this.treesDownFrac > 0.03 ? 0.004 : 0.03));

    // --- landslides on steep, saturated slopes during intense rain
    const rainNow = w.precip;
    const slideRate = 4 * Math.max(0, (sat - 0.86) / 0.14) * Math.max(0, (rainNow - 7) / 18);
    let expected = slideRate * dtH;
    while (expected > 0) {
      if (this.rng() < Math.min(1, expected)) this.triggerLandslide();
      expected -= 1;
    }

    // --- roads, alerts, school decisions, history
    if (this.roadEvaluator) this.roads = this.roadEvaluator(this);
    this.alerts = this.computeAlerts();
    this.checkSchoolDecision(dtH);
    if (this.t - this.lastHist >= 0.5 * HOUR) {
      this.lastHist = this.t;
      this.history.push({ t: this.t, tempF: cToF(w.tempC), rainIn: w.precip / IN, fb: this.gaugeFt(3), sw: this.gaugeFt(2),
        snowIn: this.snowCm[this.refBand] / 2.54, gust: gustMph, ptype: this.ptype });
      while (this.history.length > 24 * 2 * 5) this.history.shift();
    }
    this.lastT = this.t;
  }

  updateStages() {
    for (let r = 0; r < 4; r++) {
      const R = RIVERS[r];
      const rise = R.a * Math.max(0, this.Q[r] - 0.1) ** STAGE_EXP;
      this.stages[r] = R.base + rise;
    }
  }
  riseM(r) { return this.stages[r] - RIVERS[r].base; }
  gaugeFt(r) { return (RIVERS[r].gaugeBaseFt ?? 1) + this.riseM(r) * 3.281 * 1.0; }

  triggerLandslide() {
    const h = this.hydro, c = this.slideCandidates;
    if (!c.length) return;
    // bias toward the steepest candidates
    let k = c[(this.rng() * c.length) | 0];
    const k2 = c[(this.rng() * c.length) | 0];
    if (slopeDeg(k2) > slopeDeg(k)) k = k2;
    const path = [k];
    let cur = k;
    for (let s = 0; s < 40; s++) {
      const nx = h.down[cur];
      if (nx < 0) break;
      path.push(nx);
      cur = nx;
      if (h.cls[nx] >= 1 || (s > 8 && slopeDeg(nx) < 8)) break;
    }
    const slide = { id: this.landslides.length, t: this.t, cell: k, path };
    this.landslides.push(slide);
    this.emit('landslide', slide);
  }

  /** Look-ahead over scripted scenario weather (null outside scenarios). */
  forecast(hours) {
    if (this.mode !== 'scenario' || !this.scenario || this.t > this.scenario.endMs) return null;
    let maxGustMph = 0, maxRainIn = 0, snowIn = 0, fzra = false;
    for (let h = 0; h <= hours; h += 0.5) {
      const g = this.scenarioTargets(this.t + h * HOUR);
      maxGustMph = Math.max(maxGustMph, g.gustMs * MPH);
      maxRainIn = Math.max(maxRainIn, g.precip / IN);
      const type = g.precip > 0.05 ? precipType(g.tempC, g.warmNose) : 'none';
      if (type === 'snow') snowIn += (g.precip * 0.5) * 1.2 / 2.54;
      if (type === 'fzra') fzra = true;
    }
    this.scenarioTargets(this.t); // restore the current narrative note
    return { maxGustMph, maxRainIn, snowIn, fzra };
  }

  get campus() {
    const b = this.refBand;
    return { tempC: this.bandT[b], snowCm: this.snowCm[b], iceMm: this.iceMm[b], ptype: this.bandType[b] };
  }

  visibilityMi() {
    const w = this.wx;
    let v = 10;
    if (this.ptype === 'snow' || this.ptype === 'sleet') v = 10 / (1 + 4 * w.precip * (1 + w.windMs / 10));
    else if (w.precip > 0) v = 10 / (1 + 0.15 * w.precip);
    v *= Math.exp(-4.5 * Math.min(1, w.fog));
    return Math.max(0.05, v);
  }

  feelsLikeF() {
    const T = cToF(this.wx.tempC), V = this.wx.windMs * MPH;
    if (T <= 50 && V > 3) return 35.74 + 0.6215 * T - 35.75 * V ** 0.16 + 0.4275 * T * V ** 0.16;
    if (T >= 80) {
      const RH = this.rh();
      return -42.379 + 2.04901523 * T + 10.14333127 * RH - 0.22475541 * T * RH - 6.83783e-3 * T * T - 5.481717e-2 * RH * RH
        + 1.22874e-3 * T * T * RH + 8.5282e-4 * T * RH * RH - 1.99e-6 * T * T * RH * RH;
    }
    return T;
  }
  rh() {
    const { tempC: T, dewC: D } = this.wx;
    return 100 * Math.exp((17.625 * D) / (243.04 + D)) / Math.exp((17.625 * T) / (243.04 + T));
  }

  computeAlerts() {
    const w = this.wx, A = [], gust = w.gustMs * MPH, camp = this.campus;
    const month = new Date(this.t).getUTCMonth() + 1;
    const fb = this.gaugeFt(3);
    if (this.riseM(1) > 2.6 && w.precip > 15) A.push({ level: 'extreme', text: 'Flash Flood Emergency' });
    else if (this.riseM(0) > 0.9 || this.riseM(1) > 1.4) A.push({ level: 'warning', text: 'Flash Flood Warning' });
    if (fb >= 9) A.push({ level: fb >= 16 ? 'extreme' : 'warning', text: `River Flood Warning — French Broad ${fb >= 16 ? '(major)' : ''}` });
    if (month >= 6 && month <= 11 && gust >= 39 && w.windMs * MPH >= 25 && w.precip > 5 && w.tempC > 15) A.push({ level: 'warning', text: 'Tropical Storm Warning' });
    else if (gust >= 58) A.push({ level: 'warning', text: 'High Wind Warning' });
    else if (gust >= 45) A.push({ level: 'advisory', text: 'Wind Advisory' });
    if (w.thunder > 0.4 && gust >= 50 && w.tempC > 10) A.push({ level: 'warning', text: 'Severe Thunderstorm Warning' });
    if (this.iceMm[this.refBand] >= 6 || (this.ptype === 'fzra' && w.precip > 2)) A.push({ level: 'warning', text: 'Ice Storm Warning' });
    else if (this.bandType.includes('fzra')) A.push({ level: 'advisory', text: 'Freezing Rain Advisory' });
    if ((this.ptype === 'snow' || this.ptype === 'sleet') && (this.snowfallCm > 10 || w.precip > 2.5)) A.push({ level: 'warning', text: gust > 35 ? 'Blizzard Warning' : 'Winter Storm Warning' });
    else if (this.bandType.includes('snow') || this.bandType.includes('sleet')) A.push({ level: 'advisory', text: 'Winter Weather Advisory' });
    if (w.fog > 0.65) A.push({ level: 'advisory', text: 'Dense Fog Advisory' });
    if (this.soil > 0.9 && w.precip > 6) A.push({ level: 'warning', text: 'Landslide threat — steep slopes' });
    const fl = this.feelsLikeF();
    if (fl <= 0) A.push({ level: 'advisory', text: 'Cold Weather Advisory' });
    if (fl >= 100) A.push({ level: 'advisory', text: 'Heat Advisory' });
    if (this.roadIce > 0.6 && camp.tempC < 0 && w.precip < 0.05) A.push({ level: 'advisory', text: 'Black ice on area roads' });
    return A;
  }

  /** At 5:30 AM on school days, the "head of school" decides: open, delay or close. */
  checkSchoolDecision() {
    const prev = this.lastT, cur = this.t;
    const dayStart = Date.UTC(new Date(cur).getUTCFullYear(), new Date(cur).getUTCMonth(), new Date(cur).getUTCDate());
    const decisionT = dayStart + 5.5 * HOUR;
    if (!(prev < decisionT && cur >= decisionT)) return;
    const key = new Date(dayStart).toISOString().slice(0, 10);
    if (!isSchoolDay(cur)) { this.decisions.set(key, { t: decisionT, status: 'weekend', reasons: ['Weekend'] }); return; }
    const c = this.campus, r = this.roads, w = this.wx, reasons = [];
    let status = 'open';
    const close = (why) => { status = 'closed'; reasons.push(why); };
    const delay = (why) => { if (status === 'open') status = 'delay'; reasons.push(why); };
    if (c.snowCm >= 5) close(`${(c.snowCm / 2.54).toFixed(1)}" of snow on campus`);
    else if (c.snowCm >= 0.8) delay('Light snow cover on campus');
    if (this.iceMm[this.refBand] >= 1.5) close('Ice-covered trees, lines and walkways');
    if (r && r.impassablePct >= 12) close(`${r.impassablePct.toFixed(0)}% of nearby roads impassable`);
    else if (r && r.impassablePct >= 4) delay(`${r.impassablePct.toFixed(0)}% of nearby roads impassable`);
    if (r && r.snowPct > 40 && c.snowCm < 5) delay('Snow-covered secondary roads');
    if (this.roadIce > 0.6 && c.tempC < 0.5) delay('Black ice likely on roads');
    if (this.powerOut > 0.35) close(`${(this.powerOut * 100).toFixed(0)}% of the area without power`);
    if (w.gustMs * MPH >= 50) close('Dangerous wind gusts');
    if (this.visibilityMi() < 0.3) delay('Dense fog');
    if (this.gaugeFt(3) >= 12 || this.riseM(1) > 1.6) close('Flooding on area roads and rivers');
    // In scenarios the storm's future is known, so leaders can act on the forecast (as they did before Helene).
    const fc = this.forecast(20);
    if (fc) {
      if (fc.maxGustMph >= 50) close(`Forecast: damaging gusts to ${Math.round(fc.maxGustMph)} mph today`);
      if (fc.maxRainIn >= 0.5) close(`Forecast: torrential rain (${fc.maxRainIn.toFixed(1)}"/hr) and flooding`);
      if (fc.snowIn >= 2 && c.snowCm < 5) close(`Forecast: ${fc.snowIn.toFixed(0)}"+ of snow during the school day`);
      if (fc.fzra && this.iceMm[this.refBand] < 1.5) close('Forecast: freezing rain during the school day');
    }
    if (status === 'closed' && reasons.length === 0) reasons.push('Hazardous conditions');
    if (status === 'open') reasons.push('Conditions safe for travel');
    const d = { t: decisionT, status, reasons };
    this.decisions.set(key, d);
    this.emit('decision', d);
  }
}
