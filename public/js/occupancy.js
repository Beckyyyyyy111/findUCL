// Occupancy per floor, from the best source available:
//   1. real desk-sensor counts from UCL API (when the server has a token)
//   2. otherwise a simulated model (daily curve × floor type × height),
//      deterministic per 10-minute slot so every viewer sees the same numbers
// …then nudged by students' crowd reports and phone noise readings, which the
// server shares between everyone.

import { BUILDINGS, amenityEstimate, bookingFor, campusOf, walkMinutes } from './data.js';

// Hourly busyness 0..1 by building type, index = hour of day.
const CURVES = {
  library: [.05,.03,.02,.02,.02,.03,.05,.1,.3,.55,.72,.82,.86,.88,.92,.95,.9,.78,.65,.55,.45,.35,.2,.1],
  teaching: [0,0,0,0,0,0,.02,.08,.35,.7,.85,.8,.65,.8,.85,.75,.6,.4,.2,.1,.05,.02,0,0],
  social: [.02,0,0,0,0,0,.02,.1,.3,.45,.5,.6,.9,.85,.6,.55,.6,.7,.75,.7,.55,.4,.2,.05],
};

// How each floor kind deviates from the building's overall level.
const KIND_FACTOR = { social: 1.15, group: 1.1, teaching: 1.0, quiet: 0.92, silent: 0.85, services: 0.45 };
// Base noise (dB-ish) for an empty room and how much people add.
const KIND_NOISE = {
  social: [48, 28], group: [42, 24], teaching: [38, 22], quiet: [32, 14], silent: [28, 8], services: [30, 10],
};

let shared = { live: { source: 'simulated', floors: {} }, reports: [], noise: [], checkins: [], amenities: [] };
export function setShared(state) {
  shared = state;
}
export const liveSource = () => shared.live;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function curveAt(type, date) {
  const c = CURVES[type] ?? CURVES.library;
  const h = date.getHours() + date.getMinutes() / 60;
  const i = Math.floor(h) % 24;
  const t = h - Math.floor(h);
  return c[i] * (1 - t) + c[(i + 1) % 24] * t;
}

function slotKey(date) {
  return `${date.toDateString()}-${date.getHours()}-${Math.floor(date.getMinutes() / 10)}`;
}

// Crowd-sourced signals only describe "now", never forecasts.
const isNow = (date) => Math.abs(date - Date.now()) < 15 * 60 * 1000;

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

export function reportCount(buildingId) {
  return shared.reports.filter((r) => r.buildingId === buildingId).length;
}

// Student reports fade out over 45 minutes.
const REPORT_TTL = 45 * 60 * 1000;
const weight = (r) => Math.max(0, 1 - (Date.now() - r.at) / REPORT_TTL);
// Older clients sent { level: ±1 } instead of a kind.
const kindOf = (r) => r.kind ?? (r.level > 0 ? 'crowded' : 'seats');

export function floorReports(buildingId, floorLabel) {
  return shared.reports
    .filter((r) => r.buildingId === buildingId && (!r.floor || r.floor === floorLabel))
    .map((r) => ({ ...r, kind: kindOf(r) }))
    .sort((x, y) => y.at - x.at);
}

const isFresh = (r) => Date.now() - r.at < 15 * 60 * 1000;
const latest = (list) => (list.length ? Math.max(...list.map((x) => x.at)) : null);

