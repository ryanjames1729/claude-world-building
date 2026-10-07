# CDS Weather World

A 3D, real-terrain weather and natural-hazards simulation of **Carolina Day School** (Asheville, NC). It works at two levels: a detailed **5-mile core** around campus and a **30-mile region** around it. It covers the French Broad and Swannanoa river valleys, Biltmore Village, the Biltmore Estate, downtown Asheville and the Blue Ridge to the east.

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

- **Public URL:** GitHub Pages serves the app straight from the `main` branch (Settings → Pages → Deploy from a branch → `main` / root) at `https://ryanjames1729.github.io/claude-world-building/`. The built bundle in `dist/` is committed, so whatever is on `main` is what students see. After changing code, run `npm run build` and commit `dist/` too; CI checks for this. Share that link with students.
- **Install it like an app:** on a phone, open the link, then choose *Share → Add to Home Screen* (iPhone/iPad) or *Install app* (Android/Chrome). It opens full screen with its own icon. After the first visit it also works **offline**, except for the optional OpenStreetMap layer.
- **Locally:** run `npm run dev` and open http://localhost:8000. You can also open `index.html` directly, but offline mode needs it served over http(s).

Phones and tablets automatically get a lighter scene, with fewer trees and particles and a lower render resolution, so it stays smooth. On a computer: drag to orbit, right-drag to pan, scroll to zoom, and press **space** to play or pause. On touch screens: one finger orbits, two fingers zoom and pan. The **Controls** and **Conditions** buttons open panels from the bottom of the screen. The camera buttons jump to the campus, the 5-mile overview, Biltmore Village, the French Broad, downtown or a ridge-top view.

Real roads, traffic signals and neighborhood buildings come from a built-in OpenStreetMap snapshot, so the app works offline.

## Two levels: the 5-mile core and the 30-mile region

- **5-mile core (detailed):** about 34 m terrain, every street, building, traffic signal and car, the campus, street-level flooding and campus operations.
- **30-mile region (outer):** about 200 m terrain out past 30 miles, reaching Mt. Mitchell (6,684 ft), the Craggies, Mt. Pisgah and Cold Mountain. It includes the full river network traced from that terrain (the French Broad from Hendersonville, the Swannanoa through Black Mountain, the Pigeon at Canton, Ivy Creek and the Mills River), towns from Marshall to Brevard and from Canton to Old Fort, and the main highways. The nine weather cams appear on the map as colored beacons with live road conditions.
- **Snow and ice zones** now cover 16 elevation bands up to Mt. Mitchell. In the Blizzard of '93, for example, Mt. Mitchell gets about 4 feet while campus gets about 20 inches.
- **The 🏔 30-mile region camera** shows the whole area. The core's edge blends into the regional terrain so the two levels meet without a step.
- **Regional highways** use approximate alignments until real data is baked in. On a hosted copy, click **⬇ Save 30-mile highway data** under *Regional check*, then run `node scripts/bake-osm.mjs --region data/osm-region-snapshot.json`.

## The campus

The campus is digitized from the official CDS campus map (`docs/campus-map.jpg`). It includes all 10 buildings with their names and uses, plus the North, South and West lots, campus drives, Marberger Field, Neder Playground, the Woodlands, the Middle School outdoor classrooms, and the bordering streets: Hendersonville Rd, Stuyvesant Rd, Green Rd and Stuyvesant Crescent. Data lives in `src/data/campus.js`.

- **Placed by GPS:** four CDS-provided Google Maps pins (Upper School, Marberger Field, Love Hall, Nash Athletic Center) fix the map's position, scale (about 0.49 m per map pixel) and rotation through a least-squares fit. The campus map is a drawing, so individual buildings may sit 10–20 m from their exact spot. The 5-mile radius and terrain are centered on campus.
- **Floors are confirmed by CDS:** the Upper School (5), Love Hall (8) and the Nash Athletic Center (9) have two floors, and the rest are single-story.

## Campus operations tests

The **Campus operations** panel scores three systems every simulated minute as *Normal*, *Watch* or *Critical*, and explains why. Turn on **Hazard view** to see it on the map. Buildings show green for utility power, amber for generator and red for no power. Roads are colored by hazard.

