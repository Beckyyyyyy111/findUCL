// UCL buildings the app knows about. Their real footprints, heights and positions
// come from OpenStreetMap via public/data/map.json (see scripts/build-map.mjs).

// type drives the daily busyness curve in occupancy.js
// floors: listed bottom → top. kind: silent | quiet | group | social | teaching
export const BUILDINGS = [
  {
    id: 'student-centre',
    name: 'Student Centre',
    aliases: ['16 gordon street', 'sc', 'student center'],
    type: 'library',
    popularity: 1.0,
    // Real levels: B2, B1, G, M (Mezzanine), 1–4 — from UCL Library's Student
    // Centre page, the AccessAble guide and UCL News (checked Oct 2026).
    floors: [
      { label: 'B2', kind: 'services', zones: ['Contemplation rooms', 'Showers & ablutions', 'Smart lockers'], water: true },
      { label: 'B1', kind: 'quiet', zones: ['Social Study Room B1.01', 'Quiet study (bookable)', 'Printers B1.06'] },
      { label: 'G', kind: 'social', zones: ['Reception', 'Tiered steps', 'Open tables'] },
      { label: 'M', kind: 'group', zones: ['Student Help Point', 'Open study tables', 'Smart lockers'] },
      { label: '1', kind: 'group', zones: ['Student Enquiries Centre', 'Support & Wellbeing', 'Open study'] },
      { label: '2', kind: 'quiet', zones: ['Quiet study (bookable)', 'Group rooms', 'Silent desks'] },
      { label: '3', kind: 'quiet', zones: ['Café', 'Quiet study (bookable)', 'Group rooms'], water: true },
      { label: '4', kind: 'group', zones: ['Terrace', 'Social study tables', 'Group room'] },
    ],
  },
  {
    id: 'main-library',
    name: 'Main Library (Wilkins)',
    aliases: ['main library', 'wilkins', 'portico', 'library'],
    type: 'library',
    popularity: 0.9,
    floors: [
      { label: 'G', kind: 'quiet', zones: ['Reading room', 'Catalogue', 'Desks'] },
      { label: '1', kind: 'silent', zones: ['Donaldson Room', 'Stacks', 'Desks'] },
      { label: '2', kind: 'silent', zones: ['Stacks', 'Carrels', 'Desks'] },
      { label: '3', kind: 'quiet', zones: ['Periodicals', 'Desks', 'PCs'] },
    ],
  },
  {
    id: 'science-library',
    name: 'Science Library (DMS Watson)',
    aliases: ['science library', 'dms watson', 'malet place'],
    type: 'library',
    popularity: 0.85,
    floors: [
      { label: 'B', kind: 'group', zones: ['Group tables', 'PCs', 'Printers'] },
      { label: 'G', kind: 'social', zones: ['Entrance', 'Help desk', 'PC cluster'] },
      { label: '1', kind: 'quiet', zones: ['Desks', 'Stacks', 'Carrels'] },
      { label: '2', kind: 'quiet', zones: ['Desks', 'Stacks', 'Carrels'] },
      { label: '3', kind: 'silent', zones: ['Silent study', 'Stacks', 'Carrels'] },
      { label: '4', kind: 'silent', zones: ['Silent study', 'Window seats', 'Carrels'] },
    ],
  },
  {
    id: 'ioe',
    name: 'IOE – 20 Bedford Way',
    aliases: ['ioe', 'institute of education', 'bedford way', 'newsam library', 'jeffery hall'],
    type: 'library',
    popularity: 0.7,
    floors: [
      { label: '1', kind: 'teaching', zones: ['Jeffery Hall', 'Lecture rooms', 'Foyer'] },
      { label: '2', kind: 'social', zones: ['Café', 'Bookshop', 'Seating'] },
      { label: '3', kind: 'quiet', zones: ['Newsam Library', 'PCs', 'Desks'] },
      { label: '4', kind: 'silent', zones: ['Newsam Library', 'Stacks', 'Carrels'] },
      { label: '5', kind: 'silent', zones: ['Newsam Library', 'Archives', 'Carrels'] },
      { label: '6', kind: 'teaching', zones: ['Seminar rooms', 'Offices', 'Study nook'] },
    ],
  },
  {
    id: 'cruciform',
    name: 'Cruciform Hub',
    aliases: ['cruciform', 'medical library', 'gower street'],
    type: 'library',
    popularity: 0.75,
    floors: [
      { label: 'B', kind: 'group', zones: ['Hub tables', 'PC cluster', 'Booths'] },
      { label: 'G', kind: 'teaching', zones: ['Lecture theatre', 'Foyer', 'Seminar rooms'] },
      { label: '1', kind: 'quiet', zones: ['Quiet study', 'Desks', 'Carrels'] },
    ],
  },
  {
    id: 'senate-house',
    name: 'Senate House Library',
    aliases: ['senate house', 'senate'],
    type: 'library',
    popularity: 0.55,
    floors: [
      { label: 'G', kind: 'social', zones: ['Foyer', 'Café', 'Seating'] },
      { label: '1', kind: 'teaching', zones: ['Events', 'Offices', 'Seminar rooms'] },
      { label: '4', kind: 'quiet', zones: ['Reading room', 'Desks', 'PCs'] },
      { label: '5', kind: 'silent', zones: ['Reading room', 'Stacks', 'Carrels'] },
      { label: '6', kind: 'silent', zones: ['Reading room', 'Stacks', 'Carrels'] },
    ],
  },
  {
    id: 'kathleen-lonsdale',
    name: 'Kathleen Lonsdale Building',
    aliases: ['kathleen lonsdale', 'klb', 'gower place'],
    type: 'teaching',
    popularity: 0.6,
    floors: [
      { label: 'G', kind: 'social', zones: ['Foyer', 'Seating', 'Vending'] },
      { label: '1', kind: 'teaching', zones: ['Labs', 'Seminar rooms', 'Study nook'] },
      { label: '2', kind: 'teaching', zones: ['Labs', 'Offices', 'Study nook'] },
      { label: '3', kind: 'quiet', zones: ['Study room', 'Offices', 'Desks'] },
    ],
  },
  {
    id: 'christopher-ingold',
    name: 'Christopher Ingold Building',
    aliases: ['christopher ingold', 'chemistry', 'cib'],
    type: 'teaching',
    popularity: 0.55,
    floors: [
      { label: 'G', kind: 'teaching', zones: ['XLG lecture theatres', 'Foyer', 'Seating'] },
      { label: '1', kind: 'teaching', zones: ['Labs', 'Seminar rooms', 'Desks'] },
      { label: '2', kind: 'quiet', zones: ['Study area', 'Offices', 'Desks'] },
      { label: '3', kind: 'teaching', zones: ['Labs', 'Offices', 'Desks'] },
    ],
  },
  {
    id: 'bloomsbury-theatre',
    name: "Bloomsbury Theatre & Students' Union",
    aliases: ['bloomsbury theatre', 'students union', 'su', '15 gordon street', 'print room'],
    type: 'social',
    popularity: 0.8,
    floors: [
      { label: 'G', kind: 'social', zones: ['Print Room Café', 'Box office', 'Seating'] },
      { label: '1', kind: 'social', zones: ['Theatre', 'Bar', 'Seating'] },
      { label: '2', kind: 'group', zones: ['Society rooms', 'Tables', 'Booths'] },
    ],
  },
  {
    id: 'gordon-street-22',
    name: '22 Gordon Street (Bartlett)',
    aliases: ['22 gordon street', 'bartlett', 'architecture'],
    type: 'teaching',
    popularity: 0.65,
    floors: [
      { label: 'G', kind: 'social', zones: ['Café', 'Gallery', 'Seating'] },
      { label: '1', kind: 'group', zones: ['Studios', 'Tables', 'Model shop'] },
      { label: '2', kind: 'group', zones: ['Studios', 'Tables', 'Crit space'] },
      { label: '3', kind: 'quiet', zones: ['Library', 'Desks', 'Carrels'] },
      { label: '4', kind: 'group', zones: ['Studios', 'Tables', 'Offices'] },
    ],
  },
  {
    id: 'engineering-front',
    name: 'Engineering Front Building',
    aliases: ['engineering', 'engineering front', 'efb'],
    type: 'teaching',
    popularity: 0.6,
    floors: [
      { label: 'G', kind: 'teaching', zones: ['Lecture theatre', 'Foyer', 'Seating'] },
      { label: '1', kind: 'group', zones: ['Project space', 'Tables', 'Labs'] },
      { label: '2', kind: 'teaching', zones: ['Labs', 'Offices', 'Study nook'] },
    ],
  },
  {
    id: 'roberts',
    name: 'Roberts Building',
    aliases: ['roberts', 'torrington place'],
    type: 'teaching',
    popularity: 0.6,
    floors: [
      { label: 'G', kind: 'teaching', zones: ['Lecture theatres', 'Foyer', 'Seating'] },
      { label: '1', kind: 'teaching', zones: ['Seminar rooms', 'Offices', 'Study nook'] },
      { label: '3', kind: 'group', zones: ['Study space', 'Tables', 'PCs'] },
      { label: '5', kind: 'quiet', zones: ['Quiet desks', 'Offices', 'Carrels'] },
    ],
  },
  {
    id: 'bentham-house',
    name: 'Bentham House (Laws)',
    aliases: ['bentham house', 'laws', 'law library', 'endsleigh gardens'],
    type: 'library',
    popularity: 0.6,
    floors: [
      { label: 'G', kind: 'social', zones: ['Foyer', 'Café', 'Seating'] },
      { label: '1', kind: 'teaching', zones: ['Moot court', 'Seminar rooms', 'Desks'] },
      { label: '2', kind: 'quiet', zones: ['Law library', 'Desks', 'PCs'] },
      { label: '3', kind: 'silent', zones: ['Law library', 'Stacks', 'Carrels'] },
    ],
  },

  // ---- UCL East (Queen Elizabeth Olympic Park). Drawn 2.5 km east of Bloomsbury instead of the real ~8 km.
  {
    id: 'marshgate',
    campus: 'east',
    name: 'Marshgate (UCL East)',
    aliases: ['marshgate', 'ucl east', 'stratford', 'olympic park'],
    type: 'library',
    popularity: 0.6,
    floors: [
      { label: 'G', kind: 'social', zones: ['Atrium', 'Café', 'Seating'] },
      { label: '1', kind: 'teaching', zones: ['Lecture theatre', 'Seminar rooms', 'Foyer'] },
      { label: '2', kind: 'group', zones: ['Project space', 'Tables', 'Booths'] },
      { label: '3', kind: 'quiet', zones: ['Study space', 'Desks', 'Window seats'] },
      { label: '4', kind: 'teaching', zones: ['Labs', 'Workshops', 'Study nook'] },
      { label: '5', kind: 'group', zones: ['Studios', 'Tables', 'Crit space'] },
      { label: '6', kind: 'quiet', zones: ['Study space', 'Desks', 'Carrels'] },
      { label: '7', kind: 'silent', zones: ['Silent study', 'Window seats', 'Carrels'] },
    ],
  },
  {
    id: 'one-pool-street',
    campus: 'east',
    name: 'One Pool Street (UCL East)',
    aliases: ['one pool street', 'pool street', 'ucl east'],
    type: 'teaching',
    popularity: 0.5,
    floors: [
      { label: 'G', kind: 'social', zones: ['Foyer', 'Café', 'Seating'] },
      { label: '1', kind: 'teaching', zones: ['Labs', 'Seminar rooms', 'Study nook'] },
      { label: '2', kind: 'group', zones: ['Hub tables', 'Booths', 'PCs'] },
      { label: '3', kind: 'quiet', zones: ['Study space', 'Desks', 'Carrels'] },
    ],
  },
];

