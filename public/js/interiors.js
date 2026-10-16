// What's inside each zone: furniture "kits" picked from the zone's name
// (Stacks → bookshelves, Lecture theatre → tiered seats, Labs → benches and
// fume cupboards, Café → counter and tables…), with people sitting or
// standing in proportion to how busy the zone is.
// Everything is drawn with a handful of shared unit shapes, instanced per floor.

import * as THREE from 'three';

// ---------- shared shapes & materials ----------
const SHAPES = {
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), // origin at the bottom
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14).translate(0, 0.5, 0),
  ball: new THREE.SphereGeometry(0.5, 12, 8),
  person: new THREE.CapsuleGeometry(0.3, 0.7, 2, 6),
};
for (const g of Object.values(SHAPES)) g.userData.shared = true;

function booksTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#6b4b33';
  g.fillRect(0, 0, 64, 32);
  const spines = ['#b23a3a', '#2f5d8a', '#d9a441', '#3f7a4f', '#e8e2d0', '#5a3e7a', '#c46b2d'];
  for (let shelf = 0; shelf < 2; shelf++) {
    let x = 0;
    while (x < 64) {
      const w = 2 + Math.floor(Math.random() * 3);
      g.fillStyle = spines[Math.floor(Math.random() * spines.length)];
      g.fillRect(x, shelf * 16 + 2, w - 0.5, 12 + Math.random() * 2);
      x += w;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const COLORS = {
  wood: 0xc8a27a, darkwood: 0x7a5236, white: 0xf3f0ea, grey: 0xb9b2a6, steel: 0x8796a6, dark: 0x3a3f47,
  screen: 0x1f2a36, lampshade: 0x2e7d32, red: 0xa83232, sofa: 0x55708f, plant: 0x4f9a5a, pot: 0xa0704f,
  cork: 0xc99a62, board: 0xfafafa, fume: 0xdfe5ea, stage: 0x4a3b33, leather: 0x7a4a33, teal: 0x2f8f8a,
};
const MATS = {};
function material(key) {
  if (MATS[key]) return MATS[key];
  if (key === 'books') MATS[key] = new THREE.MeshStandardMaterial({ map: booksTexture(), roughness: 0.9 });
  else if (key === 'glass') MATS[key] = new THREE.MeshStandardMaterial({ color: 0xa8d4ef, transparent: true, opacity: 0.28, roughness: 0.1, depthWrite: false });
  else if (key === 'person') MATS[key] = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 });
  else MATS[key] = new THREE.MeshStandardMaterial({ color: COLORS[key], roughness: 0.75 });
  return MATS[key];
}

// ---------- per-floor batch of instances ----------
export class FurnitureBatch {
  constructor() {
    this.items = new Map(); // "shape|material" -> Matrix4[]
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
  }
  add(shape, mat, u, y, v, sx, sy, sz) {
    const key = `${shape}|${mat}`;
    if (!this.items.has(key)) this.items.set(key, []);
    this.items.get(key).push(new THREE.Matrix4().compose(new THREE.Vector3(u, y, v), this.q, new THREE.Vector3(sx, sy, sz)));
  }
  box(mat, u, y, v, sx, sy, sz) {
    this.add('box', mat, u, y, v, sx, sy, sz);
  }
  cyl(mat, u, y, v, r, h) {
    this.add('cyl', mat, u, y, v, r * 2, h, r * 2);
  }
  ball(mat, u, y, v, r) {
    this.add('ball', mat, u, y, v, r * 2, r * 2, r * 2);
  }
  person(u, y, v, standing) {
    this.add('person', 'person', u, y + (standing ? 0.65 : 0.55), v, 1, standing ? 1.1 : 0.85, 1);
  }
  build(group, baseY) {
    for (const [key, mats] of this.items) {
      const [shape, mat] = key.split('|');
      const inst = new THREE.InstancedMesh(SHAPES[shape], material(mat), mats.length);
      mats.forEach((mx, k) => inst.setMatrixAt(k, mx));
      inst.position.y = baseY;
      inst.userData.furniture = true;
      group.add(inst);
    }
  }
}

