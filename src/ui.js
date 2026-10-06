// DOM panels: controls on the left, conditions & impacts on the right, a 5-day chart along the bottom.
import { SCENARIOS } from './sim/scenarios.js';
import { cToF, fToC } from './sim/climate.js';
import { fmt, fmtShort, HOUR } from './sim/clock.js';
import { MPH, IN, PTYPE_LABEL, RIVER_INFO } from './sim/engine.js';

const $ = (id) => document.getElementById(id);
const kv = (k, v) => `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`;
const compass = (d) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
const ICON = { none: '', rain: '🌧', snow: '❄️', sleet: '🧊', fzra: '🧊' };

const PRESETS = {
  clear: { tempF: 68, noseAuto: true, rainInHr: 0, windMph: 4, gustMph: 8, cloud: 0.05, fog: 0, thunder: 0 },
  downpour: { tempF: 74, noseAuto: true, rainInHr: 1.5, windMph: 12, gustMph: 35, cloud: 1, fog: 0, thunder: 0.6 },
  snow: { tempF: 25, noseAuto: true, rainInHr: 0.12, windMph: 14, gustMph: 28, cloud: 1, fog: 0, thunder: 0 },
  ice: { tempF: 29, noseAuto: false, noseF: 42, rainInHr: 0.12, windMph: 6, gustMph: 12, cloud: 1, fog: 0, thunder: 0 },
  hurricane: { tempF: 72, noseAuto: true, rainInHr: 0.9, windMph: 35, gustMph: 68, cloud: 1, fog: 0, thunder: 0.15 },
  fog: { tempF: 45, noseAuto: true, rainInHr: 0, windMph: 0, gustMph: 2, cloud: 0.05, fog: 1, thunder: 0 },
};

export class UI {
  constructor(sim, app) {
    this.sim = sim; this.app = app;
    this.lastAlerts = new Set();
    this.bindTop();
    this.bindMode();
    this.bindManual();
    this.bindLayers();
    this.chart = $('chart');
    window.addEventListener('resize', () => this.drawChart());
  }

  toast(msg, color) {
    const d = document.createElement('div');
    d.className = 'toast'; d.textContent = msg;
    if (color) d.style.borderLeftColor = color;
    $('toasts').appendChild(d);
    setTimeout(() => d.remove(), 5000);
    const max = window.innerWidth < 900 ? 2 : 4;
    while ($('toasts').children.length > max) $('toasts').firstChild.remove();
  }

