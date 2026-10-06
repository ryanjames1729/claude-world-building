// Asheville climate normals (approx. 1991–2020, Asheville Regional Airport) and an
// automatic weather generator that produces realistic sequences of weather "regimes".
import { dayOfYear, hourOfDay, sunPosition } from './clock.js';

// Monthly mean high / low (°F) and precipitation (in)
export const NORMALS = [
  { hi: 48, lo: 28, pr: 3.5 }, { hi: 52, lo: 30, pr: 3.4 }, { hi: 60, lo: 36, pr: 3.9 },
  { hi: 69, lo: 43, pr: 3.7 }, { hi: 76, lo: 52, pr: 3.8 }, { hi: 82, lo: 60, pr: 4.5 },
  { hi: 85, lo: 64, pr: 4.0 }, { hi: 84, lo: 63, pr: 4.3 }, { hi: 78, lo: 56, pr: 3.7 },
  { hi: 69, lo: 45, pr: 3.0 }, { hi: 59, lo: 35, pr: 3.4 }, { hi: 50, lo: 30, pr: 3.6 },
];
export const fToC = (f) => (f - 32) * 5 / 9;
export const cToF = (c) => c * 9 / 5 + 32;

/** Smoothly interpolated normal high/low (°C) for a day of year. */
export function normalsFor(doy) {
  const m = ((doy - 15.5) / 30.44 + 12) % 12;
  const i = Math.floor(m), f = m - i, a = NORMALS[i], b = NORMALS[(i + 1) % 12];
  return { hi: fToC(a.hi + (b.hi - a.hi) * f), lo: fToC(a.lo + (b.lo - a.lo) * f) };
}

/** Diurnal temperature curve: low near sunrise, high mid-afternoon. */
export function diurnal(hour) {
  const h = (hour - 6.5 + 24) % 24; // 0 at ~sunrise
  if (h < 8.5) return Math.sin((h / 8.5) * Math.PI / 2) ** 1.2;           // warm until ~3pm
  return 0.5 + 0.5 * Math.cos(((h - 8.5) / 15.5) * Math.PI);              // cool overnight
}

// Weather regimes the generator moves between.
export const REGIMES = {
  clear:     { label: 'Clear',            cloud: 0.05, precip: 0,    wind: 2.5, gust: 1.6, anom: 1.5, range: 1.0 },
  partly:    { label: 'Partly cloudy',    cloud: 0.4,  precip: 0,    wind: 3.5, gust: 1.7, anom: 0.5, range: 0.9 },
  overcast:  { label: 'Overcast',         cloud: 0.95, precip: 0,    wind: 3,   gust: 1.6, anom: -1,  range: 0.45 },
  showers:   { label: 'Showers',          cloud: 0.8,  precip: 0.9,  wind: 4,   gust: 2.0, anom: -1,  range: 0.6, intermittent: true },
  rain:      { label: 'Steady rain',      cloud: 1.0,  precip: 1.7,  wind: 4.5, gust: 1.8, anom: -3,  range: 0.3 },
  tstorm:    { label: 'Thunderstorms',    cloud: 0.85, precip: 7,    wind: 4,   gust: 3.5, anom: 0,   range: 0.8, intermittent: true, thunder: 1 },
  windy:     { label: 'Windy (front)',    cloud: 0.5,  precip: 0.2,  wind: 9,   gust: 1.8, anom: -4,  range: 0.8 },
  snow:      { label: 'Snow',             cloud: 1.0,  precip: 1.0,  wind: 4,   gust: 1.9, forceTemp: -3, range: 0.2 },
  ice:       { label: 'Freezing rain',    cloud: 1.0,  precip: 1.1,  wind: 3,   gust: 1.7, forceTemp: -1.5, warmNose: 4, range: 0.15 },
};