// Map frame of each campus (local metres from map.json) plus the real-world
// anchor used to place phone GPS on the map.
export const CAMPUSES = {
  bloomsbury: {
    name: 'Bloomsbury',
    target: [140, 40],
    ground: { x: 80, z: 110, w: 1500, d: 1600 },
    anchor: { x: 0, z: 0, lat: 51.5246, lng: -0.134 },
  },
  east: {
    name: 'UCL East',
    target: [2500, 20],
    park: true,
    ground: { x: 2500, z: 0, w: 900, d: 900 },
    anchor: { x: 2500, z: 0, lat: 51.5383, lng: -0.0118 },
  },
};

export const campusOf = (b) => b.campus ?? 'bloomsbury';

// Real centres/heights come from public/data/map.json (OpenStreetMap).
export function setMapGeometry(map) {
  for (const b of BUILDINGS) {
    const g = map.ucl[b.id];
    if (g) b.geo = g;
    b.footprint = map.footprints?.[b.id];
  }
  // Every other UCL teaching/department building from OSM, with a generic floor
  // plan (teaching rooms, no dedicated study space) so it can still be searched,
  // clicked and given a crowd estimate. Halls of residence are map labels only.
  for (const x of map.uclExtra ?? []) {
    if (x.kind !== 'dept' || BUILDINGS.some((b) => b.id === x.id)) continue;
    const n = Math.max(2, Math.min(10, Math.round(x.levels ?? 4)));
    BUILDINGS.push({
      id: x.id,
      campus: x.campus,
      name: x.name,
      aliases: [x.name.toLowerCase()],
      type: 'teaching',
      popularity: x.named ? 0.5 : 0.35,
      generic: true,
      minor: !x.named,
      geo: map.ucl[x.id],
      footprint: map.footprints?.[x.id],
      floors: Array.from({ length: n }, (_, i) => ({
        label: i === 0 ? 'G' : String(i),
        kind: 'teaching',
        zones: i === 0 ? ['Foyer', 'Teaching rooms', 'Offices'] : ['Teaching rooms', 'Offices', 'Labs'],
      })),
    });
  }
}

