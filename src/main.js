import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { HALF_EXTENT_M, RADIUS_M, llToXZ, groundY, elevToY, elev, N, CELL, elevationAt, iToX, jToZ } from './geo.js';
import { buildHydrology, nearestStreamCell } from './sim/hydrology.js';
import { Simulation, BANDS } from './sim/engine.js';
import { dayOfYear, moonIllum, localMs, HOUR } from './sim/clock.js';
import { U } from './render/common.js';
import { buildTerrainGeometry, buildLandcover, terrainMaterial, paintScar, clearScars } from './render/terrain.js';
import { waterMaterial } from './render/water.js';
import { createSky, createClouds, createFogSheet } from './render/sky.js';
import { createPrecip, createLightning } from './render/precip.js';
import { createForest } from './render/trees.js';
import { createCampus, structureMaterial, drapedRect } from './render/campus.js';
import { buildRoads, makeRoadEvaluator, fallbackRoads, campusDrives, fallbackSignals } from './render/roads.js';
import { loadOSM, saveOSMSnapshot, bakedOSM, bakedRegionOSM, saveRegionalSnapshot } from './render/osm.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { inCampus } from './campus-geo.js';
import { Labels } from './render/labels.js';
import { createTraffic } from './render/cars.js';
import { createRegion } from './render/region.js';
import { REGION_HALF_M } from './geo-region.js';
import { UI } from './ui.js';
import { refreshNWS, refreshUSGS } from './sim/live.js';
import { fromUTC, fmtShort } from './sim/clock.js';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function main() {
  const loadingText = document.getElementById('loading-text');
  const canvas = document.getElementById('scene');
  // Phones and tablets get a lighter scene (fewer trees and particles, lower resolution) to stay smooth.
  const mobile = window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 600;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
  } catch (e) {
    throw new Error('This browser or device does not support WebGL, which the 3D view needs. Try a recent Chrome, Safari, Edge or Firefox, and make sure hardware acceleration is turned on.');
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); document.getElementById('loading-text').textContent = 'The graphics context was lost. Reload the page to continue.'; document.getElementById('loading').classList.remove('done'); });
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 5, 600000);

  await nextFrame();
  loadingText.textContent = 'Tracing rivers and creeks from the terrain…';
  await nextFrame();
  const hydro = buildHydrology();
  const sim = new Simulation(hydro);

  loadingText.textContent = 'Growing the forest…';
  await nextFrame();
  const geo = buildTerrainGeometry(hydro);
  const land = buildLandcover(hydro);
  const labels = new Labels(document.getElementById('app'));
  loadingText.textContent = 'Building the 30-mile region…';
  await nextFrame();
  const region = createRegion(labels, mobile);
  const regionRoads = bakedRegionOSM();
  if (regionRoads) region.setRoads(regionRoads);
  scene.add(region.group);
  const campus = createCampus(labels);
  scene.add(campus.group);
  const terrain = new THREE.Mesh(geo, terrainMaterial(land.tex, campus.ground));
  const water = new THREE.Mesh(geo, waterMaterial());
  water.renderOrder = 3;
  scene.add(terrain, water);

  const forest = createForest(land, campus.avoid, mobile ? 0.45 : 1, campus.extraTrees);
  scene.add(forest.group);

  const FALLBACK = fallbackRoads();
  let roads = buildRoads(FALLBACK, hydro, land.cover);
  scene.add(roads.mesh);
  sim.roadEvaluator = makeRoadEvaluator(roads, hydro, fallbackSignals(FALLBACK));
  const traffic = createTraffic(mobile ? 220 : 520);
  traffic.setRoads(FALLBACK, roads.samples);
  scene.add(traffic.group);

  const sky = createSky();
  scene.add(sky.mesh);
  const clouds = createClouds();
  scene.add(clouds.group);
  const fogSheet = createFogSheet();
  scene.add(fogSheet);
  const precip = createPrecip(mobile ? 0.5 : 1);
  scene.add(precip.group);
  const lightning = createLightning(scene);

  // ---- labels
  const lbl = (text, lat, lon, opts = {}) => {
    const p = llToXZ(lat, lon);
    return labels.add(text, new THREE.Vector3(p.x, groundY(p.x, p.z) + (opts.lift ?? 40), p.z), opts);
  };
  labels.add('Carolina Day School', new THREE.Vector3(0, groundY(0, 0) + 75, 0), { cls: 'school', group: 'school', minDist: 900, priority: 2 });
  lbl('Downtown Asheville', 35.5951, -82.5515, { maxDist: 60000 });
  lbl('Biltmore House', 35.5406, -82.5524);
  lbl('Biltmore Village', 35.5665, -82.5446);
  lbl('River Arts District', 35.5850, -82.5680);
  lbl('Biltmore Forest', 35.5345, -82.5300, { maxDist: 9000 });
  lbl('Mission Hospital', 35.5775, -82.5490, { maxDist: 12000 });
  lbl('Skyland', 35.4876, -82.5215, { maxDist: 14000 });
  for (const [name, cls, lat, lon] of [['French Broad River', 3, 35.545, -82.567], ['French Broad River', 3, 35.495, -82.585], ['Swannanoa River', 2, 35.572, -82.515]]) {
    const p = llToXZ(lat, lon), k = nearestStreamCell(hydro, p.x, p.z, cls, 60);
    if (k >= 0) { const x = iToX(k % N), z = jToZ((k / N) | 0); labels.add(name, new THREE.Vector3(x, groundY(x, z) + 25, z), { cls: 'river', group: 'river' }); }
  }
  // highest point on the map
  let hk = 0; for (let k = 0; k < elev.length; k++) if (elev[k] > elev[hk]) hk = k;
  { const x = iToX(hk % N), z = jToZ((hk / N) | 0); labels.add(`▲ ${Math.round(elev[hk] * 3.281).toLocaleString()} ft`, new THREE.Vector3(x, groundY(x, z) + 30, z), { cls: 'peak', maxDist: 25000 }); }
  const roadLabels = [];
  const labelRoads = (ways) => {
    for (const l of roadLabels) labels.remove(l);
    roadLabels.length = 0;
    const seen = new Set();
    for (const w of ways) {
      if (!w.name || seen.has(w.name) || !['motorway', 'trunk', 'primary'].includes(w.kind) || w.pts.length < 2) continue;
      const mid = w.pts[Math.floor(w.pts.length / 2)], p = llToXZ(mid[0], mid[1]);
      if (Math.hypot(p.x, p.z) > RADIUS_M) continue;
      seen.add(w.name);
      roadLabels.push(labels.add(w.name, new THREE.Vector3(p.x, groundY(p.x, p.z) + 20, p.z), { cls: 'road', group: 'road', maxDist: 14000 }));
    }
  };
  labelRoads(FALLBACK);

  // ---- camera & controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 40;
  controls.maxDistance = 170000;
  controls.screenSpacePanning = false;
  const at = (lat, lon) => { const p = llToXZ(lat, lon); return new THREE.Vector3(p.x, groundY(p.x, p.z), p.z); };
  const campusT = new THREE.Vector3(0, groundY(0, 0), 0);
  const cameraPresets = [
    { id: 'campus', label: '🏫 Campus', target: campusT, offset: new THREE.Vector3(260, 300, 480) },
    { id: 'overview', label: '🗺 5-mile view', target: campusT, offset: new THREE.Vector3(2500, 11500, 12500) },
    { id: 'region', label: '🏔 30-mile region', target: campusT, offset: new THREE.Vector3(8000, 62000, 72000) },
    { id: 'biltmore', label: '🌊 Biltmore Village', target: at(35.5655, -82.548), offset: new THREE.Vector3(1100, 900, 1500) },
    { id: 'river', label: '🏞 French Broad', target: at(35.545, -82.565), offset: new THREE.Vector3(-1800, 1400, 2200) },
    { id: 'downtown', label: '🏙 Downtown', target: at(35.592, -82.551), offset: new THREE.Vector3(1200, 1000, 1800) },
    { id: 'ridge', label: '⛰ Ridge view', target: campusT, offset: new THREE.Vector3(5200, 900, -800) },
  ];
  let fly = null;
  const flyTo = (id, instant = false) => {
    const p = cameraPresets.find((c) => c.id === id);
    fly = { t: instant ? 1 : 0, fromP: camera.position.clone(), fromT: controls.target.clone(), toT: p.target.clone(), toP: p.target.clone().add(p.offset) };
  };
  camera.position.copy(campusT).add(new THREE.Vector3(1800, 2600, 4200));
  controls.target.copy(campusT);

  // ---- app state shared with the UI
  const layers = { labels: true, ring: true, roads: true, roadStatus: false, trees: true, clouds: true, precip: true, cars: true, region: true };
  let playing = true;
  const app = {
    layers, cameraPresets, flyTo, saveOSMSnapshot, saveRegionalSnapshot, regionRoadsBaked: !!regionRoads, region,
    speed: 0.166667,
    togglePlay() { playing = !playing; ui.setPlaying(playing); },
    play(p) { playing = p; ui.setPlaying(playing); },
    jumpToNow() { const d = new Date(); sim.reset(localMs(d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes())); },
    goLive: () => goLive(),
    stopLive: () => stopLive(),
    refreshLive: (manual) => refreshLive(manual),
  };
  const ui = new UI(sim, app);
  if (mobile) document.getElementById('cam-hint').textContent = 'One finger to orbit · two fingers to zoom and pan';
  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); app.togglePlay(); } });

  // ---- events
  const peakStage = new Float32Array(4);
  sim.on('landslide', (s) => {
    paintScar(land, s.path);
    forest.slide(s.path, U.uTime.value);
    if (sim.landslides.length <= 3 || sim.landslides.length % 5 === 0) ui.toast(`⛰ Landslide #${sim.landslides.length} on a saturated slope`, '#c08a4a');
  });
  sim.on('decision', (d) => {
    if (d.phase === 'evening') {
      const day = new Date(d.forDay).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
      const msg = { closed: `CDS will be CLOSED ${day}`, watch: `Possible delay ${day} — final call at 5:30 AM`, open: `CDS expects a normal schedule ${day}` }[d.status];
      ui.toast(`🌙 8 PM call: ${msg}`, d.status === 'open' ? '#3ecf73' : d.status === 'watch' ? '#f5d142' : '#ff3d6e');
      return;
    }
    const msg = { open: 'CDS is OPEN on a normal schedule', delay: 'CDS is on a 2-HOUR DELAY', closed: 'CDS is CLOSED today' }[d.status];
    if (msg) ui.toast(`🏫 5:30 AM call: ${msg}`, d.status === 'open' ? '#3ecf73' : d.status === 'delay' ? '#f5d142' : '#ff3d6e');
  });
  sim.on('reset', () => { clearScars(land); forest.reset(); peakStage.fill(0); });
  app.jumpToNow();

  // ---- Live mode: National Weather Service forecast + KAVL observations + USGS river gauges
  const NWS_EVERY = 60 * 60e3, USGS_EVERY = 15 * 60e3;
  let liveTimer = null, lastNWS = 0, lastUSGS = 0, liveBusy = false;
  sim.liveNow = () => fromUTC(Date.now());
  const fmtT = (u) => (u ? new Date(u).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : '—');
  function renderLiveStatus() {
    const m = sim.live.meta;
    const stale = m.fetchedAt && Date.now() - m.fetchedAt > 2.5 * NWS_EVERY;
    const dot = m.error ? 'err' : stale ? 'stale' : '';
    const ahead = (sim.t - sim.liveNow()) / 3600e3;
    const where = Math.abs(ahead) < 0.5 ? 'Clock is at the present' : ahead > 0 ? `Clock is ${ahead.toFixed(0)} h ahead, running on the forecast` : `Clock is ${(-ahead).toFixed(0)} h behind the present`;
    ui.setLiveStatus(m.error
      ? `<span class="live-dot err"></span>Couldn't reach the weather service (${m.error}). Showing the last data received, or simulated climate if none. Retrying automatically.`
      : `<span class="live-dot ${dot}"></span><b>NWS forecast</b> for campus (grid ${m.office} ${m.grid}), issued ${fmtT(Date.parse(m.gridUpdated))}<br>`
        + `KAVL observation ${fmtT(m.obsTime)} · USGS gauges ${fmtT(m.gaugeTime)} · next update ${fmtT((m.fetchedAt || Date.now()) + NWS_EVERY)}<br><span class="muted">${where}. Forecast runs through ${sim.live.end ? fmtShort(sim.live.end - 3600e3) : '—'}.</span>`);
  }
  async function refreshLive(manual = false) {
    if (liveBusy) return;
    liveBusy = true;
    const now = Date.now();
    try {
      if (manual || now - lastNWS > NWS_EVERY - 30e3) { await refreshNWS(sim.live); lastNWS = now; }
      if (manual || now - lastUSGS > USGS_EVERY - 30e3) {
        await refreshUSGS(sim.live).then(() => { lastUSGS = now; if (sim.mode === 'live') sim.assimilateGauges(0.5); }).catch(() => {});
      }
      sim.live.meta.error = null;
      if (manual) ui.toast('Live weather data refreshed', '#58b4ff');
    } catch (e) {
      sim.live.meta.error = e.message || 'network error';
    } finally { liveBusy = false; renderLiveStatus(); }
  }
  async function goLive() {
    ui.setLiveStatus('<span class="live-dot stale"></span>Connecting to the National Weather Service and USGS…');
    document.getElementById('live-box').hidden = false;
    lastNWS = lastUSGS = 0;
    await refreshLive();
    if (!sim.live.hasData()) { ui.toast('Live weather unavailable right now. Showing simulated climate.', '#ff8a3d'); ui.setMode('auto'); return; }
    // spin up on the last ~48 h of observations, then hand over to the forecast at the present
    sim.setMode('live');
    const nowT = sim.liveNow();
    let guard = 0;
    while (sim.t < nowT - 60e3 && guard++ < 400) sim.step(Math.min(0.25, (nowT - sim.t) / 3600e3));
    sim.assimilateGauges(1); // rivers start the present exactly at the real gauge readings
    sim.peak.fb = sim.gaugeFt(3); sim.peak.sw = sim.gaugeFt(2);
    forest.sync(sim.treesDownFrac, U.uTime.value - 5, sim.wx.windDir);
    app.speed = 0.000277778; document.getElementById('speed').value = '0.000277778';
    for (const b of document.querySelectorAll('#mode-seg button')) b.classList.toggle('on', b.dataset.mode === 'live');
    app.play(true);
    renderLiveStatus();
    clearInterval(liveTimer);
    liveTimer = setInterval(() => { if (sim.mode === 'live') { refreshLive(); renderLiveStatus(); } }, 60e3);
  }
  function stopLive() { clearInterval(liveTimer); liveTimer = null; }

  // ---- OpenStreetMap detail (real roads, signals & buildings): baked into the app, or fetched live if not
  const applyOSM = (osm) => {
    if (osm.roads.length < 20) throw new Error('too few roads');
    scene.remove(roads.mesh);
    roads.mesh.geometry.dispose();
    roads = buildRoads([...osm.roads, ...campusDrives()], hydro, land.cover);
    scene.add(roads.mesh);
    const signals = osm.signals.length ? osm.signals.map(([la, lo]) => llToXZ(la, lo)) : fallbackSignals(FALLBACK);
    sim.roadEvaluator = makeRoadEvaluator(roads, hydro, signals);
    traffic.setRoads([...osm.roads, ...campusDrives()], roads.samples);
    labelRoads(osm.roads);
    const bgroup = new THREE.Group();
    const wallMat = structureMaterial(0xb9a68e), houseMat = structureMaterial(0xc9c2b4);
    const houseGeos = [], otherGeos = [];
    for (const b of osm.buildings) {
      const pts = b.pts.map(([la, lo]) => llToXZ(la, lo));
      if (pts.length < 4 || inCampus(pts[0].x, pts[0].z)) continue; // campus buildings come from the campus map
      let lo = Infinity; for (const p of pts) lo = Math.min(lo, groundY(p.x, p.z));
      const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
      const h = b.h * 1.3 + 4;
      const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }).rotateX(-Math.PI / 2);
      g.translate(0, lo - 3, 0);
      (b.type === 'house' || b.type === 'residential' ? houseGeos : otherGeos).push(g.index ? g.toNonIndexed() : g);
    }
    // one draw call per material instead of one per building
    for (const [geos, mat] of [[houseGeos, houseMat], [otherGeos, wallMat]]) if (geos.length) bgroup.add(new THREE.Mesh(mergeGeometries(geos), mat));
    for (const p of osm.pitches) {
      const pts = p.pts.map(([la, lo]) => llToXZ(la, lo));
      if (pts.length < 4 || inCampus(pts[0].x, pts[0].z)) continue;
      const xs = pts.map((q) => q.x), zs = pts.map((q) => q.z);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      bgroup.add(drapedRect(cx, cz, Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 0, p.kind === 'track' ? 0x9a4a3a : 0x3f7a35, true));
    }
    scene.add(bgroup);
    const when = osm.date ? ` (map data as of ${new Date(osm.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})` : '';
    ui.setOSMStatus(`Real roads, ${osm.signals.length} traffic signals & ${osm.buildings.length} buildings from OpenStreetMap${when}. © OpenStreetMap contributors.`, osm.source === 'live');
  };
  const baked = bakedOSM();
  if (baked) applyOSM(baked);
  else loadOSM((t) => ui.setOSMStatus(t)).then(applyOSM).catch(() => ui.setOSMStatus('Roads: approximate major corridors (OpenStreetMap unavailable offline).'));

  // ---- per-frame visual sync from simulation state
  const sunV = new THREE.Vector3();
  let wet = 0, lastSync = 0, lastUI = 0, lastStatus = 0;
  function syncVisuals(dtReal, simDtH) {
    const w = sim.wx, sun = sim.sun;
    const el = sun.elevation * Math.PI / 180, az = sun.azimuth * Math.PI / 180;
    const night = 1 - smooth(-8, 2, sun.elevation);
    const day = smooth(-6, 10, sun.elevation);
    const overcast = smooth(0.3, 1, w.cloud);
    const storm = Math.min(1, w.precip / 8);
    if (sun.elevation > -4) sunV.set(Math.sin(az) * Math.cos(el), Math.max(0.02, Math.sin(el)), -Math.cos(az) * Math.cos(el)).normalize();
    else { const m = (az + Math.PI); sunV.set(Math.sin(m) * 0.6, 0.6, -Math.cos(m) * 0.6).normalize(); } // moon
    U.uSunDir.value.copy(sunV);
    const low = 1 - smooth(2, 25, sun.elevation);
    const moon = moonIllum(sim.t) * (1 - w.cloud) * 0.22;
    const sunI = day * (1 - overcast * 0.85) * (1 - storm * 0.5);
    U.uSunColor.value.setRGB(1, 0.93 - low * 0.25, 0.85 - low * 0.45).multiplyScalar(sunI * 1.15).add(new THREE.Color(0.5, 0.6, 0.9).multiplyScalar(moon * night));
    const ambDay = new THREE.Color(0.42, 0.5, 0.62).lerp(new THREE.Color(0.55, 0.57, 0.6), overcast);
    const ambNight = new THREE.Color(0.17, 0.2, 0.28).multiplyScalar(0.75 + moonIllum(sim.t) * (1 - w.cloud) * 0.6);
    U.uSkyAmb.value.copy(ambNight.clone().lerp(ambDay, day)).multiplyScalar(1 - storm * 0.45);
    U.uGroundAmb.value.copy(U.uSkyAmb.value).multiplyScalar(0.45);
    const fogDay = new THREE.Color(0.68, 0.75, 0.84).lerp(new THREE.Color(0.6, 0.62, 0.65), overcast).lerp(new THREE.Color(0.45, 0.47, 0.5), storm);
    U.uFogColor.value.copy(new THREE.Color(0.03, 0.035, 0.05).lerp(fogDay, day));
    const vis = sim.visibilityMi() * 1609;
    // clear-day haze is lighter so the 30-mile view still shows the far ridges
    U.uFogDensity.value = (vis > 15000 ? 0.18 / vis : 0.45 / Math.max(vis, 300)) + 3e-6;
    U.uValleyFog.value = w.fog;
    U.uValleyFogTop.value = 640 + w.fog * 110;
    fogSheet.visible = w.fog > 0.05;
    for (let b = 0; b < BANDS; b++) { U.uSnow.value[b] = sim.snowCm[b]; U.uIce.value[b] = sim.iceMm[b]; }
    wet += ((w.precip > 0.1 || sim.campus.snowCm > 0 && sim.campus.tempC > 0 ? 1 : 0) - wet) * Math.min(1, simDtH / (w.precip > 0.1 ? 0.5 : 6));
    U.uWet.value = wet;
    const doy = dayOfYear(sim.t);
    U.uDoy.value = doy;
    for (let c = 0; c < 4; c++) peakStage[c] = Math.max(peakStage[c], sim.stages[c]);
    U.uStages.value.set(...sim.stages);
    U.uRise.value.set(sim.riseM(0), sim.riseM(1), sim.riseM(2), sim.riseM(3));
    const ps = [0, 1, 2, 3].map((c) => (peakStage[c] - sim.stages[c] > 0.5 && peakStage[c] - (sim.stages[c] - sim.riseM(c)) > 1 ? peakStage[c] : -10));
    U.uPeakStages.value.set(...ps);
    U.uNight.value = night;
    U.uPowerOut.value = sim.powerOut;
    const wd = (w.windDir + 180) * Math.PI / 180;
    U.uWind.value.set(Math.sin(wd), -Math.cos(wd));
    U.uWindStrength.value = Math.min(3, w.gustMs / 12);
    U.uShowRing.value = layers.ring ? 1 : 0;
    U.uRoadIce.value = sim.campus.tempC < 0.5 ? sim.roadIce : 0;
    U.uRoadStatus.value = layers.roadStatus ? 1 : 0;
    for (const [id, b] of Object.entries(campus.buildings)) {
      const st = sim.ops.buildings[id];
      b.mat.uniforms.uPowered.value = st === 'none' ? 0 : 1;
      b.mat.uniforms.uStatusColor.value.setRGB(...(st === 'utility' ? [0.2, 0.8, 0.35] : st === 'generator' ? [1, 0.75, 0.1] : [1, 0.15, 0.1]));
    }
    sky.uniforms.uCloud.value = w.cloud;
    sky.uniforms.uStorm.value = storm;
    sky.uniforms.uSunElev.value = Math.sin(el);
    clouds.update(w, dtReal, simDtH, layers.clouds);
    roads.mesh.visible = layers.roads;
    forest.group.visible = layers.trees;
    precip.group.visible = layers.precip;
    labels.visible = layers.labels;
  }

  // ---- main loop
  const clock = new THREE.Clock();
  document.getElementById('loading').classList.add('done');
  ui.setPlaying(playing);
  ui.update();
  flyTo('campus');
  // on the published website, open in Live (NWS) mode; local files and the offline app start in simulated climate
  if (location.protocol.startsWith('http') && !/[?&]sim\b/.test(location.search)) setTimeout(() => ui.setMode('live'), 500);
  const hidden = new Set();
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, clock.getDelta());
    let simDtH = 0;
    if (playing) {
      simDtH = dt * app.speed;
      const steps = Math.max(1, Math.ceil(simDtH / (5 / 60)));
      for (let i = 0; i < steps; i++) sim.step(simDtH / steps);
    }
    U.uTime.value += dt;
    syncVisuals(dt, simDtH);
    if (fly) {
      fly.t = Math.min(1, fly.t + dt / 1.6);
      const e = fly.t < 0.5 ? 2 * fly.t * fly.t : 1 - (-2 * fly.t + 2) ** 2 / 2;
      controls.target.lerpVectors(fly.fromT, fly.toT, e);
      camera.position.lerpVectors(fly.fromP, fly.toP, e);
      if (fly.t >= 1) fly = null;
    }
    controls.update();
    // keep the camera above ground and inside the world
    const minY = groundY(THREE.MathUtils.clamp(camera.position.x, -REGION_HALF_M, REGION_HALF_M), THREE.MathUtils.clamp(camera.position.z, -REGION_HALF_M, REGION_HALF_M)) + 25;
    if (camera.position.y < minY) camera.position.y = minY;
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, -REGION_HALF_M, REGION_HALF_M);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -REGION_HALF_M, REGION_HALF_M);
    // keep depth precision good both on campus and at the 30-mile view
    const camDist = camera.position.distanceTo(controls.target);
    const near = THREE.MathUtils.clamp(camDist / 700, 2, 250);
    if (Math.abs(near - camera.near) > camera.near * 0.2) { camera.near = near; camera.updateProjectionMatrix(); }
    sky.mesh.position.copy(camera.position);
    precip.update(sim, camera, controls.target, renderer.getPixelRatio());
    lightning.update(sim, dt, playing, controls.target, groundY);
    traffic.update(sim, dt, layers.cars && layers.roads, U.uNight.value);
    const now = performance.now();
    if (now - lastSync > 300) { lastSync = now; forest.sync(sim.treesDownFrac, U.uTime.value, sim.wx.windDir); region.update(sim, layers.region); }
    if (now - lastUI > 250) { lastUI = now; ui.update(); if (sim.mode === 'live' && now - lastStatus > 2000) { lastStatus = now; renderLiveStatus(); } }
    hidden.clear();
    if (!layers.roads) hidden.add('road');
    if (!layers.region) hidden.add('region');
    labels.update(camera, window.innerWidth, window.innerHeight, hidden);
    renderer.render(scene, camera);
  }
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });
  // handy for debugging & automated screenshots: advance the simulation quickly by N hours
  const advance = (hours) => { for (let i = 0; i < hours * 12; i++) sim.step(1 / 12); forest.sync(sim.treesDownFrac, U.uTime.value - 5, sim.wx.windDir); };
  window.__cds = { sim, app, camera, controls, ui, U, advance, traffic, region, scene, terrain, water };
  frame();
}

// Installable web app: cache the app files so it opens offline (only works when served over http/https).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

main().catch((e) => {
  console.error(e);
  document.getElementById('loading-text').textContent = e.message.startsWith('This browser') ? e.message : 'Something went wrong starting the simulation: ' + e.message;
  document.querySelector('#loading .spinner')?.remove();
});