function regimeWeights(doy, hour, tempAnom) {
  const month = Math.floor(((doy - 1) / 30.44)) % 12;      // 0..11
  const warm = Math.max(0, Math.cos(((doy - 200) / 365) * 2 * Math.PI)); // peaks mid-July
  const cold = Math.max(0, Math.cos(((doy - 20) / 365) * 2 * Math.PI));  // peaks mid-Jan
  const fall = month >= 8 && month <= 10;
  return {
    clear: 3 + (fall ? 2 : 0),
    partly: 3.5 + warm,
    overcast: 2 + cold,
    showers: 1.1 + warm,
    rain: 1.1,
    tstorm: warm * warm * 3 * (hour > 11 && hour < 20 ? 1.6 : 0.5),
    windy: 0.8 + cold,
    snow: cold ** 3 * (tempAnom < 0 ? 0.35 : 0.12),
    ice: cold ** 4 * 0.1,
  };
}

const DURATION_H = { clear: [12, 48], partly: [8, 36], overcast: [8, 24], showers: [4, 12], rain: [6, 18],
  tstorm: [2, 5], windy: [8, 20], snow: [8, 20], ice: [6, 16] };

export class ClimateGenerator {
  constructor(rng) { this.rng = rng; this.regime = 'partly'; this.until = 0; this.anom = 0; this.cell = 0; }
  pick(t) {
    const doy = dayOfYear(t), hour = hourOfDay(t);
    const w = regimeWeights(doy, hour, this.anom);
    delete w[this.regime];
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    let r = this.rng() * total;
    for (const [k, v] of Object.entries(w)) { r -= v; if (r <= 0) { this.regime = k; break; } }
    const [a, b] = DURATION_H[this.regime];
    this.until = t + (a + (b - a) * this.rng()) * 3600e3;
  }
  /** Target weather for time t; dtH used for the random walks. */
  target(t, dtH) {
    if (t >= this.until || !this.until || this.until - t > 3 * 86400e3) this.pick(t);
    const R = REGIMES[this.regime];
    // temperature anomaly random walk (AR1), ~ ±4 °C typical
    this.anom += (-this.anom / 72 + (this.rng() - 0.5) * 0.9) * dtH;
    const doy = dayOfYear(t), hour = hourOfDay(t);
    const nm = normalsFor(doy);
    const mid = (nm.hi + nm.lo) / 2, amp = (nm.hi - nm.lo) / 2 * R.range;
    let temp = mid - amp + 2 * amp * diurnal(hour) + this.anom + (R.anom || 0);
    if (R.forceTemp != null) temp = Math.min(temp, R.forceTemp + (this.rng() - 0.5));
    // intermittent convective cells
    let precip = R.precip;
    if (R.intermittent) {
      this.cell += (this.rng() - 0.5) * dtH * 2.5;
      this.cell = Math.max(-1, Math.min(1, this.cell));
      precip *= Math.max(0, this.cell + 0.1) * 1.4;
      if (this.regime === 'tstorm' && (hour < 12 || hour > 21)) precip *= 0.3;
    }
    const sun = sunPosition(t);
    const calm = R.wind < 4 && sun.elevation < 8;
    // Radiation valley fog: clear/partly, calm, late night to mid-morning, more common late summer/fall.
    const fogSeason = 0.5 + 0.5 * Math.cos(((doy - 270) / 365) * 2 * Math.PI);
    const fog = (this.regime === 'clear' || this.regime === 'partly') && (hour < 10.5 || hour > 23)
      ? Math.min(1, fogSeason * (calm || hour < 10.5 ? 1 : 0) * (hour < 10.5 ? Math.min(1, (10.5 - hour) / 3) : 0.5))
      : this.regime === 'rain' || this.regime === 'overcast' ? 0.15 : 0;
    return {
      regime: this.regime,
      label: R.label,
      tempC: temp,
      dewDep: precip > 0 ? 0.5 : this.regime === 'clear' ? 8 : 4,
      cloud: R.cloud,
      precip, // mm/h liquid equivalent
      windMs: R.wind,
      gustMs: R.wind * R.gust,
      windDir: this.regime === 'windy' ? 300 : this.regime === 'ice' || this.regime === 'snow' ? 40 : 220,
      warmNose: R.warmNose ?? (temp > 0 ? temp - 2 : temp - 3),
      thunder: R.thunder ? Math.min(1, precip / 10) : 0,
      fog,
      coverage: this.regime === 'tstorm' ? 0.2 : this.regime === 'showers' ? 0.45 : 1,
    };
  }
}