export function latLngToLocal(lat, lng) {
  let best = null;
  for (const [id, c] of Object.entries(CAMPUSES)) {
    const kx = Math.cos((c.anchor.lat * Math.PI) / 180) * 111320;
    const x = c.anchor.x + (lng - c.anchor.lng) * kx;
    const z = c.anchor.z - (lat - c.anchor.lat) * 110574;
    const dist = Math.hypot(x - c.anchor.x, z - c.anchor.z);
    if (!best || dist < best.dist) best = { campus: id, x, z, dist };
  }
  return best;
}

export function buildingCentre(b) {
  return b.geo ? { x: b.geo.x, z: b.geo.z } : { x: 0, z: 0 };
}

// Rough walking minutes: straight line × 1.3 for street detours, 80 m/min.
// Between campuses it's a tube ride, ~40 min.
export function walkMinutes(from, b) {
  if (!from) return null;
  if (from.campus !== campusOf(b)) return 40;
  const c = buildingCentre(b);
  return Math.max(1, Math.round((Math.hypot(c.x - from.x, c.z - from.z) * 1.3) / 80));
}

// ---------- Booking: what can be booked where, and the official link ----------
// Compiled from UCL Library, Senate House Library, Students' Union UCL and UCL
// Estates pages (checked 15 Oct 2026). Rules, not live availability.
export const BOOKING_CHECKED = '15 Oct 2026';
const LINK = {
  libBook: { label: 'Book in the UCL Library booking system', url: 'https://library-calendars.ucl.ac.uk/r/new' },
  libList: { label: 'List of bookable spaces', url: 'https://www.ucl.ac.uk/library/using-library/libraries-and-study-spaces/bookable-study-spaces-help/bookable-study-spaces-list' },
  shl: { label: 'Senate House Library: book a group room or carrel', url: 'https://www.london.ac.uk/about/services/senate-house-library/using-library/reading-rooms-study-spaces' },
  su: { label: "Students' Union: how to book union rooms", url: 'https://studentsunionucl.org/how-to/clubs-and-societies/how-to-book-union-room' },
  suEast: { label: 'Booking spaces at UCL East', url: 'https://studentsunionucl.org/booking-spaces-at-ucl-east' },
  estates: { label: 'UCL Estates: room bookings', url: 'https://www.ucl.ac.uk/estates/our-services/room-bookings/book-room' },
};
const LIB_RULES = 'Book up to 3 days ahead (opens 12:00), max 7 h a day, check in within 30 min or it is released. Most other desks: first come, first served.';
const LIB_SRC = 'UCL Library booking system & help pages';