// ---------- which kit for which zone ----------
const RULES = [
  [/reading|donaldson|silent hall/i, 'reading'],
  [/stack|archive|periodical|bookshop/i, 'shelves'],
  [/library/i, 'library'],
  [/carrel/i, 'carrels'],
  [/\bpcs?\b|pc cluster|screens|catalogue|printer/i, 'pcs'],
  [/pod|group room|society/i, 'pods'],
  [/booth/i, 'booths'],
  [/caf|print room/i, 'cafe'],
  [/\bbar\b/i, 'bar'],
  [/contemplation|prayer|meditation|faith/i, 'contemplation'],
  [/shower|ablution|toilet|washroom/i, 'washrooms'],
  [/tiered|steps/i, 'steps'],
  [/lecture|jeffery|xlg/i, 'lecture'],
  [/theatre/i, 'theatre'],
  [/\blabs?\b/i, 'labs'],
  [/studio|crit|model shop|workshop/i, 'studios'],
  [/seminar|teaching room|events/i, 'seminar'],
  [/help desk|box office|help point|enquir/i, 'counter'],
  [/wellbeing|support/i, 'offices'],
  [/office/i, 'offices'],
  [/gallery/i, 'gallery'],
  [/foyer|entrance|atrium|reception/i, 'foyer'],
  [/locker/i, 'lockers'],
  [/sofa|seating|terrace|vending/i, 'lounge'],
  [/moot|court/i, 'court'],
  [/project space|hub tables|open tables|tables/i, 'tables'],
  [/silent study/i, 'carrels'],
  [/study|desks|window seats|quiet/i, 'desks'],
];
const BY_FLOOR_KIND = { silent: 'carrels', quiet: 'desks', group: 'tables', social: 'lounge', teaching: 'seminar', services: 'lockers' };

export function kitFor(zoneName, floorKind) {
  return RULES.find(([re]) => re.test(zoneName))?.[1] ?? BY_FLOOR_KIND[floorKind] ?? 'desks';
}

// ---------- the kits ----------
// ctx: { fb, x0, x1, D, inside(u, v), rand, seats[] }
function grid(ctx, su, sv, hu, hv, max = 34) {
  const out = [];
  for (let u = ctx.x0 + hu + 0.7; u <= ctx.x1 - hu - 0.7; u += su) {
    for (let v = -ctx.D / 2 + hv + 0.7; v <= ctx.D / 2 - hv - 0.7; v += sv) {
      const corners = [[0, 0], [hu, hv], [-hu, hv], [hu, -hv], [-hu, -hv]];
      if (corners.every(([du, dv]) => ctx.inside(u + du, v + dv))) out.push([u, v]);
    }
  }
  // big zones: thin out so a floor stays readable and fast
  return out.length > max ? out.filter((_, k) => k % Math.ceil(out.length / max) === 0) : out;
}
const seat = (ctx, u, y, v) => ctx.seats.push([u, y, v, false]);
const stand = (ctx, u, v) => ctx.seats.push([u, 0, v, true]);
const chair = (ctx, u, v, mat = 'dark') => {
  ctx.fb.box(mat, u, 0, v, 0.5, 0.45, 0.5);
  seat(ctx, u, 0.15, v);
};
function plant(ctx, u, v) {
  ctx.fb.cyl('pot', u, 0, v, 0.35, 0.5);
  ctx.fb.ball('plant', u, 1.0, v, 0.6);
}

