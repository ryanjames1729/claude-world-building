// Campus infrastructure used by the power / IT / road-safety tests.
// ⚠ PLACEHOLDERS: these are reasonable assumptions, not CDS facts. Ask Facilities and IT to correct them.
// Keep it general — this file ships with the public web app. No IP addresses, model numbers or network diagrams.
export const CAMPUS_OPS = {
  assumed: true,
  power: {
    // How exposed the campus utility feed is compared with the average Asheville customer (1 = average).
    feedExposure: 1.0,
    // Backup generators: building id (see campus.js) and hours of fuel on site.
    // Confirmed by CDS: the campus has no generators.
    generators: [],
    // Can fuel be delivered when roads are passable?
    refuelWhenRoadsOpen: true,
  },
  it: {
    networkCoreBuilding: 8,     // building that holds the main network equipment (assumed)
    // Confirmed by CDS: all buildings are linked by underground fiber, so the campus network itself is not
    // exposed to falling trees or ice — it fails only when buildings lose power (after the UPS runs out).
    backbone: 'underground fiber',
    upsMinutes: 30,             // battery backup for the network core (confirmed by CDS: ~30 minutes)
    // Confirmed by CDS: two separate internet providers — a primary and a backup — both enter campus through an
    // underground fiber vault. Separate providers fail independently, so the backup usually survives a primary cut.
    // ⚠ Assumed: off campus, each provider's line shares some exposure to poles/trees along area roads
    // (upstreamExposure: 0 = fully underground to the provider, 1 = all on poles).
    circuits: [
      { name: 'Primary ISP', role: 'primary', route: 'underground', upstreamExposure: 0.35 },
      { name: 'Backup ISP', role: 'backup', route: 'underground', upstreamExposure: 0.35 },
    ],
    entry: 'underground fiber vault',
    providerBatteryHours: 6,    // how long the provider's neighborhood equipment runs on batteries in an area outage
    phones: {
      // Confirmed by CDS: desk phones are powered over the network (PoE). When the network loses power,
      // every desk phone goes dark with it.
      poe: true,
      // ⚠ Assumed: hosted phone service, so outside calls also need the campus internet connection.
      outsideCallsNeedInternet: true,
    },
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
