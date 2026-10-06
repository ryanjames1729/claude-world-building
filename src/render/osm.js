// Optional real-world detail from OpenStreetMap (© OpenStreetMap contributors, ODbL),
// fetched in the browser from the public Overpass API. Falls back gracefully when offline.
import { CENTER, RADIUS_M } from '../geo.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

let lastRaw = null;

/** Saves the loaded OpenStreetMap data so it can be baked into the app (data/osm-snapshot.json). */
export function saveOSMSnapshot() {
  if (!lastRaw) return false;
  const blob = new Blob([JSON.stringify(lastRaw)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'osm-snapshot.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return true;
}

export async function loadOSM(onStatus) {
  // a snapshot shipped with the app wins: faster, works offline, and doesn't depend on Overpass being up
  if (location.protocol.startsWith('http')) try {
    const res = await fetch('data/osm-snapshot.json');
    if (res.ok) { lastRaw = await res.json(); return { ...parse(lastRaw), source: 'snapshot' }; }
  } catch { /* no snapshot (or opened from file://) */ }
  const { lat, lon } = CENTER;
  const R = Math.round(RADIUS_M + 600);
  const q = `[out:json][timeout:60];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link)$"](around:${R},${lat},${lon});
  way["highway"~"^(residential|unclassified)$"](around:3500,${lat},${lon});
  way["building"](around:1300,${lat},${lon});
  way["amenity"="school"](around:3000,${lat},${lon});
  way["leisure"~"^(pitch|track)$"](around:1300,${lat},${lon});
  node["highway"="traffic_signals"](around:${R},${lat},${lon});
);
out tags geom;`;
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      onStatus?.(`Loading OpenStreetMap roads & buildings… (${new URL(url).host})`);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 60000);
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctl.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      lastRaw = json;
      return { ...parse(json), source: 'live' };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('OSM unavailable');
}

function parse(json) {
  const roads = [], buildings = [], pitches = [], signals = [];
  let school = null;
  for (const el of json.elements || []) {
    if (el.type === 'node' && el.tags?.highway === 'traffic_signals') { signals.push([el.lat, el.lon]); continue; }
    if (el.type !== 'way' || !el.geometry) continue;
    const t = el.tags || {};
    const pts = el.geometry.map((g) => [g.lat, g.lon]);
    if (t.highway) roads.push({ name: t.ref && !t.name ? t.ref : t.name || t.ref || '', kind: t.highway, pts });
    else if (t.building) {
      const h = parseFloat(t.height) || (parseFloat(t['building:levels']) || 0) * 3.6 || (t.building === 'house' ? 7 : 9);
      buildings.push({ pts, h, name: t.name || '', type: t.building });
    } else if (t.leisure) pitches.push({ pts, kind: t.leisure });
    if (t.amenity === 'school' && /carolina day/i.test(t.name || '')) school = { pts, name: t.name };
  }
  return { roads, buildings, pitches, school, signals };
}
