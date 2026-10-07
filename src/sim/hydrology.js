// Terrain hydrology derived from the real elevation grid:
//  - priority-flood depression filling
//  - D8 flow directions and flow accumulation (with upstream inflow for rivers that enter the map)
//  - stream network classification
//  - HAND ("height above nearest drainage"), the standard technique for rapid flood-inundation mapping
import { N, CELL, elev, cellIndex, xToI, zToJ, N as N0, CELL as CELL0, elev as elev0 } from '../geo.js';

export const RIVER_CLASS = { CREEK: 0, STREAM: 1, SWANNANOA: 2, FRENCH_BROAD: 3 };
export const CLASS_NAMES = ['Creeks', 'Larger streams', 'Swannanoa River', 'French Broad River'];

const D8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

class MinHeap {
  constructor(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  push(key, val) {
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= key) break;
      this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p;
    }
    this.k[i] = key; this.v[i] = val;
  }
  pop() {
    const top = this.v[0], key = this.k[--this.n], val = this.v[this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && this.k[c + 1] < this.k[c]) c++;
      if (this.k[c] >= key) break;
      this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c;
    }
    this.k[i] = key; this.v[i] = val;
    return top;
  }
}

// Known places where major rivers enter the simulated square (grid search windows), with their
// approximate upstream drainage area in km^2 (French Broad at Asheville ~2,450 km^2; Swannanoa ~340 km^2).
const INFLOWS0 = [
  { name: 'French Broad (from Hendersonville/Bent Creek)', edge: 'S', from: 140, to: 210, areaKm2: 2350 },
  { name: 'Swannanoa (from Black Mountain/Oteen)', edge: 'N', from: 380, to: 450, areaKm2: 330 },
];

/**
 * grid: { N, CELL, elev, inflows } — defaults to the detailed 5-mile grid. The regional (30-mile) grid passes its own
 * coarser elevations; most of the French Broad basin lies inside it, so it needs no upstream inflows.
 */
export function buildHydrology(grid = {}) {
  const N = grid.N ?? N0, CELL = grid.CELL ?? CELL0, elev = grid.elev ?? elev0, INFLOWS = grid.inflows ?? INFLOWS0;
  const total = N * N;
  const filled = new Float32Array(elev);
  const done = new Uint8Array(total);
  const heap = new MinHeap(total);
  // seed with boundary
  for (let k = 0; k < total; k++) {
    const i = k % N, j = (k / N) | 0;
    if (i === 0 || j === 0 || i === N - 1 || j === N - 1) { heap.push(filled[k], k); done[k] = 1; }
  }
  const order = new Int32Array(total); // cells in ascending processing (downstream-first) order
  let on = 0;
  const EPS = 1e-3;
  while (heap.n) {
    const c = heap.pop();
    order[on++] = c;
    const ci = c % N, cj = (c / N) | 0;
    for (const [dx, dy] of D8) {
      const ni = ci + dx, nj = cj + dy;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nk = nj * N + ni;
      if (done[nk]) continue;
      done[nk] = 1;
      if (filled[nk] <= filled[c]) filled[nk] = filled[c] + EPS;
      heap.push(filled[nk], nk);
    }
  }

  // D8 flow direction on the filled surface (-1 = flows off map)
  const down = new Int32Array(total).fill(-1);
  for (let k = 0; k < total; k++) {
    const ci = k % N, cj = (k / N) | 0;
    let best = 0, bk = -1;
    for (const [dx, dy] of D8) {
      const ni = ci + dx, nj = cj + dy;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nk = nj * N + ni;
      const drop = (filled[k] - filled[nk]) / (dx && dy ? Math.SQRT2 : 1);
      if (drop > best) { best = drop; bk = nk; }
    }
    down[k] = bk;
  }

  // Accumulation (km^2). Process from highest to lowest.
  const cellKm2 = (CELL * CELL) / 1e6;
  const acc = new Float32Array(total).fill(cellKm2);
  for (const inf of INFLOWS) {
    // Pick the lowest cell a few rows inside the edge whose flow path stays on the map for a while
    // (so the virtual upstream area actually travels down the river channel).
    const cands = [];
    for (let t = inf.from; t <= inf.to; t++) {
      for (let d = 2; d < 10; d++) {
        const k = inf.edge === 'S' ? (N - 1 - d) * N + t : inf.edge === 'N' ? d * N + t
          : inf.edge === 'W' ? t * N + d : t * N + (N - 1 - d);
        cands.push(k);
      }
    }
    cands.sort((a, b) => elev[a] - elev[b]);
    for (const k of cands) {
      let c = k, steps = 0;
      while (c >= 0 && steps < 200) { c = down[c]; steps++; }
      if (steps >= 200) { inf.cell = k; break; }
    }
    if (inf.cell != null) acc[inf.cell] += inf.areaKm2;
  }
  for (let o = total - 1; o >= 0; o--) {
    const k = order[o];
    if (down[k] >= 0) acc[down[k]] += acc[k];
  }

  // Stream network & class
  const STREAM_KM2 = 0.35;
  const cls = new Int8Array(total).fill(-1);
  for (let k = 0; k < total; k++) {
    const a = acc[k];
    if (a < STREAM_KM2) continue;
    cls[k] = a > 1500 ? 3 : a > 150 ? 2 : a > 6 ? 1 : 0;
  }

  // HAND: follow flow to the first stream cell. Downstream cells are processed first.
  const drain = new Int32Array(total).fill(-1);
  for (let o = 0; o < total; o++) {
    const k = order[o];
    if (cls[k] >= 0) drain[k] = k;
    else if (down[k] >= 0) drain[k] = drain[down[k]];
  }
  const hand = new Float32Array(total);
  const drainElev = new Float32Array(total);
  const drainClass = new Int8Array(total);
  for (let k = 0; k < total; k++) {
    const d = drain[k];
    if (d < 0) { hand[k] = 999; drainElev[k] = elev[k] - 999; drainClass[k] = 0; continue; }
    drainElev[k] = elev[d];
    hand[k] = Math.max(0, elev[k] - elev[d]);
    drainClass[k] = cls[d];
  }
  return { N, CELL, filled, down, acc, cls, drain, hand, drainElev, drainClass, order, inflows: INFLOWS };
}

/** Flood depth (m) at a world point for the current river stages (m above normal-dry channel). */
export function floodDepthAt(h, stages, x, z) {
  const k = cellIndex(x, z);
  const c = h.drainClass[k];
  if (h.hand[k] > 100) return 0;
  return stages[c] - h.hand[k];
}

export function nearestStreamCell(h, x, z, minClass, radiusCells = 30) {
  const ci = Math.round(xToI(x)), cj = Math.round(zToJ(z));
  let best = -1, bd = Infinity;
  for (let dj = -radiusCells; dj <= radiusCells; dj++) for (let di = -radiusCells; di <= radiusCells; di++) {
    const i = ci + di, j = cj + dj;
    if (i < 0 || j < 0 || i >= N || j >= N) continue;
    const k = j * N + i;
    if (h.cls[k] >= minClass) { const d = di * di + dj * dj; if (d < bd) { bd = d; best = k; } }
  }
  return best;
}