| System | What's simulated |
|---|---|
| **Power** | The campus utility feed fails as area-wide outages, falling trees and high winds rise. Generators keep their buildings running until fuel runs out, and fuel trucks can reach campus only when roads are open. Crews restore power once conditions are safe. |
| **IT & communications** | Internet circuits on utility poles are cut by falling trees, ice and wind. Underground circuits are cut by floods and landslides. The network core runs on battery backup (UPS) and then the generator. Provider equipment fails after hours without area power. PoE desk phones (they lose power with the network), Wi-Fi in unpowered buildings, and cell service (tower batteries and backhaul) are also tracked. |
| **Road safety** | Each stretch of road is checked for flooding (bridges close only when the water rises well above normal), fallen trees and landslides (crews clear main roads in about 2 days and side streets in about 4), snow, and black ice. Bridges and shaded, north-facing curves freeze first. Traffic signals go dark during power outages, and low visibility is flagged. Results are summarized for each family route: Hendersonville Rd north, Hendersonville Rd south, and Biltmore Forest/Stuyvesant. |

## School decisions: 8 PM and 5:30 AM

These follow CDS practice. **At 8 PM** the evening before, the app either announces a closure, flags a possible delay with "final call at 5:30 AM", or expects a normal day. **At 5:30 AM** it makes the final call: open, 2-hour delay or closed. Both calls weigh:
- campus conditions and the forecast (scripted in scenarios; otherwise current weather plus the expected overnight low, to catch refreezing)
- campus power, IT and road-safety status
- a **30-mile regional check** using simulated interstate and highway weather cams: I-26 at Fletcher, Weaverville, Hendersonville and Mars Hill; I-40 at Black Mountain, the Old Fort grade and Canton; US-23/74 at Waynesville; and the Blue Ridge Parkway near Mt. Pisgah. Each cam site has its own elevation, so it can show snow when campus only has rain. Each site can also see river flooding, plowing and closures. Staff and families commute from across this area.

## Traffic

Animated cars follow the road network. Traffic follows weekday rush hours and weekend patterns, and school carpool lines run at drop-off and pickup, shifted 2 hours on delay days. Drivers slow down for rain, snow, ice, fog and dark signals. They stop and turn around at flooded or blocked roads, and use headlights at night and in bad weather. Some slide off on ice: those cars flash their hazard lights. The engine also estimates **simulated crashes** from traffic volume × weather risk, with a typical day of about 6 within 5 miles. These appear in the Road safety card.

**Confirmed by CDS:** the campus has **no generators**, all buildings are linked by **underground fiber**, the network battery lasts **about 30 minutes**, and desk phones are **powered over the network (PoE)**, so they go dark when the network does. With no outside phone line, the app flags when campus has no reliable way to call 911 (desk phones down and cell service failing). Two separate providers (**primary and backup ISP**) enter campus through an **underground fiber vault**; if the primary is cut, traffic fails over to the backup. **Still assumed:** how exposed each provider's line is to poles and trees off campus, whether outside calls need the internet (hosted phone service), and the family route shares. These are in `src/data/campus-ops.js`, and the app labels them as assumed. Ask Facilities and IT to correct them. Keep the details general, because this file ships with the public web app: no IP addresses, equipment models or network diagrams.

**Real roads, signals and neighborhoods:** a snapshot of OpenStreetMap from Oct 6, 2026 is built into the app. It has 1,638 road segments, from interstates down to neighborhood streets, plus 215 traffic signals, 990 building footprints and the CDS property outline. It loads instantly and works offline. It also confirms the GPS placement: the campus entrances land within about 10 m of the real Hendersonville Road, and 9 of 10 campus buildings fall inside the OSM school outline. To refresh it, click **⬇ Save map data** in a build without a baked snapshot, save the file as `data/osm-snapshot.json`, and run `node scripts/bake-osm.mjs`. Map data © OpenStreetMap contributors, available under the Open Database License (ODbL).

## What's modeled

- **Terrain:** real elevation (USGS 3DEP/SRTM via AWS Terrain Tiles, ~34 m grid; spot-checked against ~5 m tiles across campus, which agree within about a meter). Heights are true scale around campus and blend to 1.5× exaggeration beyond about 2 miles, so the gentle campus grades look right while the ridges still read on the 5-mile map. Small creeks under the graded campus are treated as culverts.
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
npm run terrain    # re-download elevation data for both levels (node scripts/build-terrain.mjs inner|region)
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
