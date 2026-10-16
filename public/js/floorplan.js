// 2D floor plan of one floor, as SVG: the building's real outline, zones
// coloured by crowd level, furniture seen from above, people, the lift/stair
// core and ⚡/💧 points. It replays exactly the same layout as the 3D view
// (same seed, same kits), so the plan and the 3D model always match.

import { FurnitureBatch, furnishZone, COLORS } from './interiors.js';
import { clipBand, hashStr, insidePolys, seeded, segmentsAt } from './building3d.js';
import { occCss } from './occupancy.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const FILL = {
  ...Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [k, hex(v)])),
  books: '#8b5e3c',
  glass: 'none',
};

const pathOf = (polys) =>
  polys
    .flatMap((p) => [p.outer, ...p.holes])
    .map((r) => 'M' + r.map(([u, v]) => `${u.toFixed(2)},${v.toFixed(2)}`).join('L') + 'Z')
    .join('');

const KIT_LABEL = {
  reading: 'Reading tables', shelves: 'Bookshelves', library: 'Shelves + desks', carrels: 'Carrels', desks: 'Desks',
  pcs: 'PC desks', offices: 'Offices', tables: 'Round tables', pods: 'Glass pods', booths: 'Booths', cafe: 'Café',
  bar: 'Bar', lecture: 'Raked seating', theatre: 'Stage + seats', seminar: 'Meeting tables', labs: 'Lab benches',
  studios: 'Drawing tables', foyer: 'Reception', counter: 'Help desk', gallery: 'Exhibits', lockers: 'Lockers',
  lounge: 'Sofas', court: 'Moot court',
};

/**
 * @param building  app building (needs .id)
 * @param f         floorStats for this floor
 * @param plan      { polys, W, D } from localFootprint()
 * @param core      [u, v] of the lift/stair core
 */
export function floorPlanSVG(building, f, plan, core) {
  const { polys, W, D } = plan;
  const pad = 3;
  const rand = seeded(hashStr(`${building.id}|${f.label}`));
  const fb = new FurnitureBatch();
  const zw = W / f.zones.length;
  const zones = f.zones.map((z, zi) => {
    const x0 = -W / 2 + zw * zi;
    const x1 = x0 + zw;
    const zonePolys = polys
      .map((p) => ({ outer: clipBand(p.outer, x0, x1), holes: p.holes.map((h) => clipBand(h, x0, x1)).filter(Boolean) }))
      .filter((p) => p.outer);
    const { kit, spots } = furnishZone(z.name, f.kind, {
      fb, x0, x1, D, inside: (u, v) => insidePolys([u, v], polys), rand, occupancy: z.occupancy,
    });
    const c = spots[Math.floor(spots.length / 2)] ?? [(x0 + x1) / 2, 0];
    return { ...z, x0, x1, zonePolys, kit, labelAt: c };
  });

  const out = [];
  out.push(`<svg class="plan-svg" viewBox="${-W / 2 - pad} ${-D / 2 - pad} ${W + pad * 2} ${D + pad * 2}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Floor ${esc(f.label)} plan">`);
  // floor + zones
  out.push(`<path d="${pathOf(polys)}" fill="var(--plan-floor)" fill-rule="evenodd"/>`);
  for (const z of zones) {
    if (z.zonePolys.length) out.push(`<path d="${pathOf(z.zonePolys)}" fill="${occCss(z.occupancy)}" fill-opacity="0.32" fill-rule="evenodd"/>`);
  }
  // partitions between zones
  for (const z of zones.slice(1)) {
    for (const [a, b] of segmentsAt(z.x0, polys)) {
      out.push(`<line x1="${z.x0}" y1="${a + 0.6}" x2="${z.x0}" y2="${b - 0.6}" class="plan-partition"/>`);
    }
  }
  // furniture & people, top-down
  const people = [];
  for (const [key, mats] of fb.items) {
    const [shape, mat] = key.split('|');
    for (const m of mats) {
      const e = m.elements;
      const [u, y, v] = [e[12], e[13], e[14]];
      const [sx, sz] = [e[0], e[10]];
      if (shape === 'person') {
        people.push([u, v]);
        continue;
      }
      if (y > 1.2 && shape !== 'box') continue; // lamp heads, plant tops: skip clutter
      const fill = FILL[mat] ?? '#bbb';
      if (shape === 'box') {
        const glass = mat === 'glass';
        out.push(`<rect x="${(u - sx / 2).toFixed(2)}" y="${(v - sz / 2).toFixed(2)}" width="${sx.toFixed(2)}" height="${sz.toFixed(2)}" fill="${fill}" ${glass ? 'class="plan-glass"' : 'class="plan-item"'}/>`);
      } else {
        out.push(`<circle cx="${u.toFixed(2)}" cy="${v.toFixed(2)}" r="${(sx / 2).toFixed(2)}" fill="${fill}" class="plan-item"/>`);
      }
    }
  }
  for (const [u, v] of people) out.push(`<circle cx="${u.toFixed(2)}" cy="${v.toFixed(2)}" r="0.32" class="plan-person"/>`);
  // walls on top
  out.push(`<path d="${pathOf(polys)}" fill="none" class="plan-wall"/>`);
  // lift & stairs
  if (core) {
    const [u, v] = core;
    out.push(`<g class="plan-core"><rect x="${u - 1.2}" y="${v - 1.2}" width="2.4" height="2.4"/><path d="M${u - 1.2},${v - 1.2}L${u + 1.2},${v + 1.2}M${u + 1.2},${v - 1.2}L${u - 1.2},${v + 1.2}"/></g>`);
    out.push(`<text x="${u}" y="${v + 2.6}" class="plan-small">Lift &amp; stairs</text>`);
    if (f.amenities?.water.value) out.push(`<text x="${u + 3}" y="${v + 0.5}" class="plan-icon">💧</text>`);
  }
  if (f.amenities && f.amenities.power.value !== 'few') {
    out.push(`<text x="${W / 2 - 3}" y="${-D / 2 + 3.5}" class="plan-icon">${f.amenities.power.value === 'most' ? '⚡⚡' : '⚡'}</text>`);
  }
  // zone labels
  for (const z of zones) {
    const [u, v] = z.labelAt;
    out.push(`<g class="plan-zone-label"><text x="${u}" y="${v - 0.6}">${esc(z.name)}</text><text x="${u}" y="${v + 1.4}" class="pct">${Math.round(z.occupancy * 100)}% · ${esc(KIT_LABEL[z.kit] ?? z.kit)}</text></g>`);
  }
  out.push('</svg>');
  return out.join('');
}
