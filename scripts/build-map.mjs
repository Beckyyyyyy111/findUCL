// Builds public/data/map.json from OpenStreetMap extracts in scripts/osm/.
//   node scripts/build-map.mjs
//
// Output is in local metres (x = east, z = south) per campus, with real
// footprints, heights (from building:levels / height / building parts),
// materials and roof shapes, plus streets, green spaces and rivers.
// Map data © OpenStreetMap contributors (ODbL).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(path.join(here, 'osm', f), 'utf8'));

// ---------- campuses ----------
const CAMPUSES = {
  bloomsbury: {
    origin: { lat: 51.5246, lng: -0.134 }, // middle of the Wilkins Building
    offset: [0, 0],
    clip: { x0: -480, x1: 640, z0: -500, z1: 720 },
    files: ['bloomsbury-buildings.json', 'bloomsbury-relations.json', 'bloomsbury-parts.json', 'bloomsbury-context.json'],
  },
  east: {
    origin: { lat: 51.5383, lng: -0.0118 }, // Marshgate
    offset: [2500, 0],
    clip: { x0: -330, x1: 330, z0: -330, z1: 330 },
    files: ['east.json'],
  },
};

// ---------- which OSM features are our clickable UCL buildings ----------
// way/relation id → app building id, plus look overrides where OSM is thin.
const UCL = {
  681098586: { id: 'student-centre', levels: 6, levelH: 4.4, style: 'glass', wall: '#d9d4c8' }, // G, M, 1–4 above ground; B1, B2 below
  680050665: { id: 'main-library', levels: 3, levelH: 5.2, style: 'stone', wall: '#e8e1cf' },
  50059489: { id: 'main-library', levels: 3, levelH: 5.2, style: 'stone', wall: '#e8e1cf' }, // North Wing
  50059498: { id: 'main-library', levels: 3, levelH: 5.2, style: 'stone', wall: '#e8e1cf' }, // North-West Wing
  50059493: { id: 'main-library', levels: 3, levelH: 5.2, style: 'stone', wall: '#e8e1cf' }, // South Wing
  849005554: { id: 'science-library', levels: 6, style: 'brick', wall: '#b9936a' },
  51517608: { id: 'ioe', levels: 7, style: 'concrete' },
  863409196: { id: 'cruciform', levels: 5, style: 'brick', wall: '#a24a35', roof: '#5c5f66' },
  11948662: { id: 'senate-house', levels: 6, style: 'stone' },
  40269405: { id: 'kathleen-lonsdale', levels: 5, style: 'stone', wall: '#dcd2bb' },
  40205764: { id: 'christopher-ingold', levels: 5, style: 'concrete', wall: '#9a9a96' },
  383553353: { id: 'bloomsbury-theatre', levels: 5, style: 'brick', wall: '#8f5a43' },
  483804431: { id: 'gordon-street-22', levels: 7, style: 'glass', wall: '#cfcac0' },
  802236339: { id: 'engineering-front', levels: 4, style: 'stone', wall: '#e2dbc9' },
  802236338: { id: 'roberts', levels: 8, style: 'concrete', wall: '#b8b3a8' },
  40253194: { id: 'bentham-house', levels: 5, style: 'brick', wall: '#c4ab88' },
  964277509: { id: 'marshgate', levels: 12, style: 'concrete', wall: '#e6e2d8' },
  964277508: { id: 'one-pool-street', levels: 20, style: 'brick', wall: '#a8735a' },
};
// Any other building OSM says UCL runs is drawn in UCL style and becomes
// clickable with a generic floor plan (halls of residence are labelled only).
const UCL_OPERATOR = /^(ucl|university college london|ucl library services|students' union ucl)$/i;
function otherUcl(t) {
  if (!t.building || ['hospital', 'no'].includes(t.building)) return null;
  if (!UCL_OPERATOR.test(t.operator ?? '') && t['operator:wikidata'] !== 'Q193196' && !/^UCL\b/.test(t.name ?? '')) return null;
  const address = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const name = (t.name ?? t['addr:housename'] ?? address).replace(/^UCL /, '').trim();
  if (!name) return null;
  const hall = ['dormitory', 'residential'].includes(t.building) || /\bHall$|Campbell House|Schafer House|Dodgson/.test(name);
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    name,
    named: !!(t.name || t['addr:housename']),
    kind: hall ? 'hall' : 'dept',
    levels: num(t['building:levels']),
  };
}

