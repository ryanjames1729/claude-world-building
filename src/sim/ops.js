// Campus operations under hazardous weather: utility power & generators, network/internet, phones & cell,
// and road safety for the routes families drive. Pure JavaScript (tested in Node).
import { CAMPUS_OPS } from '../data/campus-ops.js';
import { BUILDINGS } from '../data/campus.js';
import { bandAt } from './engine.js';

const MPH = 2.23694, IN = 25.4;

export const LEVEL = { ok: 0, watch: 1, critical: 2 };

export class CampusOps {
  constructor(rng, cfg = CAMPUS_OPS) {
    this.rng = rng;
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    const c = this.cfg;
    this.utilityOn = true;
    this.utilityOffH = 0;
    this.areaOutageH = 0;         // how long the surrounding area has had widespread outages
    this.fuel = Object.fromEntries(c.power.generators.map((g) => [g.building, g.hours]));
    this.upsMin = c.it.upsMinutes;
    this.circuits = c.it.circuits.map((x) => ({ ...x, up: true, downH: 0 }));
    this.lastTrees = 0;
    this.lastSlides = 0;
    this.history = { utilityOffMaxH: 0, internetDownH: 0 };
    this.buildings = {};
    this.compute(null);
  }

  step(sim, dtH) {
    const c = this.cfg, w = sim.wx, rng = this.rng;
    const gust = w.gustMs * MPH;
    const iceIn = bandAt(sim.iceMm, 760) / IN; // ice on lines & trees around campus and nearby ridges
    const treeDelta = Math.max(0, sim.treesDownFrac - this.lastTrees);
    const newSlides = sim.landslides.length - this.lastSlides;
    this.lastTrees = sim.treesDownFrac; this.lastSlides = sim.landslides.length;
    const calm = gust < 30 && iceIn < 0.1 && w.precip < 5;
    const roadsOpen = !sim.roads || sim.roads.impassablePct < 8;

    // ---- area outage clock (drives provider equipment & cell towers running out of battery)
    if (sim.powerOut > 0.3) this.areaOutageH += dtH; else this.areaOutageH = Math.max(0, this.areaOutageH - dtH * 3);

    // ---- utility feed to campus
    if (this.utilityOn) {
      const hazard = (sim.powerOut ** 1.4 * 2.5 + treeDelta * 60 + Math.max(0, gust - 45) * 0.01) * c.power.feedExposure;
      if (rng() < 1 - Math.exp(-hazard * dtH)) { this.utilityOn = false; this.utilityOffH = 0; }
    } else {
      this.utilityOffH += dtH;
      this.history.utilityOffMaxH = Math.max(this.history.utilityOffMaxH, this.utilityOffH);
      // crews restore campus once the area outage is mostly over and it's safe to work
      const restore = calm && sim.powerOut < 0.3 && this.utilityOffH > 1 ? (sim.powerOut < 0.1 ? 0.5 : 0.12) : 0;
      if (rng() < 1 - Math.exp(-restore * dtH)) this.utilityOn = true;
    }

    // ---- generators burn fuel when the utility is off; fuel trucks come when roads are open
    for (const g of c.power.generators) {
      if (!this.utilityOn) this.fuel[g.building] = Math.max(0, this.fuel[g.building] - dtH);
      else if (c.power.refuelWhenRoadsOpen && roadsOpen) this.fuel[g.building] = Math.min(g.hours, this.fuel[g.building] + dtH * 4);
      if (!this.utilityOn && c.power.refuelWhenRoadsOpen && roadsOpen && this.fuel[g.building] < g.hours * 0.25 && rng() < dtH * 0.08) this.fuel[g.building] = g.hours;
    }

    // ---- internet circuits: aerial lines fail with falling trees, ice and wind; underground with floods & slides
    for (const ck of this.circuits) {
      if (ck.up) {
        // exposure on utility poles (fully for aerial lines, partly upstream for underground entries)
        const poles = ck.route === 'aerial' ? 1 : (ck.upstreamExposure ?? 0);
        const hz = poles * (treeDelta * 80 + Math.max(0, iceIn - 0.2) * 0.4 + Math.max(0, gust - 50) * 0.008)
          + (ck.route === 'aerial' ? 0 : Math.max(0, sim.riseM(1) - 2.5) * 0.1 + newSlides * 0.02);
        if (rng() < 1 - Math.exp(-hz * dtH)) { ck.up = false; ck.downH = 0; }
      } else {
        ck.downH += dtH;
        const repair = calm && roadsOpen ? (sim.treesDownFrac > 0.05 ? 0.012 : 0.06) * (ck.route === 'aerial' ? 1 : 0.6) : 0;
        if (rng() < 1 - Math.exp(-repair * dtH)) ck.up = true;
      }
    }
    this.compute(sim, dtH);
  }

