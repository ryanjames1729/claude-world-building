// Carolina Day School, 1345 Hendersonville Rd, Asheville NC — campus center fitted to CDS-provided GPS pins.
export const CENTER = { lat: 35.52338, lon: -82.53126 };
export const RADIUS_M = 8046.7;          // 5 miles
export const HALF_EXTENT_M = 8800;       // simulated square extends a little past the 5-mile circle
export const GRID = 512;                 // terrain cells per side (~34 m resolution)
export const REF_ELEV_M = 650;           // weather "station" elevation, roughly campus level
// Regional (outer) level: coarse terrain, rivers, towns and highways out to the 30-mile radius used for the
// 8 PM / 5:30 AM calls. The detailed 5-mile core above sits inside it.
export const REGION_RADIUS_M = 48280;    // 30 miles
export const REGION_HALF_M = 50500;
export const REGION_GRID = 512;          // ~197 m cells
