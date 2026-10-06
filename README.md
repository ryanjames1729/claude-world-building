# CDS Weather World

A 3D, real-terrain weather and natural-hazards simulation of **Carolina Day School** (Asheville, NC) and everything within a **5-mile radius** of campus. It covers the French Broad and Swannanoa river valleys, Biltmore Village, the Biltmore Estate, downtown Asheville and the Blue Ridge to the east.

You can run Asheville's normal day-to-day climate, take manual control of the weather, or replay historic-inspired events:

| Scenario | What you'll see |
|---|---|
| **Hurricane Helene (Sep 2024)** | The predecessor rain event, then Helene's core: ~16" of rain and 60–70 mph gusts. Creeks flash-flood, the Swannanoa and French Broad reach record crests (sim ≈ 26.5 ft and 24.6 ft vs. the real ≈ 26 ft and 24.67 ft), Biltmore Village and the River Arts District flood, slopes fail, trees fall and the power goes out. |
| **Blizzard of '93 (Mar 1993)** | Thunder-snow, near-blizzard winds, ~20" on campus with more on the ridges, then bitter cold. |
| **Ice storm (Dec 2005-style)** | Cold-air damming: freezing rain glazes everything, ice accretion snaps limbs and lines. |
| **January snowstorm** | A classic Gulf-low 6–10" event with a late sleet mix and black ice the next morning. |
| **Summer flash-flood thunderstorm** | Lightning, downbursts and 2"+/hr rain: creeks spike in minutes, but the French Broad barely moves. |
| **October valley fog & fall color** | Radiation fog fills the valleys, so only the ridges poke above a "sea of clouds"; peak fall color. |

## Running it (computer, phone or tablet)

CDS Weather World is a web app. It runs in any modern browser (Chrome, Edge, Safari, Firefox) on a computer, phone or tablet. There's nothing to install.

- **Public URL (recommended):** once this repo is on `main`, the included GitHub Actions workflow builds, tests and publishes it to GitHub Pages at `https://<user>.github.io/claude-video-testing/`. One-time setup: **Settings → Pages → Source: GitHub Actions**. Share that link with students.
- **Install it like an app:** on a phone, open the link, then choose *Share → Add to Home Screen* (iPhone/iPad) or *Install app* (Android/Chrome). It opens full screen with its own icon. After the first visit it also works **offline**, except for the optional OpenStreetMap layer.
- **Locally:** run `npm run dev` and open http://localhost:8000. You can also open `index.html` directly, but offline mode needs it served over http(s).

Phones and tablets automatically get a lighter scene, with fewer trees and particles and a lower render resolution, so it stays smooth. On a computer: drag to orbit, right-drag to pan, scroll to zoom, and press **space** to play or pause. On touch screens: one finger orbits, two fingers zoom and pan. The **Controls** and **Conditions** buttons open panels from the bottom of the screen. The camera buttons jump to the campus, the 5-mile overview, Biltmore Village, the French Broad, downtown or a ridge-top view.

When the browser is online, the app also loads **real roads and building footprints from OpenStreetMap**, which replace the schematic campus and the approximate highway lines.

## What's modeled

- **Terrain:** real elevation (USGS 3DEP/SRTM via AWS Terrain Tiles, ~34 m grid), with 1.5× vertical exaggeration.
- **Rivers and flooding:** creeks and rivers are traced from the terrain (priority-flood fill, D8 flow routing and flow accumulation, plus upstream inflow for rivers that enter the map). Flood extent uses **HAND (Height Above Nearest Drainage)**, the method used for rapid flood-inundation mapping. Runoff depends on soil saturation and feeds linear-reservoir models: creeks respond in under an hour, the French Broad over about a day. Mud is left behind where floodwater receded.
- **Elevation-aware weather:** temperature falls ~3.5 °F per 1,000 ft, ridges get extra rain and snow (orographic lift), and calm, clear nights form cold-air pools in the valleys. Snow depth and ice accretion are tracked in eight elevation bands, so the ridges can be white while campus is wet.
- **Precipitation type:** decided from the surface temperature and a warm layer aloft. That gives rain, snow, sleet, or freezing rain (the cold-air-damming setup).
- **Seasons and sky:** real sun position for every date and time. Spring green-up climbs the slopes and fall color comes down from the ridges.
- **Impacts:** wind and ice knock down trees (worse in saturated soil), which drives power outages; city lights go dark during outages. Landslides happen on steep, saturated slopes. Each road is classed as open, flooded, blocked, snowy or icy.
- **School operations:** at **5:30 AM** on school days the simulation decides whether CDS opens on time, opens on a 2-hour delay or closes, and gives its reasons. In scenarios the decision also uses the forecast.
- **Simulated NWS-style alerts:** for example Flash Flood Emergency, River Flood Warning, Tropical Storm Warning, Ice Storm Warning, Blizzard Warning and Dense Fog Advisory.

> Scenario timelines are approximate reconstructions for teaching, not official observations. Alerts and school decisions are simulated. The campus layout is schematic unless OpenStreetMap data loads.

## Developing

```bash
npm install
npm run dev        # rebuild on change + local server at http://localhost:8000
npm run build      # production bundle -> dist/cds-weather-world.js
npm test           # simulation/calibration tests (Node)
npm run terrain    # re-download elevation data (e.g. after moving the center point)
```

Code map:

- `src/geo-constants.js`: campus coordinates, radius, grid size.
- `src/sim/`: the simulation core, plain JavaScript with no rendering (it's what the tests cover).
  - `engine.js`: weather state, snow/ice bands, soil, rivers, impacts, alerts, school decisions.
  - `climate.js`: Asheville normals and the automatic weather generator.
  - `scenarios.js`: the historic-inspired events. Add your own by copying an entry.
  - `hydrology.js`: stream network and HAND flood mapping.
- `src/render/`: Three.js scene pieces (terrain, water, sky and clouds, precipitation, trees, campus, roads, OpenStreetMap loader, labels).
- `src/ui.js`: panels, alerts, school status and the 72-hour chart.

Ideas for classes: compare the flood extent in Helene with photos of Biltmore Village, change `SOIL_CAP_MM` or a river's `tau` in `engine.js` and see how the crest changes, or design a new scenario from NWS archives.
