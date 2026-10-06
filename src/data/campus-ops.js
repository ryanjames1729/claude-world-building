// Campus infrastructure used by the power / IT / road-safety tests.
// ⚠ PLACEHOLDERS: these are reasonable assumptions, not CDS facts. Ask Facilities and IT to correct them.
// Keep it general — this file ships with the public web app. No IP addresses, model numbers or network diagrams.
export const CAMPUS_OPS = {
  assumed: true,
  power: {
    // How exposed the campus utility feed is compared with the average Asheville customer (1 = average).
    feedExposure: 1.0,
    // Backup generators: building id (see campus.js) and hours of fuel on site.
    generators: [
      { building: 8, hours: 24, covers: 'Love Hall network core and offices (assumed)' },
    ],
    // Can fuel be delivered when roads are passable?
    refuelWhenRoadsOpen: true,
  },
  it: {
    networkCoreBuilding: 8,     // building that holds the main network equipment (assumed)
    upsMinutes: 30,             // battery backup for the network core (confirmed by CDS: ~30 minutes)
    // Internet circuits into campus. route: 'aerial' (on utility poles) or 'underground'.
    circuits: [
      { name: 'Primary internet (fiber)', route: 'aerial' },
      { name: 'Backup internet', route: 'aerial' },
    ],
    providerBatteryHours: 6,    // how long the provider's neighborhood equipment runs on batteries in an area outage
    voipPhones: true,           // desk phones depend on campus power + network
    cloudServices: ['Email & documents', 'Student information system', 'Learning management system'],
  },
  roads: {
    // Routes families use, with a rough share of drivers (aggregate only — no addresses).
    routes: [
      { name: 'Hendersonville Rd north (Biltmore Village, I-40, downtown)', share: 0.45, road: 'Hendersonville Rd', side: 'north' },
      { name: 'Hendersonville Rd south (Skyland, Arden, I-26)', share: 0.35, road: 'Hendersonville Rd', side: 'south' },
      { name: 'Biltmore Forest / Stuyvesant Rd', share: 0.2, road: 'Stuyvesant', side: 'west' },
    ],
    trafficSignalsHaveBackup: false,
  },
  decisions: {
    // Confirmed by CDS: calls are made by 8 PM (for the next day) and 5:30 AM, using conditions and interstate
    // weather cams within about 30 miles of campus.
    eveningHour: 20,
    morningHour: 5.5,
    regionRadiusMi: 30,
  },
};
