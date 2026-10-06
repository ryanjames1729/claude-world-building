// Carolina Day School campus, digitized from the official campus map (docs/campus-map.jpg, 1187×1536 px).
// Coordinates are map pixels: x to the right (east), y down (south). GEOREF turns them into meters on the terrain.
//
// To pin the campus exactly, set two CONTROL_POINTS with real coordinates (e.g. drop pins in Google Maps on the
// front door of Love Hall and the Nash Athletic Center). Until then the map's scale and position are estimates.
export const GEOREF = {
  anchorPx: [700, 560],      // this map pixel sits at the simulation center (CENTER in geo-constants.js)
  // Scale measured against satellite imagery (docs/campus-satellite.png): home plate to the back of the infield
  // dirt on Marberger Field (~47 m on a regulation diamond) and South Lot parking modules (~18 m) both give
  // ~0.31 m per satellite pixel, and the campus map is drawn ~1.18× smaller than that view → ~0.37 m per map pixel.
  metersPerPx: 0.37,          // superseded by the GPS CONTROL_POINTS below (fit ≈ 0.49 m/px)
  rotationDeg: 0,            // the map's north arrow points straight up
};
// GPS pins from CDS (Google Maps), matched to spots on the campus map. With two or more points the map is
// fitted to them by least squares (position, scale, rotation), overriding GEOREF. The campus map is a drawing,
// so individual buildings can sit ~10–20 m from their true spot; the fit uses all pins to balance that out.
export const CONTROL_POINTS = [
  { name: 'Upper School', px: [700, 282], lat: 35.524627, lon: -82.531351 },
  { name: 'Marberger Field (baseball)', px: [400, 492], lat: 35.523712, lon: -82.532926 },
  { name: 'Love Hall (Lower School)', px: [790, 650], lat: 35.522810, lon: -82.530662 },
  { name: 'Nash Athletic Center (rear)', px: [958, 812], lat: 35.522314, lon: -82.530021 },
];

// Floors confirmed by CDS: buildings 5, 8 and 9 have two floors; all others are single-story. `uses` comes straight from the map legend.
export const BUILDINGS = [
  { id: 1, name: 'Business & Community', floors: 1, roof: 'gable',
    uses: ['Advancement', 'Business Office', 'Financial Aid', 'Marketing Communications'],
    poly: [[470, 152], [500, 152], [500, 175], [512, 175], [512, 205], [470, 205]] },
  { id: 2, name: 'Key Lower School Modular', floors: 1, roof: 'flat',
    uses: ['Key Lower School classrooms'], poly: [[540, 178], [585, 178], [585, 222], [540, 222]] },
  { id: 3, name: 'Key House', floors: 1, roof: 'gable',
    uses: ['Key Lower School classrooms', 'Key Learning Center', 'Horizons at Carolina Day offices'],
    poly: [[528, 260], [550, 260], [550, 285], [558, 285], [558, 328], [522, 328], [522, 290], [528, 290]] },
  { id: 4, name: 'Key School Office', floors: 1, roof: 'hip',
    uses: ['Admission for Key School', 'Key School Administration', 'Key Lower School classrooms'],
    poly: [[600, 200], [652, 200], [652, 232], [640, 245], [600, 245]] },
  { id: 5, name: 'Upper School', floors: 2, roof: 'hip',
    uses: ['Admission for Upper School', 'Upper School Auditorium', 'Upper School Classrooms'],
    poly: [[628, 245], [652, 232], [705, 232], [705, 245], [770, 245], [772, 322], [738, 330], [700, 318], [656, 318], [628, 302]] },
  { id: 6, name: 'After Care Building', floors: 1, roof: 'gable',
    uses: ['After Care'], poly: [[495, 700], [530, 700], [530, 745], [495, 745]] },
  { id: 7, name: 'Lovette Hall', floors: 1, roof: 'hip',
    uses: ['Pre-K & Kindergarten classrooms'], poly: [[625, 650], [665, 650], [665, 690], [625, 690]] },
  { id: 8, name: 'Love Hall', floors: 2, roof: 'hip',
    uses: ['Admission for Lower & Middle School', 'Alumni Gym & McCollough Stage', 'Office of the Head of School',
      'Oreck Library', 'Owen Academic Wing (Grades 1–5)', 'Rose Room', 'Wildcat Spirit Store'],
    parts: [
      [[715, 610], [765, 610], [765, 615], [855, 615], [855, 660], [740, 660], [740, 780], [715, 780]],
      [[740, 705], [790, 705], [790, 780], [740, 780]],
      [[790, 685], [855, 685], [855, 730], [790, 730]],
      [[665, 645], [715, 645], [715, 656], [665, 656]],
    ] },
  { id: 9, name: 'Nash Athletic Center', floors: 2, height: 11, roof: 'flat',
    uses: ['Athletic Offices', 'Lasher Weight Room', 'Nash Gym'],
    poly: [[925, 738], [990, 738], [990, 830], [1010, 830], [1010, 885], [985, 885], [985, 875], [925, 875]] },
  { id: 10, name: 'Stephens Hall', floors: 1, roof: 'hip',
    uses: ['Middle School (6–8)', 'Key Middle School (6–8)'],
    poly: [[905, 930], [990, 930], [990, 940], [1025, 940], [1025, 995], [905, 995]] },
];

