// Traffic volume through the day and simulated crash risk on area roads.
const WEEKDAY = [0.05, 0.03, 0.03, 0.04, 0.08, 0.22, 0.55, 0.95, 1.0, 0.65, 0.55, 0.6, 0.65, 0.62, 0.66, 0.85, 0.98, 0.95, 0.7, 0.48, 0.36, 0.26, 0.16, 0.09];
const WEEKEND = [0.08, 0.05, 0.04, 0.03, 0.04, 0.08, 0.15, 0.25, 0.38, 0.5, 0.6, 0.66, 0.68, 0.66, 0.64, 0.62, 0.6, 0.55, 0.48, 0.4, 0.33, 0.25, 0.17, 0.11];

/** 0..1 share of peak-hour traffic for a local time, before weather. */
export function trafficProfile(t) {
  const d = new Date(t), h = d.getUTCHours() + d.getUTCMinutes() / 60, dow = d.getUTCDay();
  const P = dow === 0 || dow === 6 ? WEEKEND : WEEKDAY;
  const i = Math.floor(h), f = h - i;
  return P[i] * (1 - f) + P[(i + 1) % 24] * f;
}

/** Is school carpool happening right now? Returns 0..1 intensity. */
export function carpool(t, status) {
  if (status === 'closed' || status === 'weekend' || !status) return 0;
  const d = new Date(t), h = d.getUTCHours() + d.getUTCMinutes() / 60;
  const shift = status === 'delay' ? 2 : 0;
  const bump = (c, w) => Math.max(0, 1 - Math.abs(h - c) / w);
  return Math.max(bump(7.75 + shift, 0.5), bump(15.25, 0.4));
}

/**
 * Weather reduces how many people drive and multiplies crash risk.
 * Base rate: roughly 6 crashes a day on roads within 5 miles of campus in normal conditions (an estimate).
 */
export function roadRisk(sim) {
  const r = sim.roads, w = sim.wx;
  let mult = 1, why = [];
  const add = (m, label) => { mult *= m; why.push(label); };
  if (r) {
    const winter = Math.max(14 * Math.min(1, r.icyPct / 40), 5 * Math.min(1, r.snowPct / 40));
    if (winter > 0.2) add(1 + winter, r.icyPct > r.snowPct / 2 ? 'ice' : 'snow');
    if (r.signalsOut) add(1.25, 'dark signals');
    if (r.lowVis) add(1.8, 'low visibility');
  }
  if (w.precip > 0.3 && sim.ptype === 'rain') add(1 + Math.min(1.2, w.precip / 10), 'wet roads');
  // people stay home when it's bad or school is closed
  const severity = r ? Math.min(1, (r.impassablePct * 3 + r.icyPct + r.snowPct) / 60) : 0;
  const volume = trafficProfile(sim.t) * (1 - 0.85 * severity);
  return { mult: Math.min(mult, 20), why, volume };
}