export const BOOKING = {
  'student-centre': {
    bookable: true,
    what: 'Quiet study areas on B1, levels 2 and 3 (incl. Social Study Room B1.01, 40 desks) and Graduate Hub group rooms (postgraduates) are bookable. Ground floor, Mezzanine and other open areas: first come, first served.',
    rules: LIB_RULES, links: [LINK.libBook, LINK.libList], source: LIB_SRC,
  },
  'science-library': { bookable: true, what: 'Bookable study spaces in the Science Library.', rules: LIB_RULES, links: [LINK.libBook, LINK.libList], source: LIB_SRC },
  ioe: { bookable: true, what: 'IOE Library: bookable quiet desks and the Kenyon Study Room.', rules: LIB_RULES, links: [LINK.libBook, LINK.libList], source: LIB_SRC },
  cruciform: { bookable: true, what: 'Cruciform Hub: group study rooms and pods.', rules: LIB_RULES, links: [LINK.libBook, LINK.libList], source: LIB_SRC },
  'gordon-street-22': { bookable: true, what: 'Bartlett Library: bookable study spaces.', rules: LIB_RULES, links: [LINK.libBook, LINK.libList], source: LIB_SRC },
  marshgate: {
    bookable: true,
    what: 'UCL East Library (Marshgate): bookable study spaces. The Project Space and booths need no booking (not a quiet zone).',
    rules: LIB_RULES, links: [LINK.libBook, LINK.suEast], source: `${LIB_SRC}; Students' Union UCL`,
  },
  'institute-of-archaeology': { bookable: true, what: 'Institute of Archaeology Library: bookable study spaces.', rules: LIB_RULES, links: [LINK.libBook, LINK.libList], source: LIB_SRC },
  'senate-house': {
    bookable: true,
    what: 'Group study rooms (BLOOM area, Mon–Fri 8:00–18:00; South Reading Room, 5th floor), private carrels and the accessibility suite. Reading-room desks on floors 4–7 need no booking.',
    rules: '1–3 hour slots, max 10 h a week. Register for free Senate House Library membership first (University of London students incl. UCL).',
    links: [LINK.shl], source: 'Senate House Library (University of London)',
  },
  'main-library': {
    bookable: false,
    what: 'No bookable rooms listed for the Main Library: desks are first come, first served. Nearest bookable rooms: Cruciform Hub or Science Library.',
    links: [LINK.libList], source: LIB_SRC,
  },
  'bentham-house': {
    bookable: false,
    what: 'No bookable study rooms listed (law library desks are first come, first served).',
    links: [LINK.libList], source: LIB_SRC,
  },
  'bloomsbury-theatre': {
    bookable: true,
    what: 'Union rooms (e.g. the Bloomsbury Theatre Conference Room) for clubs & societies. Only a society president or treasurer can book.',
    rules: 'Provisional until the Union approves; book AV 10 working days ahead.',
    links: [LINK.su], source: "Students' Union UCL",
  },
  'one-pool-street': {
    bookable: false,
    what: 'Study spaces and the Social Commons (levels 1–2) are open to all UCL members, no booking needed.',
    links: [LINK.suEast], source: "UCL East FAQs; Students' Union UCL",
  },
};
// Teaching buildings: rooms are booked by staff (and Union officers), not students.
const TEACHING_BOOKING = {
  bookable: false,
  what: 'Teaching rooms are booked by UCL staff and Students\' Union officers, not individual students. For a group room try a library (Cruciform Hub, Science Library, IOE).',
  links: [LINK.estates, LINK.libBook], source: 'UCL Estates; UCL Library',
};
export function bookingFor(b) {
  return BOOKING[b.id] ?? (b.type === 'teaching' ? TEACHING_BOOKING : { bookable: false, what: 'No bookable spaces found for this building.', links: [LINK.libList], source: LIB_SRC });
}