// Big context buildings worth a bit of character.
const CONTEXT_STYLE = {
  149637725: { height: 114.5, style: 'steel', wall: '#b23a2e' }, // ArcelorMittal Orbit
  1169737833: { height: 22, style: 'glass', wall: '#d7dde0' }, // London Aquatics Centre
};

// ---------- colours & styles ----------
const NAMED = {
  white: '#ece8dc', ivory: '#ece6d4', beige: '#d9cbb0', cream: '#e9dfc7',
  lightgrey: '#c9c8c3', grey: '#a3a29d', gray: '#a3a29d', darkgrey: '#6d6f73', black: '#4a4c51',
  brown: '#8f5a43', light_brown: '#b48b65', darkbrown: '#6e4534', red: '#a4503a', yellow: '#d8c27a',
  green: '#7f9f7a', blue: '#8fb4c8', silver: '#c7ccd0', orange: '#c98a55', tan: '#c8ab84',
};
const MATERIAL = {
  brick: { wall: '#b08060', style: 'brick' },
  stone: { wall: '#e7e1d0', style: 'stone' },
  concrete: { wall: '#bdbab2', style: 'concrete' },
  glass: { wall: '#9fbccc', style: 'glass' },
  plaster: { wall: '#f0ece2', style: 'stone' },
  metal: { wall: '#b9bec4', style: 'glass' },
};
const STYLE_INDEX = { stone: 0, brick: 0, concrete: 1, glass: 2, steel: 3 };

function colour(v) {
  if (!v) return null;
  v = String(v).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return '#' + [...v.slice(1)].map((c) => c + c).join('');
  return NAMED[v] ?? null;
}

// ---------- geometry helpers ----------
const r1 = (v) => Math.round(v * 10) / 10;

function projector(campus) {
  const { lat, lng } = campus.origin;
  const kx = Math.cos((lat * Math.PI) / 180) * 111320;
  const kz = 110574;
  const [ox, oz] = campus.offset;
  return (g) => [r1(ox + (g.lon - lng) * kx), r1(oz - (g.lat - lat) * kz)];
}