  bindTop() {
    $('btn-play').onclick = () => this.app.togglePlay();
    $('speed').onchange = (e) => { this.app.speed = parseFloat(e.target.value); };
    $('jump').onchange = (e) => {
      if (!e.target.value) return;
      const [d, t] = e.target.value.split('T'); const [y, mo, da] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number);
      if (this.sim.mode === 'scenario') this.setMode('auto');
      this.sim.reset(Date.UTC(y, mo - 1, da, h, mi));
    };
    $('btn-now').onclick = () => { if (this.sim.mode === 'scenario') this.setMode('auto'); this.app.jumpToNow(); };
    $('btn-reset').onclick = () => this.sim.reset(this.sim.t, { soil: this.sim.soil });
    for (const b of document.querySelectorAll('.panel-close')) b.onclick = () => b.closest('.panel').classList.remove('open');
    for (const side of ['left', 'right']) {
      $('toggle-' + side).onclick = () => {
        const other = side === 'left' ? 'right' : 'left';
        $(other).classList.remove('open');
        $(side).classList.toggle('open');
      };
    }
  }

  bindMode() {
    for (const b of $('mode-seg').querySelectorAll('button')) b.onclick = () => this.setMode(b.dataset.mode);
    $('scenario-list').innerHTML = SCENARIOS.map((s) => `<div class="scenario" data-id="${s.id}"><b>${s.name}</b><span class="muted">${s.short}</span><p hidden>${s.summary}</p></div>`).join('');
    for (const el of $('scenario-list').querySelectorAll('.scenario')) el.onclick = () => this.loadScenario(el.dataset.id);
  }

  setMode(mode) {
    for (const b of $('mode-seg').querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === mode);
    $('scenario-box').hidden = mode !== 'scenario';
    $('manual-box').hidden = mode !== 'manual';
    const hints = {
      auto: 'Weather is generated from Asheville\'s real climate normals for the date: fronts, showers, summer storms, valley fog and the occasional winter storm.',
      manual: 'You control the weather. Try a cold surface with a warm layer aloft to make freezing rain, or crank the rain and watch the creeks, then the rivers, respond.',
      scenario: 'Pick an event to replay. Time jumps to the start of the storm, and impacts build up as it plays.',
    };
    $('mode-hint').textContent = hints[mode];
    if (mode === 'manual') {
      const w = this.sim.wx, m = this.sim.manual;
      Object.assign(m, { tempF: Math.round(cToF(w.tempC)), rainInHr: +(w.precip / IN).toFixed(2), windMph: Math.round(w.windMs * MPH), gustMph: Math.round(w.gustMs * MPH), cloud: +w.cloud.toFixed(2), fog: +w.fog.toFixed(2), thunder: +w.thunder.toFixed(2), noseF: Math.round(cToF(w.warmNose)) });
      this.syncManual();
    }
    if (mode !== 'scenario') { this.sim.setMode(mode); for (const el of document.querySelectorAll('.scenario')) el.classList.remove('on'); }
  }

  loadScenario(id) {
    for (const b of $('mode-seg').querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === 'scenario');
    $('scenario-box').hidden = false; $('manual-box').hidden = true;
    for (const el of document.querySelectorAll('.scenario')) { el.classList.toggle('on', el.dataset.id === id); el.querySelector('p').hidden = el.dataset.id !== id; }
    this.sim.setMode('scenario', id);
    const s = SCENARIOS.find((x) => x.id === id);
    this.toast(`Scenario loaded: ${s.name}`, '#f2b632');
    if (id === 'fallfog') this.app.flyTo('overview');
    else if (id === 'helene') this.app.flyTo('biltmore');
    else this.app.flyTo('campus');
    this.app.play(true);
  }

  bindManual() {
    const m = this.sim.manual;
    const map = { tempF: 'm-tempF', noseF: 'm-noseF', rainInHr: 'm-rain', windMph: 'm-wind', gustMph: 'm-gust', cloud: 'm-cloud', fog: 'm-fog', thunder: 'm-thunder' };
    for (const [k, id] of Object.entries(map)) $(id).oninput = (e) => { m[k] = parseFloat(e.target.value); this.syncManual(); };
    $('m-noseAuto').onchange = (e) => { m.noseAuto = e.target.checked; this.syncManual(); };
    for (const b of document.querySelectorAll('[data-preset]')) b.onclick = () => { Object.assign(m, PRESETS[b.dataset.preset]); this.syncManual(); };
    this.manualMap = map;
  }
  syncManual() {
    const m = this.sim.manual;
    for (const [k, id] of Object.entries(this.manualMap)) $(id).value = m[k];
    $('m-noseAuto').checked = m.noseAuto;
    $('m-noseF').disabled = m.noseAuto;
    $('v-tempF').textContent = `${m.tempF}°F`;
    $('v-noseF').textContent = m.noseAuto ? 'auto' : `${m.noseF}°F`;
    $('v-rain').textContent = `${m.rainInHr.toFixed(2)} in/hr`;
    $('v-wind').textContent = `${m.windMph} mph`;
    $('v-gust').textContent = `${m.gustMph} mph`;
    $('v-cloud').textContent = `${Math.round(m.cloud * 100)}%`;
    $('v-fog').textContent = `${Math.round(m.fog * 100)}%`;
    $('v-thunder').textContent = `${Math.round(m.thunder * 100)}%`;
  }

  bindLayers() {
    const L = this.app.layers;
    for (const [id, key] of [['t-labels', 'labels'], ['t-ring', 'ring'], ['t-roads', 'roads'], ['t-roadstatus', 'roadStatus'], ['t-trees', 'trees'], ['t-clouds', 'clouds'], ['t-precip', 'precip']]) {
      $(id).onchange = (e) => { L[key] = e.target.checked; if (key === 'roadStatus') $('road-legend').hidden = !e.target.checked; };
    }
    $('cam-presets').innerHTML = this.app.cameraPresets.map((p) => `<button data-cam="${p.id}">${p.label}</button>`).join('');
    for (const b of $('cam-presets').querySelectorAll('button')) b.onclick = () => this.app.flyTo(b.dataset.cam);
  }

  setPlaying(p) { $('btn-play').textContent = p ? '⏸' : '▶'; }
  setOSMStatus(t) { $('osm-status').textContent = t; }

  update() {
    const s = this.sim, w = s.wx, c = s.campus;
    $('clock-text').textContent = fmt(s.t);
    const sunTxt = s.sun.elevation > 0 ? `Sun ${s.sun.elevation.toFixed(0)}° up` : 'Night';
    $('clock-sub').textContent = `${s.mode === 'scenario' ? s.scenario.name : s.mode === 'manual' ? 'Manual weather' : 'Live climate · ' + (w.label || '')} · ${sunTxt}`;

    // conditions
    $('now-temp').textContent = `${Math.round(cToF(c.tempC))}°`;
    const pt = s.ptype;
    const heavy = w.precip > (pt === 'rain' ? 7.6 : 2.5) ? 'Heavy ' : w.precip < (pt === 'rain' ? 1 : 0.3) ? 'Light ' : '';
    $('now-type').textContent = pt === 'none' ? (w.fog > 0.5 ? '🌫 Fog' : w.cloud > 0.8 ? '☁️ Overcast' : w.cloud > 0.35 ? '⛅ Partly cloudy' : s.sun.elevation > 0 ? '☀️ Clear' : '🌙 Clear') + (w.thunder > 0.1 ? ' · ⚡' : '')
      : `${ICON[pt]} ${heavy}${PTYPE_LABEL[pt].toLowerCase()}${w.thunder > 0.1 ? ' · ⚡ thunder' : ''}`;
    $('now-label').textContent = `Feels like ${Math.round(s.feelsLikeF())}° · at campus (~2,130 ft)`;
    $('now-grid').innerHTML = [
      kv('Wind', `${compass(w.windDir)} ${Math.round(w.windMs * MPH)} mph`),
      kv('Gusts', `${Math.round(w.gustMs * MPH)} mph`),
      kv('Precip rate', `${(w.precip / IN).toFixed(2)} in/hr`),
      kv('Visibility', `${s.visibilityMi() < 1 ? s.visibilityMi().toFixed(2) : s.visibilityMi().toFixed(0)} mi`),
      kv('Humidity', `${Math.round(s.rh())}%`),
      kv('Cloud cover', `${Math.round(w.cloud * 100)}%`),
      kv('Ridge temp (4,000 ft)', `${Math.round(cToF(s.bandT[7]))}°F`),
      kv('Valley temp (2,000 ft)', `${Math.round(cToF(s.bandT[0]))}°F`),
    ].join('');

    // alerts
    $('alerts').innerHTML = s.alerts.length ? s.alerts.map((a) => `<div class="alert ${a.level}">${a.text}</div>`).join('') : '<div class="muted">No active alerts</div>';
    const now = new Set(s.alerts.map((a) => a.text));
    for (const a of s.alerts) if (!this.lastAlerts.has(a.text) && a.level !== 'advisory') this.toast(`⚠️ ${a.text}`, a.level === 'extreme' ? '#ff3d6e' : '#ff8a3d');
    this.lastAlerts = now;

    // school
    const decs = [...s.decisions.entries()].sort((a, b) => b[1].t - a[1].t);
    const lab = { open: 'Open — normal schedule', delay: '2-hour delay', closed: 'Closed', weekend: 'No school (weekend)' };
    if (decs.length) {
      const [day, d] = decs[0];
      $('school').innerHTML = `<div class="status ${d.status}">${lab[d.status]}</div><div class="muted small" style="margin-top:4px">Decision at 5:30 AM, ${fmtShort(d.t).replace(/ \d+a$/, '')}</div>`
        + (d.status !== 'weekend' ? `<ul class="reasons">${d.reasons.map((r) => `<li>${r}</li>`).join('')}</ul>` : '')
        + `<div class="hist">${decs.slice(1, 6).map(([k, x]) => `${k.slice(5)}: ${lab[x.status].split(' —')[0]}`).join(' · ')}</div>`;
    } else $('school').innerHTML = '<div class="muted">The next decision is made at 5:30 AM. Run the clock to see it.</div>';

    // accumulations
    const ridge = 7;
    $('accum').innerHTML = [
      kv('Rain total', `${(s.rainTotalMm / IN).toFixed(2)} in`),
      kv('Snowfall', `${(s.snowfallCm / 2.54).toFixed(1)} in`),
      kv('Snow depth · campus', `${(c.snowCm / 2.54).toFixed(1)} in`),
      kv('Snow depth · ridges', `${(s.snowCm[ridge] / 2.54).toFixed(1)} in`),
      kv('Ice · campus', `${(c.iceMm / IN).toFixed(2)} in`),
      kv('Ice · ridges', `${(s.iceMm[ridge] / IN).toFixed(2)} in`),
    ].join('');
    $('soil-v').textContent = `${Math.round(s.soil * 100)}%`;
    $('soil-bar').style.width = `${s.soil * 100}%`;

    // rivers
    const g = (name, ft, max, ticks, meta) => {
      const flood = ticks.length && ft >= ticks[0].v;
      return `<div class="gauge ${flood ? 'flood' : ''}"><div class="bar-label">${name}<span>${ft.toFixed(1)} ft</span></div>
        <div class="bar"><div style="width:${Math.min(100, (ft / max) * 100)}%"></div>${ticks.map((t) => `<div class="tick ${t.rec ? 'rec' : ''}" title="${t.t}" style="left:${(t.v / max) * 100}%"></div>`).join('')}</div>
        <div class="meta">${meta}</div></div>`;
    };
    $('rivers').innerHTML =
      g('French Broad at Asheville', s.gaugeFt(3), 28, [{ v: 9, t: 'Flood stage (approx.)' }, { v: 24.67, t: 'Helene 2024 record', rec: true }],
        `Flood stage ≈ 9 ft · Helene crest 24.67 ft · peak this run ${s.peak.fb.toFixed(1)} ft`) +
      g('Swannanoa at Biltmore', s.gaugeFt(2), 28, [{ v: 10, t: 'Flood stage (approx.)' }, { v: 26.1, t: 'Helene 2024 crest (approx.)', rec: true }],
        `Helene crest ≈ 26 ft · peak this run ${s.peak.sw.toFixed(1)} ft`) +
      g('Small creeks (rise)', s.riseM(0) * 3.281, 12, [{ v: 3, t: 'Flash flooding' }], 'Rise above normal; creeks respond within minutes') +
      g('Larger streams (rise)', s.riseM(1) * 3.281, 18, [{ v: 4.6, t: 'Flooding' }], 'Rise above normal; respond within a few hours');

    // impacts
    const r = s.roads;
    $('impacts').innerHTML = [
      kv('Trees down', `${(s.treesDownFrac * 100).toFixed(1)}%`),
      kv('Power outages', `${Math.round(s.powerOut * 100)}% of customers`),
      kv('Landslides', `${s.landslides.length}`),
      kv('Peak gust', `${Math.round(s.maxGustMph)} mph`),
      kv('Roads impassable', r ? `${r.impassablePct.toFixed(1)}%` : '—'),
      kv('Roads flooded', r ? `${r.floodedPct.toFixed(1)}%` : '—'),
      kv('Blocked (trees/slides)', r ? `${r.blockedPct.toFixed(1)}%` : '—'),
      kv('Snowy / icy', r ? `${r.snowPct.toFixed(0)}% / ${r.icyPct.toFixed(0)}%` : '—'),
    ].join('');
    $('closures').innerHTML = r && r.closures.length ? `Closures: ${r.closures.join(', ')}` : '';

    // narrative
    const n = $('narrative');
    if (s.mode === 'scenario' && s.note) { n.hidden = false; n.textContent = s.note; } else n.hidden = true;
    this.drawChart();
  }

  drawChart() {
    const cv = this.chart, dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const hist = this.sim.history;
    const t1 = this.sim.t, t0 = t1 - 72 * HOUR;
    const L = 44, R = W - 44, T = 22, B = H - 18;
    const x = (t) => L + ((t - t0) / (t1 - t0)) * (R - L);
    ctx.font = '10.5px system-ui, sans-serif';
    ctx.fillStyle = '#9aa7b6';
    ctx.fillText('Last 72 hours', L, 13);
    // legend
    const leg = [['Temp °F', '#f2b632'], ['Precip in/hr', '#58b4ff'], ['French Broad ft', '#ff7095'], ['Snow depth in', '#ffffff']];
    let lx = L + 90;
    for (const [t, c] of leg) { ctx.fillStyle = c; ctx.fillRect(lx, 6, 10, 3); ctx.fillStyle = '#9aa7b6'; ctx.fillText(t, lx + 14, 13); lx += ctx.measureText(t).width + 30; }
    // day lines
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.fillStyle = '#6d7a89';
    for (let t = Math.ceil(t0 / (24 * HOUR)) * 24 * HOUR; t <= t1; t += 6 * HOUR) {
      const h = new Date(t).getUTCHours();
      ctx.beginPath(); ctx.moveTo(x(t), T); ctx.lineTo(x(t), B); ctx.lineWidth = h === 0 ? 1 : 0.4; ctx.stroke();
      if (h === 0 || h === 12) ctx.fillText(h === 0 ? fmtShort(t).replace(/ \d+a$/, '') : 'noon', x(t) + 3, B + 12);
    }
    const pts = hist.filter((p) => p.t >= t0);
    if (!pts.length) return;
    const tmin = Math.min(...pts.map((p) => p.tempF)) - 3, tmax = Math.max(...pts.map((p) => p.tempF)) + 3;
    const yT = (v) => B - ((v - tmin) / (tmax - tmin || 1)) * (B - T);
    const pmax = Math.max(0.25, ...pts.map((p) => p.rainIn));
    const fbmax = Math.max(12, ...pts.map((p) => p.fb)) * 1.05;
    // precip bars
    ctx.fillStyle = 'rgba(88,180,255,.55)';
    const bw = Math.max(1, (R - L) / 144 - 0.5);
    for (const p of pts) { const h = (p.rainIn / pmax) * (B - T); ctx.fillRect(x(p.t) - bw / 2, B - h, bw, h); }
    const line = (f, color, wdt = 1.6) => { ctx.strokeStyle = color; ctx.lineWidth = wdt; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x(p.t), f(p))); ctx.stroke(); };
    line((p) => B - (p.snowIn / Math.max(6, ...pts.map((q) => q.snowIn))) * (B - T), 'rgba(255,255,255,.8)', 1.2);
    line((p) => B - (p.fb / fbmax) * (B - T), '#ff7095');
    line((p) => yT(p.tempF), '#f2b632', 2);
    // axes labels
    ctx.fillStyle = '#f2b632'; ctx.fillText(`${Math.round(tmax)}°`, 8, T + 8); ctx.fillText(`${Math.round(tmin)}°`, 8, B);
    ctx.fillStyle = '#ff7095'; ctx.fillText(`${fbmax.toFixed(0)} ft`, R + 6, T + 8);
    ctx.fillStyle = '#58b4ff'; ctx.fillText(`${pmax.toFixed(2)}"`, R + 6, T + 22);
  }
}