  powered(id) {
    if (this.utilityOn) return 'utility';
    return this.fuel[id] > 0 ? 'generator' : 'none';
  }

  compute(sim, dtH = 0) {
    const c = this.cfg;
    for (const b of BUILDINGS) this.buildings[b.id] = this.powered(b.id);
    const coreBldg = this.buildings[c.it.networkCoreBuilding];
    if (coreBldg === 'none') this.upsMin = Math.max(0, this.upsMin - dtH * 60);
    else this.upsMin = Math.min(c.it.upsMinutes, this.upsMin + dtH * 30);
    this.coreUp = coreBldg !== 'none' || this.upsMin > 0;
    this.providerUp = this.areaOutageH < c.it.providerBatteryHours;
    this.circuitsUp = this.circuits.filter((k) => k.up).length;
    this.internetUp = this.coreUp && this.providerUp && this.circuitsUp > 0;
    if (!this.internetUp && sim) this.history.internetDownH += dtH;
    // PoE desk phones draw power from the network switches: no network power → no phones at all
    const ph = c.it.phones || {};
    this.phonesPowered = ph.poe ? this.coreUp : coreBldg !== 'none';
    this.phonesOutside = this.phonesPowered && (!ph.outsideCallsNeedInternet || this.internetUp);
    this.phonesUp = this.phonesOutside;
    // cell towers: battery backup for some hours, then degrade; fiber backhaul also rides on poles
    const treeHit = sim ? Math.min(1, sim.treesDownFrac * 6) : 0;
    this.cell = this.areaOutageH > 24 || treeHit > 0.6 ? 'mostly down' : this.areaOutageH > 8 || treeHit > 0.25 ? 'degraded' : 'normal';
  }