export function floorStats(building, floorIndex, date = new Date()) {
  const floor = building.floors[floorIndex];
  const now = isNow(date);
  const sensor = now ? shared.live.floors?.[building.id]?.[floor.label] : null;
  const reports = now ? floorReports(building.id, floor.label) : [];
  const crowdReports = reports.filter((r) => r.kind === 'crowded' || r.kind === 'seats');
  const noiseReports = reports.filter((r) => r.kind === 'noisy' || r.kind === 'quiet');

  // ---- crowd level
  let occ;
  let occSource;
  if (sensor && sensor.total > 0) {
    occ = sensor.occupied / sensor.total;
    occSource = { kind: 'sensor', label: 'UCL desk sensors', updatedAt: shared.live.updatedAt };
  } else {
    const base = curveAt(building.type, date) * building.popularity;
    // Ground floors catch passers-by; upper floors are a hike.
    const heightF = 1.08 - (floorIndex / Math.max(1, building.floors.length - 1)) * 0.22;
    const jitter = (hash(`${building.id}|${floor.label}|${slotKey(date)}`) - 0.5) * 0.28;
    occ = base * KIND_FACTOR[floor.kind] * heightF + jitter;
    const slot = new Date(date);
    slot.setMinutes(Math.floor(slot.getMinutes() / 10) * 10, 0, 0);
    occSource = { kind: 'model', label: now ? 'Time-of-day estimate' : 'Forecast', updatedAt: slot.getTime() };
  }
  // Students on the spot beat the model: each report shifts the estimate, and a
  // fresh one (< 15 min) sets a floor/ceiling so the change is clearly visible.
  for (const r of crowdReports) occ += (r.kind === 'crowded' ? 1 : -1) * (r.floor ? 0.2 : 0.08) * weight(r);
  const freshCrowd = crowdReports.filter(isFresh);
  const freshCrowded = freshCrowd.filter((r) => r.kind === 'crowded').length;
  const freshSeats = freshCrowd.length - freshCrowded;
  if (freshCrowded > freshSeats) occ = Math.max(occ, freshCrowded >= 2 ? 0.9 : 0.8);
  if (freshSeats > freshCrowded) occ = Math.min(occ, freshSeats >= 2 ? 0.45 : 0.6);
  occ = clamp(occ, 0.02, 0.99);

  // ---- noise
  const [n0, nRange] = KIND_NOISE[floor.kind];
  let noise = n0 + nRange * occ + (hash(`n|${building.id}|${floor.label}|${slotKey(date)}`) - 0.5) * 4;
  const samples = now ? shared.noise.filter((x) => x.buildingId === building.id && x.floor === floor.label) : [];
  if (samples.length) {
    const measured = samples.reduce((sum, x) => sum + x.db, 0) / samples.length;
    noise = noise * 0.3 + measured * 0.7;
  }
  for (const r of noiseReports) noise += (r.kind === 'noisy' ? 10 : -8) * weight(r);
  const freshNoise = noiseReports.filter(isFresh);
  const freshNoisy = freshNoise.filter((r) => r.kind === 'noisy').length;
  const freshQuiet = freshNoise.length - freshNoisy;
  if (freshNoisy > freshQuiet) noise = Math.max(noise, freshNoisy >= 2 ? 57 : 49); // at least "Chatty", two → "Loud"
  if (freshQuiet > freshNoisy) noise = Math.min(noise, freshQuiet >= 2 ? 33 : 39); // at most "Calm", two → "Silent"
  noise = Math.round(Math.max(22, Math.min(85, noise)));
  const noiseSource = samples.length
    ? { kind: 'measured', label: `${samples.length} phone mic reading${samples.length === 1 ? '' : 's'}`, updatedAt: latest(samples) }
    : { kind: 'model', label: 'Estimated from crowd level', updatedAt: occSource.updatedAt };

  const zones = floor.zones.map((name, zi) => {
    const zj = (hash(`${building.id}|${floor.label}|${zi}|${slotKey(date)}`) - 0.5) * 0.35;
    return { name, occupancy: clamp(occ + zj, 0.02, 0.99) };
  });

  const seats = sensor?.total || (floor.kind === 'teaching' ? 40 : floor.kind === 'services' ? 20 : floor.kind === 'social' ? 80 : 120);
  const here = now ? shared.checkins.filter((c) => c.buildingId === building.id && c.floor === floor.label) : [];
  return {
    label: floor.label,
    kind: floor.kind,
    occupancy: occ,
    live: occSource.kind === 'sensor',
    occSource,
    noise,
    noiseSource,
    noiseMeasured: samples.length,
    seatsFree: Math.round(seats * (1 - occ)),
    seatsTotal: seats,
    zones,
    amenities: floorAmenities(building, floorIndex),
    checkins: here,
    reports,
    crowdReports: { n: crowdReports.length, updatedAt: latest(crowdReports) },
    noiseReports: { n: noiseReports.length, updatedAt: latest(noiseReports) },
  };
}

// Charging & water for a floor: the building-type estimate until students
// confirm or correct it (latest majority wins).
export function floorAmenities(building, floorIndex) {
  const est = amenityEstimate(building, floorIndex);
  const label = building.floors[floorIndex].label;
  const reports = (shared.amenities ?? []).filter((a) => a.buildingId === building.id && a.floor === label);
  const resolve = (key, estimate) => {
    const mine = reports.filter((a) => a.kind.startsWith(key));
    const yes = mine.filter((a) => a.kind.endsWith('yes')).length;
    const no = mine.length - yes;
    if (!mine.length) return { value: estimate, confirmed: false, source: 'Estimate from building type, not verified', updatedAt: null, yes, no };
    const has = yes >= no;
    const value = key === 'power' ? (has ? (estimate === 'few' ? 'some' : estimate) : 'few') : has;
    return {
      value,
      confirmed: true,
      source: `${mine.length} student report${mine.length === 1 ? '' : 's'} (${yes} yes, ${no} no)`,
      updatedAt: Math.max(...mine.map((a) => a.at)),
      yes,
      no,
    };
  };
  return { power: resolve('power', est.power), water: resolve('water', est.water) };
}