const KITS = {
  desks(ctx, { divider = false, monitor = false, cubicle = false } = {}) {
    const spots = grid(ctx, 2.2, 2.1, 0.8, 0.8);
    for (const [u, v] of spots) {
      ctx.fb.box('wood', u, 0, v, 1.5, 0.75, 0.8);
      if (divider) ctx.fb.box('teal', u, 0, v - 0.43, 1.5, 1.3, 0.06);
      if (cubicle) {
        ctx.fb.box('grey', u - 0.78, 0, v, 0.06, 1.3, 0.9);
        ctx.fb.box('grey', u + 0.78, 0, v, 0.06, 1.3, 0.9);
      }
      if (monitor) ctx.fb.box('screen', u, 0.78, v - 0.2, 0.7, 0.42, 0.05);
      chair(ctx, u, v + 0.7);
    }
    return spots;
  },
  carrels: (ctx) => KITS.desks(ctx, { divider: true }),
  pcs: (ctx) => KITS.desks(ctx, { monitor: true }),
  offices: (ctx) => KITS.desks(ctx, { cubicle: true, monitor: true }),

  // Long library tables with green reading lamps.
  reading(ctx) {
    const spots = grid(ctx, 5.2, 3.6, 2.3, 1.3);
    for (const [u, v] of spots) {
      ctx.fb.box('darkwood', u, 0, v, 4.2, 0.75, 1.4);
      for (const du of [-1.4, 0, 1.4]) {
        ctx.fb.cyl('steel', u + du, 0.75, v, 0.05, 0.35);
        ctx.fb.box('lampshade', u + du, 1.05, v, 0.45, 0.14, 0.25);
        chair(ctx, u + du, v - 1.0, 'leather');
        chair(ctx, u + du, v + 1.0, 'leather');
      }
    }
    return spots;
  },

  shelves(ctx) {
    const spots = grid(ctx, 5, 1.9, 2.1, 0.3);
    spots.forEach(([u, v], k) => {
      ctx.fb.box('books', u, 0, v, 4, 2.2, 0.45);
      if (k % 3 === 0) stand(ctx, u + 1, v + 0.9);
    });
    return spots;
  },
  // A library floor: shelves on one side, study desks on the other.
  library(ctx) {
    const mid = (ctx.x0 + ctx.x1) / 2;
    const left = KITS.shelves({ ...ctx, x1: mid });
    const right = KITS.desks({ ...ctx, x0: mid });
    return [...left, ...right];
  },

  tables(ctx) {
    const spots = grid(ctx, 3.6, 3.6, 1.6, 1.6);
    for (const [u, v] of spots) {
      ctx.fb.cyl('white', u, 0, v, 1, 0.75);
      for (const [du, dv] of [[1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4]]) chair(ctx, u + du, v + dv);
    }
    return spots;
  },

  // Glass group-study pods with a table inside.
  pods(ctx) {
    const spots = grid(ctx, 4.8, 4.6, 1.8, 1.8);
    for (const [u, v] of spots) {
      ctx.fb.box('glass', u, 0, v, 3.4, 2.4, 3.4);
      ctx.fb.box('wood', u, 0, v, 1.6, 0.75, 0.9);
      for (const [du, dv] of [[-0.6, 0.85], [0.6, 0.85], [-0.6, -0.85], [0.6, -0.85]]) chair(ctx, u + du, v + dv, 'teal');
    }
    return spots;
  },

  booths(ctx) {
    const spots = grid(ctx, 3.4, 3.2, 1.4, 1.2);
    for (const [u, v] of spots) {
      ctx.fb.box('sofa', u, 0, v - 0.9, 2.6, 1.2, 0.4);
      ctx.fb.box('sofa', u - 1.1, 0, v, 0.4, 0.75, 1.6);
      ctx.fb.box('sofa', u + 1.1, 0, v, 0.4, 0.75, 1.6);
      ctx.fb.box('wood', u, 0, v, 1.4, 0.75, 0.8);
      seat(ctx, u - 0.5, 0.15, v - 0.5);
      seat(ctx, u + 0.5, 0.15, v - 0.5);
      seat(ctx, u - 0.8, 0.15, v + 0.3);
    }
    return spots;
  },

  cafe(ctx) {
    const spots = grid(ctx, 2.6, 2.6, 0.9, 0.9);
    const [cu, cv] = spots.shift() ?? [ctx.x0 + 3, 0];
    ctx.fb.box('dark', cu, 0, cv, 4, 1.1, 1); // counter
    ctx.fb.box('steel', cu - 1.2, 1.1, cv, 0.6, 0.6, 0.5); // coffee machine
    ctx.fb.box('white', cu + 1, 1.1, cv, 0.8, 0.3, 0.6); // cake display
    stand(ctx, cu, cv - 0.9);
    stand(ctx, cu, cv + 1.0);
    for (const [u, v] of spots) {
      ctx.fb.cyl('white', u, 0, v, 0.45, 0.75);
      chair(ctx, u - 0.75, v, 'wood');
      chair(ctx, u + 0.75, v, 'wood');
    }
    return spots;
  },

  bar(ctx) {
    const spots = grid(ctx, 2.4, 2.4, 0.8, 0.8);
    const [bu, bv] = spots.shift() ?? [ctx.x0 + 3, 0];
    ctx.fb.box('darkwood', bu, 0, bv, 6, 1.15, 1);
    for (let k = -2; k <= 2; k++) {
      ctx.fb.cyl('dark', bu + k * 1.1, 0, bv + 1, 0.22, 0.75);
      seat(ctx, bu + k * 1.1, 0.45, bv + 1);
    }
    for (const [u, v] of spots) {
      ctx.fb.cyl('dark', u, 0, v, 0.35, 1.05);
      stand(ctx, u + 0.6, v);
      stand(ctx, u - 0.6, v);
    }
    return spots;
  },

  // Raked seating facing a screen and lectern.
  lecture(ctx, { seatMat = 'red', stage = false, screen = true } = {}) {
    const spots = grid(ctx, 1.1, 1.8, 0.45, 0.6, 400); // never thin out: raked seating must stay continuous
    if (!spots.length) return spots;
    const vMin = Math.min(...spots.map((s) => s[1]));
    const uMid = (ctx.x0 + ctx.x1) / 2;
    const front = spots.filter((s) => s[1] === vMin);
    const seats = spots.filter((s) => s[1] !== vMin);
    for (const [u, v] of seats) {
      const tier = Math.min(2.4, Math.round((v - vMin) / 1.8) * 0.35);
      ctx.fb.box('grey', u, 0, v, 1.1, tier + 0.05, 1.8);
      ctx.fb.box(seatMat, u, tier, v + 0.2, 0.6, 0.5, 0.55);
      seat(ctx, u, tier + 0.2, v + 0.2);
    }
    if (stage) {
      const w = Math.max(3, (Math.max(...front.map((s) => s[0])) - Math.min(...front.map((s) => s[0]))) + 1);
      ctx.fb.box('stage', uMid, 0, vMin, w, 1.0, 1.8);
      stand(ctx, uMid, vMin);
    } else if (screen) {
      ctx.fb.box('board', uMid, 0.6, vMin - 0.4, Math.min(8, ctx.x1 - ctx.x0 - 2), 2.6, 0.08); // screen
      ctx.fb.box('wood', uMid + 2, 0, vMin + 0.3, 0.6, 1.1, 0.5); // lectern
      stand(ctx, uMid + 2, vMin + 0.8);
    }
    return spots;
  },
  theatre: (ctx) => KITS.lecture(ctx, { seatMat: 'red', stage: true }),
  // Wide timber steps people sit on (Student Centre ground floor → Mezzanine).
  steps: (ctx) => KITS.lecture(ctx, { seatMat: 'wood', screen: false }),

  // Small enclosed quiet rooms with floor mats.
  contemplation(ctx) {
    const spots = grid(ctx, 4.4, 4.2, 1.8, 1.7);
    for (const [u, v] of spots) {
      ctx.fb.box('white', u, 0, v - 1.6, 3.6, 2.2, 0.15);
      ctx.fb.box('white', u - 1.75, 0, v, 0.15, 2.2, 3.3);
      ctx.fb.box('teal', u, 0, v, 2.6, 0.06, 2.2);
      seat(ctx, u - 0.6, -0.25, v);
      seat(ctx, u + 0.6, -0.25, v + 0.4);
    }
    return spots;
  },

  // Rows of cubicles with a basin counter.
  washrooms(ctx) {
    const spots = grid(ctx, 1.7, 3.4, 0.7, 1.0);
    spots.forEach(([u, v], k) => {
      if (k % 4 === 3) {
        ctx.fb.box('white', u, 0, v, 1.4, 0.9, 0.6);
        stand(ctx, u, v + 0.7);
        return;
      }
      ctx.fb.box('grey', u, 0, v, 1.3, 2.1, 1.6);
    });
    return spots;
  },

  seminar(ctx) {
    const spots = grid(ctx, 4.6, 3.8, 2.0, 1.4);
    for (const [u, v] of spots) {
      ctx.fb.box('white', u, 0, v, 3, 0.75, 1.2);
      for (const du of [-1, 0, 1]) {
        chair(ctx, u + du, v - 0.95);
        chair(ctx, u + du, v + 0.95);
      }
    }
    return spots;
  },

  // Benches with reagent shelves, and fume cupboards.
  labs(ctx) {
    const spots = grid(ctx, 5, 3, 2.2, 0.8);
    spots.forEach(([u, v], k) => {
      if (k % 3 === 2) {
        ctx.fb.box('fume', u, 0, v, 1.6, 2.3, 0.9);
        ctx.fb.box('glass', u, 0.95, v + 0.46, 1.4, 0.9, 0.02);
        stand(ctx, u, v + 0.9);
        return;
      }
      ctx.fb.box('white', u, 0, v, 4.2, 0.92, 1.0);
      ctx.fb.box('steel', u, 0.92, v, 4, 0.6, 0.25);
      stand(ctx, u - 1.2, v + 0.85);
      stand(ctx, u + 1.2, v + 0.85);
    });
    return spots;
  },

  // Architecture studios: big drawing tables, models, pin-up walls.
  studios(ctx) {
    const spots = grid(ctx, 3.4, 3.0, 1.3, 1.0);
    spots.forEach(([u, v], k) => {
      if (k % 5 === 4) {
        ctx.fb.box('cork', u, 0, v, 2.6, 2.1, 0.08);
        stand(ctx, u, v + 0.8);
        return;
      }
      ctx.fb.box('white', u, 0, v, 2.2, 0.85, 1.5);
      ctx.fb.box('wood', u - 0.4, 0.85, v, 0.5, 0.3 + ((k * 37) % 5) * 0.12, 0.5);
      ctx.fb.box('white', u + 0.5, 0.85, v + 0.2, 0.35, 0.5, 0.35);
      ctx.fb.cyl('dark', u, 0, v + 1.0, 0.22, 0.7);
      seat(ctx, u, 0.4, v + 1.0);
    });
    return spots;
  },

  foyer(ctx) {
    const spots = grid(ctx, 3.2, 3.2, 1.2, 1.0);
    const [ru, rv] = spots.shift() ?? [(ctx.x0 + ctx.x1) / 2, 0];
    ctx.fb.box('white', ru, 0, rv, 3, 1.1, 0.9); // reception
    ctx.fb.box('dark', ru, 1.1, rv, 3.1, 0.05, 1.0);
    stand(ctx, ru, rv - 0.8);
    spots.forEach(([u, v], k) => {
      if (k % 2 === 0) plant(ctx, u, v);
      else {
        ctx.fb.box('wood', u, 0, v, 2, 0.45, 0.6);
        seat(ctx, u - 0.5, 0, v);
        stand(ctx, u + 1.0, v + 1.0);
      }
    });
    return spots;
  },

  counter(ctx) {
    const spots = KITS.foyer(ctx);
    return spots;
  },

  gallery(ctx) {
    const spots = grid(ctx, 3.6, 3.6, 1.3, 1.3);
    spots.forEach(([u, v], k) => {
      if (k % 2) ctx.fb.box('board', u, 0, v, 2.2, 2.3, 0.1);
      else {
        ctx.fb.box('white', u, 0, v, 0.8, 1.1, 0.8);
        ctx.fb.ball('cork', u, 1.4, v, 0.3);
      }
      stand(ctx, u + 0.9, v + 1.0);
    });
    return spots;
  },

  lockers(ctx) {
    const spots = grid(ctx, 3.8, 2.2, 1.6, 0.3);
    for (const [u, v] of spots) {
      ctx.fb.box('steel', u, 0, v, 3.2, 1.9, 0.5);
      stand(ctx, u, v + 0.8);
    }
    return spots;
  },

  lounge(ctx) {
    const spots = grid(ctx, 3.4, 3.2, 1.3, 1.2);
    spots.forEach(([u, v], k) => {
      if (k % 4 === 3) {
        plant(ctx, u, v);
        return;
      }
      ctx.fb.box('sofa', u, 0, v, 2.1, 0.45, 0.85);
      ctx.fb.box('sofa', u, 0, v - 0.38, 2.1, 0.9, 0.2);
      ctx.fb.cyl('wood', u, 0, v + 1.0, 0.4, 0.4);
      seat(ctx, u - 0.5, 0.05, v);
      seat(ctx, u + 0.5, 0.05, v);
    });
    return spots;
  },

  // Moot court: raised judges' bench facing counsel tables.
  court(ctx) {
    const spots = grid(ctx, 2.4, 2.2, 0.9, 0.8);
    if (!spots.length) return spots;
    const vMin = Math.min(...spots.map((s) => s[1]));
    const uMid = (ctx.x0 + ctx.x1) / 2;
    ctx.fb.box('darkwood', uMid, 0, vMin, 5, 1.3, 1.2);
    for (const du of [-1.4, 0, 1.4]) {
      ctx.fb.box('leather', uMid + du, 1.3, vMin - 0.3, 0.6, 0.7, 0.5);
      seat(ctx, uMid + du, 1.2, vMin - 0.3);
    }
    for (const [u, v] of spots.filter((s) => s[1] > vMin)) {
      ctx.fb.box('wood', u, 0, v, 1.8, 0.75, 0.7);
      chair(ctx, u, v + 0.65, 'leather');
    }
    return spots;
  },
};
KITS['open-tables'] = KITS.tables;