// UCL Library's official live seat counts (behind a browser check, so we link rather than read it).
export const LIVE_SEATS_URL = 'https://www.ucl.ac.uk/library/forms/indigo-seat-availability.php?loc=all';
const LIBRARY_RUN = new Set(['student-centre', 'science-library', 'ioe', 'cruciform', 'gordon-street-22', 'marshgate', 'main-library', 'institute-of-archaeology']);
export const hasOfficialSeatCounts = (b) => LIBRARY_RUN.has(b.id);

// Charging & drinking water. There's no public per-floor data, so this is a
// first guess from the building type (recent buildings wire most desks), shown
// as an estimate until students confirm or correct it in the app.
// A floor can override with { power: 'most' | 'some' | 'few', water: true | false }.
const MODERN = new Set(['student-centre', 'gordon-street-22', 'marshgate', 'one-pool-street']);
export function amenityEstimate(b, i) {
  const floor = b.floors[i];
  const modern = MODERN.has(b.id);
  const power =
    floor.power ??
    { silent: modern ? 'most' : 'some', quiet: modern ? 'most' : 'some', group: modern ? 'most' : 'some', social: 'some', teaching: 'few', services: 'few' }[floor.kind];
  // Refill points: always on the ground floor, on every floor of new buildings,
  // every other floor of libraries.
  const water = floor.water ?? (i === 0 || (b.type !== 'teaching' && (modern || i % 2 === 0)));
  return { power, water };
}

export const POWER_LABEL = { most: 'Sockets at most desks', some: 'Sockets at some desks', few: 'Few or no sockets' };

export const FLOOR_KIND_LABEL = {
  silent: 'Silent study',
  quiet: 'Quiet study',
  group: 'Group study',
  social: 'Social space',
  teaching: 'Teaching',
  services: 'Facilities',
};

export function findBuilding(id) {
  return BUILDINGS.find((b) => b.id === id);
}

export function searchBuildings(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return BUILDINGS.filter(
    (b) => b.name.toLowerCase().includes(q) || b.aliases.some((a) => a.includes(q) || q.includes(a)),
  );
}