  /** Scorecards for the UI and the school decision. */
  report(sim) {
    const c = this.cfg, B = this.buildings;
    const ids = BUILDINGS.map((b) => b.id);
    const dark = ids.filter((id) => B[id] === 'none'), gen = ids.filter((id) => B[id] === 'generator');
    const name = (id) => BUILDINGS.find((b) => b.id === id).name;
    const power = { level: LEVEL.ok, title: 'Utility power on', lines: [] };
    if (!this.utilityOn) {
      power.level = dark.length ? LEVEL.critical : LEVEL.watch;
      power.title = gen.length ? `Campus on generator power · ${this.utilityOffH.toFixed(0)} h` : `Campus without power · ${this.utilityOffH.toFixed(0)} h`;
      for (const g of c.power.generators) power.lines.push(`${name(g.building)}: generator, ${this.fuel[g.building].toFixed(0)} h fuel left`);
      if (!c.power.generators.length) power.lines.push('No backup generators on campus');
      if (dark.length) power.lines.push(`${dark.length} of ${ids.length} buildings dark (no heat, lights, water pumps)`);
    } else if (sim.powerOut > 0.15) {
      power.level = LEVEL.watch;
      power.lines.push(`${Math.round(sim.powerOut * 100)}% of the area is without power; campus feed at risk`);
    }
    if (power.level === LEVEL.ok) power.lines.push(`All buildings powered${c.power.generators.length ? '' : ' · no generator backup'}`);

    const it = { level: LEVEL.ok, title: 'Network & internet normal', lines: [] };
    const nCk = this.circuits.length;
    if (!this.internetUp) {
      it.level = LEVEL.critical;
      it.title = 'Campus internet down';
      if (!this.coreUp) it.lines.push(`Network core has no power: the ${c.it.upsMinutes}-minute battery backup ran out`);
      else if (!this.providerUp) it.lines.push(`Provider equipment out after ${this.areaOutageH.toFixed(0)} h area power outage`);
      else it.lines.push(`Both providers cut (primary and backup lines damaged off campus)`);
      it.lines.push(`Cloud services (${c.it.cloudServices.join(', ').toLowerCase()}) unreachable from campus`);
    } else if (this.circuitsUp < nCk || this.upsMin < c.it.upsMinutes || B[c.it.networkCoreBuilding] !== 'utility') {
      it.level = LEVEL.watch;
      const primaryDown = this.circuits.some((k) => k.role === 'primary' && !k.up);
      it.title = this.circuitsUp < nCk ? (primaryDown ? 'Failed over to the backup ISP' : 'Backup ISP down — no redundancy')
        : B[c.it.networkCoreBuilding] === 'none' ? `Network on battery · ${Math.round(this.upsMin)} min left` : 'Network on backup power';
      if (B[c.it.networkCoreBuilding] === 'none') it.lines.push(`Network core on battery: ${Math.round(this.upsMin)} min left`);
    }
    if (!this.phonesPowered) it.lines.push('All desk phones dead: PoE phones lose power with the network');
    else if (!this.phonesOutside) it.lines.push('Desk phones on, but no outside calls (internet down)');
    else if (B[c.it.networkCoreBuilding] === 'none') it.lines.push(`Desk phones on network battery (PoE): ${Math.round(this.upsMin)} min left`);
    const wifiDark = dark.length;
    if (wifiDark && this.internetUp) it.lines.push(`Wi-Fi out in ${wifiDark} unpowered buildings`);
    if (this.cell !== 'normal') { it.lines.push(`Cell service ${this.cell} (tower batteries / backhaul)`); it.level = Math.max(it.level, this.cell === 'mostly down' ? LEVEL.critical : LEVEL.watch); }
    if (!this.phonesOutside && this.cell === 'mostly down') { it.lines.unshift('⚠ No reliable way to call 911 from campus'); it.level = LEVEL.critical; }
    else if (!this.phonesOutside) it.lines.push('Emergency calls depend on cell phones');
    if (it.level === LEVEL.ok) it.lines.push(`Primary and backup ISPs up${c.it.entry ? ` (${c.it.entry})` : ''} · PoE desk phones, Wi-Fi and cloud services working`);
    else if (this.internetUp && this.circuitsUp < nCk) it.lines.push(`${this.circuits.filter((k) => !k.up).map((k) => k.name).join(', ')} down ${Math.round(Math.max(...this.circuits.filter((k) => !k.up).map((k) => k.downH)))} h; ${this.circuits.filter((k) => k.up).map((k) => k.name).join(', ')} carrying traffic`);
    if (c.it.backbone) it.lines.push(`Campus buildings linked by ${c.it.backbone} (protected from trees & ice)`);

    const r = sim.roads;
    const roads = { level: LEVEL.ok, title: 'Roads clear', lines: [] };
    if (r) {
      const crit = r.impassablePct >= 5 || r.routes.some((x) => x.level === LEVEL.critical);
      const watch = r.hazardPct >= 5 || r.signalsOut > 0 || r.lowVis || r.routes.some((x) => x.level === LEVEL.watch);
      roads.level = crit ? LEVEL.critical : watch ? LEVEL.watch : LEVEL.ok;
      roads.title = crit ? `${r.impassablePct.toFixed(0)}% of roads impassable` : watch ? 'Hazardous driving' : 'Roads clear';
      for (const x of r.routes) roads.lines.push(`${x.name}: ${x.text}`);
      if (r.signalsOut) roads.lines.push(`${r.signalsOut} of ${r.signalsTotal} traffic signals dark — treat as 4-way stops`);
      if (r.lowVis) roads.lines.push(`Visibility ${sim.visibilityMi().toFixed(2)} mi`);
      roads.familiesAffected = r.routes.reduce((s, x) => s + (x.level === LEVEL.critical ? x.share : 0), 0);
      const tr = sim.traffic;
      if (tr) {
        roads.lines.push(`Simulated crashes: ${tr.crashes24} in the last 24 h (typical ≈ 6)${tr.mult > 1.5 ? ` · risk ×${tr.mult.toFixed(1)} (${tr.why.join(', ')})` : ''}`);
        if (tr.mult >= 4) roads.level = Math.max(roads.level, LEVEL.watch);
      }
    }
    return { power, it, roads, assumed: c.assumed };
  }
}