// Records a kit's output so it can be scaled down (narrow wings, small zones)
// before it's committed to the floor's batch.
class Recorder {
  constructor() {
    this.calls = [];
  }
  add(shape, mat, u, y, v, sx, sy, sz) {
    this.calls.push([shape, mat, u, y, v, sx, sy, sz]);
  }
  box(mat, u, y, v, sx, sy, sz) {
    this.add('box', mat, u, y, v, sx, sy, sz);
  }
  cyl(mat, u, y, v, r, h) {
    this.add('cyl', mat, u, y, v, r * 2, h, r * 2);
  }
  ball(mat, u, y, v, r) {
    this.add('ball', mat, u, y, v, r * 2, r * 2, r * 2);
  }
}

// Furnish one zone and seat people in proportion to its crowd level.
// Furniture is real-size where it fits; in narrow zones it's drawn smaller
// rather than leaving the zone empty.
export function furnishZone(zoneName, floorKind, ctx) {
  const kit = kitFor(zoneName, floorKind);
  let best = null;
  for (const s of [1, 0.7, 0.5]) {
    const rec = new Recorder();
    const sub = {
      ...ctx,
      fb: rec,
      seats: [],
      x0: ctx.x0 / s,
      x1: ctx.x1 / s,
      D: ctx.D / s,
      inside: (u, v) => ctx.inside(u * s, v * s),
    };
    const spots = KITS[kit](sub) ?? [];
    if (!best || spots.length > best.spots.length) best = { s, rec, spots, seats: sub.seats };
    if (spots.length >= 3) break;
  }
  const { s, rec, seats } = best;
  for (const [shape, mat, u, y, v, sx, sy, sz] of rec.calls) ctx.fb.add(shape, mat, u * s, y * s, v * s, sx * s, sy * s, sz * s);
  const n = Math.round(ctx.occupancy * seats.length);
  // pick who's here at random so empty seats are spread out
  const order = seats.map((_, k) => [ctx.rand(), k]).sort((a, b) => a[0] - b[0]).slice(0, n);
  for (const [, k] of order) {
    const [u, y, v, standing] = seats[k];
    ctx.fb.add('person', 'person', u * s, (y + (standing ? 0.65 : 0.55)) * s, v * s, s, (standing ? 1.1 : 0.85) * s, s);
  }
  return { kit, spots: best.spots.map(([u, v]) => [u * s, v * s]) };
}