// Model forecast for the next few hours (crowd %), e.g. "can I stay 2 hours?"
export function floorForecast(building, floorIndex, hours = 2, from = new Date()) {
  return Array.from({ length: hours + 1 }, (_, h) =>
    Math.round(floorStats(building, floorIndex, new Date(from.getTime() + h * 3600 * 1000)).occupancy * 100),
  );
}

export function buildingStats(building, date = new Date()) {
  const floors = building.floors.map((_, i) => floorStats(building, i, date));
  const occupancy = floors.reduce((s, f) => s + f.occupancy, 0) / floors.length;
  const noise = Math.round(floors.reduce((s, f) => s + f.noise, 0) / floors.length);
  const studyFloors = floors.filter((f) => f.kind !== 'teaching' && f.kind !== 'services');
  const best = (studyFloors.length ? studyFloors : floors).reduce((a, b) => (score(b) < score(a) ? b : a));
  return {
    occupancy,
    noise,
    floors,
    best,
    live: floors.some((f) => f.live),
    checkins: floors.reduce((n, f) => n + f.checkins.length, 0),
  };
}

// Lower is better: mostly crowd, some noise, plus walking time if we know where you are.
function score(f, walk = 0) {
  return f.occupancy * 0.7 + clamp((f.noise - 25) / 50) * 0.3 + (walk ?? 0) * 0.012;
}

export function rankStudySpots(date = new Date(), limit = 6, { campus, from } = {}) {
  const spots = [];
  for (const b of BUILDINGS) {
    if (campus && campusOf(b) !== campus) continue;
    const walk = walkMinutes(from, b);
    b.floors.forEach((f, i) => {
      if (f.kind === 'teaching' || f.kind === 'social' || f.kind === 'services') return;
      const s = floorStats(b, i, date);
      spots.push({ building: b, floor: s, walk, score: score(s, walk) });
    });
  }
  return spots.sort((a, b) => a.score - b.score).slice(0, limit);
}

export function campusSnapshot(date = new Date(), from = null) {
  return BUILDINGS.map((b) => {
    const s = buildingStats(b, date);
    if (b.generic) {
      // Other UCL teaching buildings: keep the prompt small, no per-floor detail.
      return { id: b.id, name: b.name, campus: campusOf(b), walkMinutes: walkMinutes(from, b), overallBusy: Math.round(s.occupancy * 100), note: 'teaching building, no dedicated study space' };
    }
    return {
      id: b.id,
      name: b.name,
      campus: campusOf(b),
      walkMinutes: walkMinutes(from, b),
      overallBusy: Math.round(s.occupancy * 100),
      booking: bookingFor(b).what,
      floors: s.floors.map((f) => ({
        floor: f.label,
        use: f.kind,
        busyPercent: Math.round(f.occupancy * 100),
        busyNextHours: f.kind === 'teaching' || f.kind === 'services' ? undefined : floorForecast(b, s.floors.indexOf(f), 3, date),
        fromRealSensors: f.live,
        studentReports: f.reports.length ? f.reports.slice(0, 5).map((r) => `${r.kind} ${Math.round((Date.now() - r.at) / 60000)} min ago`) : undefined,
        noiseDb: f.noise,
        seatsFree: f.seatsFree,
        power: f.amenities.power.value,
        water: f.amenities.water.value,
        amenitiesConfirmedByStudents: f.amenities.power.confirmed || f.amenities.water.confirmed || undefined,
        spaceFinderUsersHere: f.checkins.length,
        openToStudyTogether: f.checkins.filter((c) => c.open).map((c) => c.subject || 'any subject'),
      })),
    };
  });
}

export function busyLabel(occ) {
  if (occ < 0.35) return 'Quiet';
  if (occ < 0.6) return 'Moderate';
  if (occ < 0.8) return 'Busy';
  return 'Packed';
}

export function noiseLabel(db) {
  if (db < 35) return 'Silent';
  if (db < 45) return 'Calm';
  if (db < 55) return 'Chatty';
  return 'Loud';
}

// Green → amber → red, as a hex number for three.js or CSS.
export function occColor(occ) {
  const stops = [
    [0, [46, 196, 132]],
    [0.5, [245, 190, 60]],
    [1, [232, 72, 85]],
  ];
  const t = clamp(occ);
  const [a, b] = t < 0.5 ? [stops[0], stops[1]] : [stops[1], stops[2]];
  const u = (t - a[0]) / (b[0] - a[0]);
  const c = a[1].map((v, i) => Math.round(v + (b[1][i] - v) * u));
  return (c[0] << 16) | (c[1] << 8) | c[2];
}

export function occCss(occ) {
  return '#' + occColor(occ).toString(16).padStart(6, '0');
}