function area(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}
function centroid(ring) {
  let x = 0, z = 0;
  for (const p of ring) {
    x += p[0];
    z += p[1];
  }
  return [x / ring.length, z / ring.length];
}
function inside([x, z], ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function clean(ring) {
  const out = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  if (out.length > 1 && out[0][0] === out.at(-1)[0] && out[0][1] === out.at(-1)[1]) out.pop();
  return out;
}

// Join multipolygon member ways that were split into pieces.
function assemble(ways) {
  const rings = [];
  const open = ways.map((w) => [...w]);
  while (open.length) {
    let ring = open.shift();
    let guard = 0;
    while ((ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) && guard++ < 500) {
      const end = ring.at(-1);
      const i = open.findIndex((w) => (w[0][0] === end[0] && w[0][1] === end[1]) || (w.at(-1)[0] === end[0] && w.at(-1)[1] === end[1]));
      if (i < 0) break;
      let next = open.splice(i, 1)[0];
      if (next[0][0] !== end[0] || next[0][1] !== end[1]) next = next.reverse();
      ring = ring.concat(next.slice(1));
    }
    const c = clean(ring);
    if (c.length >= 3) rings.push(c);
  }
  return rings;
}

function polygonsOf(el, P) {
  if (el.type === 'way') {
    if (!el.geometry) return [];
    const ring = clean(el.geometry.map(P));
    return ring.length >= 3 ? [{ outer: ring, holes: [] }] : [];
  }
  const members = el.members ?? [];
  if (members.some((m) => m.role !== 'outer' && m.role !== 'inner' && m.role !== '')) return []; // type=building aggregators
  const outers = assemble(members.filter((m) => m.role !== 'inner' && m.geometry).map((m) => m.geometry.map(P)));
  const inners = assemble(members.filter((m) => m.role === 'inner' && m.geometry).map((m) => m.geometry.map(P)));
  return outers.map((outer) => ({ outer, holes: inners.filter((h) => inside(centroid(h), outer)) }));
}

const flat = (ring) => ring.flatMap((p) => p);
const inClip = (ring, c) => {
  const [x, z] = centroid(ring);
  return x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1;
};

// ---------- heights ----------
const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
function levelHeight(tags) {
  const b = tags.building ?? tags['building:part'];
  if (['house', 'residential', 'apartments', 'terrace', 'dormitory'].includes(b)) return 3.2;
  return 3.8;
}
function heights(tags, override = {}) {
  const lh = override.levelH ?? levelHeight(tags);
  const levels = num(tags['building:levels']) ?? override.levels;
  const roofLevels = num(tags['roof:levels']) ?? 0;
  let h = override.height ?? num(tags.height) ?? (levels != null ? (levels + roofLevels) * lh + 1 : null);
  if (h == null || h <= 0) h = ['house', 'residential', 'apartments', 'terrace'].includes(tags.building) ? 13 : 14;
  let minH = num(tags.min_height) ?? (num(tags['building:min_level']) != null ? num(tags['building:min_level']) * lh : 0);
  if (minH >= h) h = minH + Math.max(lh, 2);
  const shape = tags['roof:shape'] ?? 'flat';
  let roofH = num(tags['roof:height']) ?? (shape === 'flat' ? 0 : shape === 'dome' ? null : 3);
  return { h: r1(h), minH: r1(minH), roof: shape, roofH };
}

function looks(tags, override = {}) {
  const mat = MATERIAL[(tags['building:material'] ?? '').toLowerCase()];
  const style = override.style ?? mat?.style ?? 'stone';
  const wall =
    override.wall ?? colour(tags['building:colour']) ?? mat?.wall ??
    (['house', 'residential', 'apartments', 'terrace'].includes(tags.building) ? '#b89a78' : '#d6d1c6');
  const roof = override.roof ?? colour(tags['roof:colour']) ?? '#8d8f93';
  return { wall, roofC: roof, t: STYLE_INDEX[style] ?? 0 };
}

// ---------- build ----------
const out = { uclExtra: [], footprints: {}, attribution: 'Map data © OpenStreetMap contributors (ODbL)', campuses: {}, buildings: [], roads: [], greens: [], water: [], labels: [] };

// Streets students navigate by, labelled even when they're small.
const MAJOR_STREETS = ['Gower Street', 'Gordon Street', 'Malet Street', 'Bedford Way', 'Torrington Place', 'Gower Place', 'Euston Road', 'Tottenham Court Road', 'Malet Place', 'Byng Place', 'Endsleigh Gardens', 'Taviton Street', 'Woburn Place', 'Russell Square', 'Pool Street', 'Carpenters Road', 'Montfichet Road'];
const ROAD_W = { primary: 15, secondary: 13, tertiary: 11, residential: 9, unclassified: 8, living_street: 7, pedestrian: 7, service: 4.5, footway: 2.2, cycleway: 2.5 };

for (const [cid, campus] of Object.entries(CAMPUSES)) {
  const P = projector(campus);
  const [ox, oz] = campus.offset;
  campus.clip = { x0: campus.clip.x0 + ox, x1: campus.clip.x1 + ox, z0: campus.clip.z0 + oz, z1: campus.clip.z1 + oz };
  const els = new Map();
  for (const f of campus.files) for (const e of read(f).elements) els.set(`${e.type}/${e.id}`, { ...els.get(`${e.type}/${e.id}`), ...e });
  const all = [...els.values()];
  out.campuses[cid] = { origin: campus.origin, offset: campus.offset, clip: campus.clip };

  // Footprints
  const buildings = [];
  for (const e of all) {
    const t = e.tags ?? {};
    if (!t.building || t.building === 'no' || t.location === 'underground') continue;
    for (const poly of polygonsOf(e, P)) {
      if (!inClip(poly.outer, campus.clip) || Math.abs(area(poly.outer)) < 12) continue;
      buildings.push({ e, t, poly, area: Math.abs(area(poly.outer)), parts: [] });
    }
  }
  // Drop footprints that sit inside a bigger footprint (duplicate mapping).
  buildings.sort((a, b) => b.area - a.area);
  const kept = [];
  for (const b of buildings) {
    const c = centroid(b.poly.outer);
    const host = kept.find((k) => k.area > b.area * 1.3 && inside(c, k.poly.outer) && b.poly.outer.filter((p) => inside(p, k.poly.outer)).length >= b.poly.outer.length * 0.7);
    if (host && !UCL[b.e.id]) continue;
    kept.push(b);
  }

  // Building parts → their host footprint
  const parts = [];
  for (const e of all) {
    const t = e.tags ?? {};
    if (!t['building:part'] || t['building:part'] === 'no') continue;
    for (const poly of polygonsOf(e, P)) {
      if (!inClip(poly.outer, campus.clip) || Math.abs(area(poly.outer)) < 4) continue;
      const host = kept.find((k) => inside(centroid(poly.outer), k.poly.outer));
      parts.push({ e, t, poly, area: Math.abs(area(poly.outer)), host });
      if (host) host.parts.push(parts.at(-1));
    }
  }

  const emit = (poly, tags, ov, extra) => {
    const hgt = heights(tags, ov);
    out.buildings.push({
      c: cid,
      outer: flat(poly.outer),
      holes: poly.holes.map(flat),
      ...hgt,
      ...looks(tags, ov),
      ...extra,
    });
  };

  for (const b of kept) {
    const other = UCL[b.e.id] ? null : otherUcl(b.t);
    if (other) {
      const prev = out.uclExtra.find((x) => x.id === other.id);
      if (!prev) out.uclExtra.push({ ...other, campus: cid });
      else prev.levels ??= other.levels;
    }
    const ov = UCL[b.e.id] ?? (other ? { style: other.kind === 'hall' ? 'brick' : 'stone' } : CONTEXT_STYLE[b.e.id]) ?? {};
    const ucl = UCL[b.e.id]?.id ?? other?.id;
    // Real outline (with courtyards) for the floor-by-floor interior view.
    if (ucl) (out.footprints[ucl] ??= []).push({ outer: flat(b.poly.outer), holes: b.poly.holes.map(flat) });
    const extra = { osm: `${b.e.type}/${b.e.id}`, ...(ucl ? { ucl } : {}), ...(other ? { uclKind: other.kind } : {}), ...(b.t.name ? { name: b.t.name } : {}) };
    // Simple-3D-buildings rule: parts replace the outline… unless they only cover a bit of it.
    // Then the outline only fills the gaps, kept below every part so roofs never overlap.
    const covered = b.parts.reduce((s, p) => s + p.area, 0) / b.area;
    if (!b.parts.length) emit(b.poly, b.t, ov, extra);
    else if (covered < 0.6) {
      const lowestPart = Math.min(...b.parts.map((p) => heights({ ...b.t, ...p.t }, ov).h));
      const own = heights(b.t, ov).h;
      emit(b.poly, b.t, { ...ov, height: Math.max(3, Math.min(own, lowestPart) - 0.6) }, { ...extra, filler: true });
    }
    for (const p of b.parts) {
      // Parts inherit the host's look unless they say otherwise.
      const tags = { ...b.t, ...p.t };
      if (!p.t['building:levels'] && !p.t.height && !p.t.min_height && !p.t['building:min_level']) {
        delete tags.height;
        tags['building:levels'] = b.t['building:levels'];
      }
      const pov = { ...ov };
      if (p.t['building:levels'] || p.t.height) delete pov.levels;
      if (p.t['building:colour']) delete pov.wall;
      emit(p.poly, tags, pov, { ...extra, part: true, ...(p.t.name ? { name: p.t.name } : {}) });
    }
  }
  for (const p of parts.filter((p) => !p.host)) emit(p.poly, p.t, {}, { osm: `${p.e.type}/${p.e.id}`, part: true });

  // Streets, paths
  const namedRoads = new Map();
  for (const e of all) {
    const t = e.tags ?? {};
    const w = ROAD_W[t.highway];
    if (!w || !e.geometry || t.area === 'yes' || t.tunnel === 'yes') continue;
    const pts = e.geometry.map(P);
    if (!pts.some(([x, z]) => x > campus.clip.x0 && x < campus.clip.x1 && z > campus.clip.z0 && z < campus.clip.z1)) continue;
    out.roads.push({ c: cid, k: t.highway, w, p: flat(pts) });
    if (t.name && ['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'pedestrian'].includes(t.highway)) {
      const len = pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
      const major = ['primary', 'secondary', 'tertiary'].includes(t.highway) || MAJOR_STREETS.includes(t.name);
      if (!namedRoads.has(t.name) || namedRoads.get(t.name).len < len) namedRoads.set(t.name, { pts, len, major: major || namedRoads.get(t.name)?.major });
    }
  }
  for (const [name, { pts, major }] of namedRoads) {
    const mid = Math.floor(pts.length / 2);
    const a = pts[Math.max(0, mid - 1)], b = pts[Math.min(pts.length - 1, mid)];
    const [x, z] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (x > campus.clip.x0 && x < campus.clip.x1 && z > campus.clip.z0 && z < campus.clip.z1) {
      out.labels.push({ c: cid, name, x: r1(x), z: r1(z), kind: 'street', ...(major ? { major: true } : {}) });
    }
  }

  // Green spaces
  for (const e of all) {
    const t = e.tags ?? {};
    if (!['park', 'garden'].includes(t.leisure) && t.landuse !== 'grass') continue;
    for (const poly of polygonsOf(e, P)) {
      if (!inClip(poly.outer, campus.clip) || Math.abs(area(poly.outer)) < 30) continue;
      out.greens.push({ c: cid, outer: flat(poly.outer), holes: poly.holes.map(flat) });
      if (t.name && Math.abs(area(poly.outer)) > 3000) {
        const [x, z] = centroid(poly.outer);
        out.labels.push({ c: cid, name: t.name, x: r1(x), z: r1(z), kind: 'park' });
      }
    }
  }

  // Rivers
  for (const e of all) {
    const t = e.tags ?? {};
    if (t.waterway !== 'river' || !e.geometry) continue;
    const pts = e.geometry.map(P);
    out.water.push({ c: cid, w: /lea/i.test(t.name ?? '') ? 30 : 20, p: flat(pts) });
    if (t.name && pts.length > 6) {
      const m = pts[Math.floor(pts.length / 2)];
      out.labels.push({ c: cid, name: t.name, x: m[0], z: m[1], kind: 'water' });
    }
  }
}

// Centre + top of every UCL building, so the app can place labels and measure walks.
out.ucl = {};
for (const b of out.buildings.filter((b) => b.ucl)) {
  const u = (out.ucl[b.ucl] ??= { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, top: 0, campus: b.c });
  for (let i = 0; i < b.outer.length; i += 2) {
    u.minX = Math.min(u.minX, b.outer[i]);
    u.maxX = Math.max(u.maxX, b.outer[i]);
    u.minZ = Math.min(u.minZ, b.outer[i + 1]);
    u.maxZ = Math.max(u.maxZ, b.outer[i + 1]);
  }
  u.top = Math.max(u.top, b.h + (b.roofH ?? 0));
}
for (const [id, u] of Object.entries(out.ucl)) {
  out.ucl[id] = { campus: u.campus, x: r1((u.minX + u.maxX) / 2), z: r1((u.minZ + u.maxZ) / 2), w: r1(u.maxX - u.minX), d: r1(u.maxZ - u.minZ), top: r1(u.top) };
}
for (const x of out.uclExtra) Object.assign(x, out.ucl[x.id] ?? {});

const file = path.join(here, '..', 'public', 'data', 'map.json');
fs.writeFileSync(file, JSON.stringify(out));
const missing = [...new Set(Object.values(UCL).map((u) => u.id))].filter((id) => !out.ucl[id]);
console.log(
  `map.json: ${out.buildings.length} building shapes, ${out.roads.length} paths, ${out.greens.length} greens, ` +
    `${out.water.length} rivers, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`,
);
console.log('Other UCL buildings:', out.uclExtra.filter((x) => x.kind === 'dept').length, 'departments/teaching,', out.uclExtra.filter((x) => x.kind === 'hall').length, 'halls');
console.log('Tracked UCL buildings:', Object.keys(out.ucl).length - out.uclExtra.length, missing.length ? `MISSING: ${missing.join(', ')}` : '(all found)');
