// Historical-inspired weather scenarios for the Asheville area. Values are approximate,
// reconstructed for teaching purposes from public summaries — they are not official observations.
//   t       local time (America/New_York)
//   tF      air temperature at campus level (°F)       noseF  temperature of the warm layer aloft (°F)
//   wind    sustained wind (mph)   gust (mph)   dir (deg wind is FROM)
//   rain    precipitation rate, liquid-equivalent (in/hr)
//   cloud   0..1   fog 0..1   thunder 0..1 (lightning frequency)
// coverage: fraction of the large river basins getting similar rain (1 = region-wide; small for local storms)
export const SCENARIOS = [
  {
    id: 'helene',
    name: 'Hurricane Helene (Sep 2024)',
    short: 'Tropical remnant flooding & wind',
    start: '2024-09-25T00:00', end: '2024-09-29T12:00',
    init: { soil: 0.55, stageBoost: 0 },
    summary: 'A predecessor rain event soaked the mountains on Sept 25–26, then Helene\'s core arrived early on Sept 27 with ' +
      'torrential rain and damaging gusts. Asheville saw roughly 14+ inches of rain over three days; the French Broad and ' +
      'Swannanoa rivers reached record crests, flooding Biltmore Village and the River Arts District, and saturated slopes failed in landslides.',
    keys: [
      { t: '2024-09-25T00:00', tF: 72, wind: 6,  gust: 12, dir: 160, rain: 0.04, cloud: 0.85, note: 'Moist tropical air streams north ahead of Helene; light rain begins.' },
      { t: '2024-09-25T12:00', tF: 71, wind: 8,  gust: 15, dir: 150, rain: 0.10, cloud: 1 },
      { t: '2024-09-25T18:00', tF: 70, wind: 8,  gust: 16, dir: 140, rain: 0.12, cloud: 1, note: 'Predecessor Rain Event (PRE): a band of heavy rain sets up over the mountains well before the storm.' },
      { t: '2024-09-26T00:00', tF: 69, wind: 8,  gust: 16, dir: 140, rain: 0.10, cloud: 1 },
      { t: '2024-09-26T08:00', tF: 69, wind: 10, gust: 20, dir: 130, rain: 0.12, cloud: 1, note: 'Soils are already saturated before Helene even arrives.' },
      { t: '2024-09-26T14:00', tF: 70, wind: 14, gust: 26, dir: 120, rain: 0.15, cloud: 1 },
      { t: '2024-09-26T20:00', tF: 70, wind: 20, gust: 35, dir: 110, rain: 0.30, cloud: 1, note: 'Helene makes landfall in Florida\'s Big Bend near 11 PM as a Category 4 and races north.' },
      { t: '2024-09-27T00:00', tF: 69, wind: 24, gust: 42, dir: 110, rain: 0.60, cloud: 1, thunder: 0.15 },
      { t: '2024-09-27T03:00', tF: 69, wind: 30, gust: 55, dir: 120, rain: 0.80, cloud: 1, thunder: 0.2, note: 'Torrential rain: 1 inch per hour on top of saturated ground. Creeks flash-flood.' },
      { t: '2024-09-27T06:00', tF: 70, wind: 36, gust: 68, dir: 140, rain: 0.85, cloud: 1, thunder: 0.15, note: 'Peak wind gusts near 70 mph topple trees whose roots sit in saturated soil. Power fails widely.' },
      { t: '2024-09-27T09:00', tF: 71, wind: 34, gust: 64, dir: 170, rain: 0.60, cloud: 1, note: 'Rivers rise feet per hour. The Swannanoa floods Biltmore Village; the French Broad heads toward a record crest.' },
      { t: '2024-09-27T12:00', tF: 72, wind: 26, gust: 46, dir: 200, rain: 0.30, cloud: 1 },
      { t: '2024-09-27T15:00', tF: 72, wind: 18, gust: 34, dir: 220, rain: 0.10, cloud: 0.95, note: 'Rain tapers, but water keeps pouring downstream — river crests lag the rain by hours.' },
      { t: '2024-09-27T21:00', tF: 68, wind: 10, gust: 20, dir: 240, rain: 0.0, cloud: 0.7 },
      { t: '2024-09-28T07:00', tF: 61, wind: 4,  gust: 8,  dir: 270, rain: 0.0, cloud: 0.35, fog: 0.5 },
      { t: '2024-09-28T10:00', tF: 66, wind: 5,  gust: 10, dir: 270, rain: 0.0, cloud: 0.3, fog: 0, note: 'Clear skies reveal the damage: washed-out roads, landslides and no power or water for much of the region.' },
      { t: '2024-09-29T12:00', tF: 74, wind: 5,  gust: 10, dir: 270, rain: 0.0, cloud: 0.15 },
    ],
  },
  {
    id: 'blizzard93',
    name: 'Superstorm / Blizzard of \'93 (Mar 1993)',
    short: 'Heavy snow, wind & bitter cold',
    start: '1993-03-12T12:00', end: '1993-03-15T12:00',
    init: { soil: 0.6 },
    summary: 'The "Storm of the Century" brought heavy snow, thunder-snow, high winds and drifting to the mountains on March 12–14, 1993. ' +
      'Asheville measured well over a foot of snow with much deeper drifts, and higher elevations saw 2–3 feet. Roads were impassable for days.',
    keys: [
      { t: '1993-03-12T12:00', tF: 46, wind: 6,  gust: 12, dir: 160, rain: 0, cloud: 0.9 },
      { t: '1993-03-12T18:00', tF: 38, wind: 10, gust: 18, dir: 60, rain: 0.04, cloud: 1, note: 'Rain changes to snow as cold air pours in.' },
      { t: '1993-03-12T22:00', tF: 31, wind: 15, gust: 28, dir: 40, rain: 0.08, cloud: 1 },
      { t: '1993-03-13T02:00', tF: 26, wind: 22, gust: 38, dir: 30, rain: 0.12, cloud: 1, thunder: 0.25, note: 'Thunder-snow! Snowfall rates of 2–3 inches per hour.' },
      { t: '1993-03-13T07:00', tF: 21, wind: 30, gust: 50, dir: 330, rain: 0.085, cloud: 1, thunder: 0.1, note: 'Near-blizzard conditions: wind-driven snow, near-zero visibility.' },
      { t: '1993-03-13T13:00', tF: 18, wind: 28, gust: 48, dir: 320, rain: 0.045, cloud: 1 },
      { t: '1993-03-13T20:00', tF: 14, wind: 22, gust: 40, dir: 310, rain: 0.012, cloud: 0.9, note: 'Snow ends; bitter cold and drifting follow.' },
      { t: '1993-03-14T06:00', tF: 7,  wind: 14, gust: 28, dir: 300, rain: 0, cloud: 0.3 },
      { t: '1993-03-14T15:00', tF: 30, wind: 8,  gust: 16, dir: 290, rain: 0, cloud: 0.1 },
      { t: '1993-03-15T12:00', tF: 42, wind: 5,  gust: 10, dir: 250, rain: 0, cloud: 0.1 },
    ],
  },
  {
    id: 'ice2005',
    name: 'Ice storm (Dec 2005-style)',
    short: 'Freezing rain & cold-air damming',
    start: '2005-12-14T15:00', end: '2005-12-17T09:00',
    init: { soil: 0.5 },
    summary: 'In a classic cold-air damming "wedge", shallow sub-freezing air is trapped against the Blue Ridge while warm, moist air ' +
      'rides over the top. Rain falls through the warm layer and freezes on contact. Half an inch of ice snaps limbs and power lines.',
    keys: [
      { t: '2005-12-14T15:00', tF: 36, noseF: 38, wind: 5, gust: 10, dir: 40, rain: 0, cloud: 0.95 },
      { t: '2005-12-14T22:00', tF: 32, noseF: 41, wind: 6, gust: 12, dir: 40, rain: 0.03, cloud: 1, note: 'A warm layer ~5,000 ft up melts falling snow into rain; the surface stays below freezing.' },
      { t: '2005-12-15T04:00', tF: 30, noseF: 43, wind: 7, gust: 14, dir: 40, rain: 0.07, cloud: 1, note: 'Freezing rain: every surface becomes glazed.' },
      { t: '2005-12-15T10:00', tF: 29, noseF: 44, wind: 8, gust: 16, dir: 30, rain: 0.08, cloud: 1 },
      { t: '2005-12-15T16:00', tF: 30, noseF: 42, wind: 9, gust: 18, dir: 30, rain: 0.06, cloud: 1, note: 'Ice accretion passes 0.5" — the threshold where widespread tree and power-line damage begins.' },
      { t: '2005-12-15T23:00', tF: 31, noseF: 39, wind: 12, gust: 24, dir: 350, rain: 0.025, cloud: 1 },
      { t: '2005-12-16T06:00', tF: 31, noseF: 33, wind: 15, gust: 28, dir: 320, rain: 0.0, cloud: 0.8, note: 'Wind behind the storm sways ice-laden trees: more limbs come down.' },
      { t: '2005-12-16T15:00', tF: 38, noseF: 32, wind: 10, gust: 20, dir: 300, rain: 0, cloud: 0.4 },
      { t: '2005-12-17T09:00', tF: 34, noseF: 30, wind: 5, gust: 10, dir: 300, rain: 0, cloud: 0.2 },
    ],
  },
  {
    id: 'jansnow',
    name: 'January snowstorm',
    short: 'Classic Gulf low snow event',
    start: '2026-01-21T18:00', end: '2026-01-24T12:00',
    init: { soil: 0.5 },
    summary: 'A Gulf low tracks up the Southeast coast with cold air already in place: a typical 6–10" Asheville snowstorm, ' +
      'with heavier totals on the ridges and a little sleet mixing in at the end.',
    keys: [
      { t: '2026-01-21T18:00', tF: 34, wind: 4, gust: 8, dir: 20, rain: 0, cloud: 0.9 },
      { t: '2026-01-22T02:00', tF: 30, wind: 6, gust: 12, dir: 30, rain: 0.04, cloud: 1, note: 'Snow begins overnight — school leaders are watching the 5 AM roads closely.' },
      { t: '2026-01-22T07:00', tF: 28, wind: 8, gust: 15, dir: 30, rain: 0.09, cloud: 1 },
      { t: '2026-01-22T13:00', tF: 29, wind: 10, gust: 18, dir: 30, rain: 0.08, cloud: 1 },
      { t: '2026-01-22T19:00', tF: 30, noseF: 34, wind: 9, gust: 16, dir: 20, rain: 0.05, cloud: 1, note: 'A warm layer aloft briefly mixes in sleet.' },
      { t: '2026-01-23T02:00', tF: 27, wind: 10, gust: 18, dir: 330, rain: 0.01, cloud: 0.8 },
      { t: '2026-01-23T12:00', tF: 33, wind: 8, gust: 16, dir: 310, rain: 0, cloud: 0.3, note: 'Sunshine but slow melting; refreeze tonight will leave black ice.' },
      { t: '2026-01-24T07:00', tF: 18, wind: 3, gust: 6, dir: 300, rain: 0, cloud: 0.05 },
      { t: '2026-01-24T12:00', tF: 36, wind: 4, gust: 8, dir: 280, rain: 0, cloud: 0.05 },
    ],
  },
  {
    id: 'tstorm',
    name: 'Summer flash-flood thunderstorm',
    short: 'Severe storm, lightning, flash flooding',
    start: '2025-07-15T11:00', end: '2025-07-16T10:00',
    init: { soil: 0.6 }, coverage: 0.12,
    summary: 'A humid July afternoon: storms build over the ridges and drift slowly over the valley, dropping 2–3 inches in about an hour. ' +
      'Small creeks rise within minutes — a classic mountain flash flood — while lightning and downburst winds hit the campus.',
    keys: [
      { t: '2025-07-15T11:00', tF: 84, wind: 4, gust: 8, dir: 220, rain: 0, cloud: 0.35 },
      { t: '2025-07-15T14:00', tF: 88, wind: 5, gust: 10, dir: 220, rain: 0, cloud: 0.6, note: 'Towering cumulus build over the Blue Ridge.' },
      { t: '2025-07-15T15:30', tF: 82, wind: 15, gust: 45, dir: 300, rain: 1.2, cloud: 0.95, thunder: 0.9, note: 'Severe storm: frequent lightning, downburst gusts and torrential rain.' },
      { t: '2025-07-15T16:15', tF: 72, wind: 12, gust: 55, dir: 300, rain: 2.6, cloud: 1, thunder: 1, note: 'Flash Flood: 2+ inches per hour. Small creeks rise several feet in minutes.' },
      { t: '2025-07-15T17:15', tF: 71, wind: 8, gust: 22, dir: 280, rain: 0.8, cloud: 1, thunder: 0.6 },
      { t: '2025-07-15T18:30', tF: 72, wind: 5, gust: 10, dir: 260, rain: 0.1, cloud: 0.8, thunder: 0.15 },
      { t: '2025-07-15T21:00', tF: 70, wind: 3, gust: 6, dir: 250, rain: 0, cloud: 0.5 },
      { t: '2025-07-16T06:00', tF: 66, wind: 2, gust: 4, dir: 250, rain: 0, cloud: 0.2, fog: 0.9, note: 'Rain-soaked valleys steam with fog at dawn.' },
      { t: '2025-07-16T10:00', tF: 76, wind: 4, gust: 8, dir: 250, rain: 0, cloud: 0.3, fog: 0 },
    ],
  },
  {
    id: 'fallfog',
    name: 'October valley fog & fall color',
    short: 'Radiation fog in the French Broad valley',
    start: '2025-10-22T03:00', end: '2025-10-23T12:00',
    init: { soil: 0.35 },
    summary: 'On calm, clear autumn nights cold air drains into the French Broad valley and fog forms by dawn, leaving ridge tops ' +
      'poking above a sea of cloud. It burns off by late morning to reveal peak fall color.',
    keys: [
      { t: '2025-10-22T03:00', tF: 44, wind: 1, gust: 3, dir: 0, rain: 0, cloud: 0.05, fog: 0.6 },
      { t: '2025-10-22T06:30', tF: 41, wind: 1, gust: 2, dir: 0, rain: 0, cloud: 0.05, fog: 1, note: 'Dense fog fills the valleys; the ridges stand above it.' },
      { t: '2025-10-22T09:30', tF: 47, wind: 1, gust: 3, dir: 0, rain: 0, cloud: 0.05, fog: 0.95, note: 'The sun rises over a sea of fog. From the ridges, only the mountaintops show.' },
      { t: '2025-10-22T11:00', tF: 56, wind: 3, gust: 6, dir: 250, rain: 0, cloud: 0.05, fog: 0.25, note: 'Sun burns the fog off from the edges inward.' },
      { t: '2025-10-22T12:00', tF: 63, wind: 4, gust: 8, dir: 250, rain: 0, cloud: 0.1, fog: 0 },
      { t: '2025-10-22T16:00', tF: 69, wind: 4, gust: 8, dir: 250, rain: 0, cloud: 0.1 },
      { t: '2025-10-23T06:00', tF: 43, wind: 1, gust: 2, dir: 0, rain: 0, cloud: 0.05, fog: 1 },
      { t: '2025-10-23T12:00', tF: 64, wind: 4, gust: 8, dir: 250, rain: 0, cloud: 0.1, fog: 0 },
    ],
  },
];