// Ground surfaces painted onto the terrain (draw order = list order).
export const SURFACES = [
  { kind: 'lawn', poly: [[330, 445], [850, 440], [850, 600], [760, 605], [700, 600], [545, 615], [330, 640]] },
  { kind: 'lawn', poly: [[520, 150], [1000, 150], [1000, 440], [520, 440]] },
  { kind: 'woods', poly: [[400, 720], [480, 700], [560, 690], [700, 700], [720, 790], [800, 790], [880, 800], [910, 900], [900, 1005], [700, 1012], [600, 940], [500, 840], [430, 760]] },
  { kind: 'plaza', poly: [[560, 212], [600, 212], [600, 330], [770, 330], [770, 352], [560, 352]] },
  { kind: 'playground', poly: [[545, 640], [560, 612], [620, 605], [700, 600], [720, 610], [700, 640], [668, 650], [620, 655], [600, 690], [545, 690]] },
  { kind: 'plaza', poly: [[760, 600], [860, 598], [865, 680], [855, 735], [800, 740], [800, 662], [760, 662]] },
  { kind: 'infield', circle: [400, 492, 38] },
  { kind: 'diamond', circle: [400, 492, 18] },
  { kind: 'parking', name: 'North Parking Lot', poly: [[860, 192], [1000, 192], [1000, 392], [860, 392]], rows: 'v' },
  { kind: 'parking', name: 'South Parking Lot', poly: [[870, 495], [990, 495], [990, 690], [870, 690]], rows: 'v' },
  { kind: 'parking', name: 'West Parking Lot', poly: [[430, 255], [518, 255], [518, 355], [430, 355]], rows: 'h' },
  { kind: 'parking', name: 'Upper School lot', poly: [[600, 420], [770, 420], [770, 442], [600, 442]], rows: 'h' },
  { kind: 'outdoor', name: 'Middle School Outdoor Classrooms', circle: [835, 860, 30] },
];

// Campus drives & paths (draped as roads). kind follows OpenStreetMap highway tags.
export const DRIVES = [
  { name: 'North entrance drive', kind: 'service', px: [[1040, 160], [900, 158], [700, 152], [560, 148], [535, 165], [525, 255]] },
  { name: 'North lot drive', kind: 'service', px: [[900, 158], [860, 195], [860, 395], [850, 430]] },
  { name: 'Main entrance', kind: 'service', px: [[1042, 465], [960, 465], [920, 470], [880, 470], [850, 430], [770, 432], [600, 432], [330, 432], [315, 470], [305, 530], [320, 600], [345, 660], [420, 675], [490, 690]] },
  { name: 'Upper School drive', kind: 'service', px: [[600, 432], [595, 380], [620, 358], [760, 358], [775, 400], [770, 432]] },
  { name: 'South lot drive', kind: 'service', px: [[920, 470], [865, 500], [862, 690], [900, 715], [960, 730]] },
  { name: 'South lot exit', kind: 'service', px: [[990, 690], [1044, 650]] },
  { name: 'Stephens Hall drive', kind: 'service', px: [[940, 875], [935, 930]] },
];

// Public streets bordering campus (used when OpenStreetMap is unavailable).
export const STREETS = [
  { name: 'Hendersonville Rd (US-25)', kind: 'primary', px: [[1040, -400], [1040, 60], [1042, 300], [1045, 560], [1060, 760], [1085, 900], [1110, 1020], [1150, 1400]] },
  { name: 'Stuyvesant Rd', kind: 'residential', px: [[140, -200], [130, 370], [118, 600], [105, 860], [100, 875]] },
  { name: 'Stuyvesant Rd', kind: 'residential', px: [[100, 875], [225, 1000], [330, 1120]] },
  { name: 'Stuyvesant Rd', kind: 'residential', px: [[100, 875], [40, 865], [-150, 860]] },
  { name: 'Green Rd', kind: 'residential', px: [[118, 605], [150, 600], [300, 555], [310, 545]] },
  { name: 'Stuyvesant Crescent', kind: 'residential', px: [[100, 875], [150, 862], [200, 800], [250, 720], [300, 700], [350, 705], [400, 740], [500, 840], [600, 935], [690, 1025], [760, 1100]] },
];

export const POINTS = [
  { name: 'St. Genevieve-of-the-Pines Grotto', px: [465, 150] },
  { name: 'Marberger Field', px: [405, 480] },
  { name: 'Neder Playground', px: [600, 625] },
  { name: 'Woodlands', px: [640, 780] },
];
