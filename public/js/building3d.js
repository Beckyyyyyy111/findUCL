// Inside view of one building: floors pulled apart vertically, each in the
// building's real outline (courtyards included), split into zones coloured by
// crowd level, furnished by use (carrels, group tables, café, lecture rows),
// with people at the desks, a lift/stair core, and ⚡ charging / 💧 water markers.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { occColor, busyLabel } from './occupancy.js';
import { FLOOR_KIND_LABEL } from './data.js';
import { FurnitureBatch, furnishZone } from './interiors.js';

const GAP = 11; // vertical spacing of the exploded floors
const SLAB = 0.7;
const WALL_H = 1.5;
const SIZE = 44; // longest side of every footprint, in scene units
const MAX_DEPTH = 30; // keep square-ish buildings from towering over the panel

export function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296;
}
export const hashStr = (str) => [...str].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;

// ---------- footprint helpers (2D, [u, v]) ----------
const ringOf = (flat) => {
  const r = [];
  for (let i = 0; i < flat.length; i += 2) r.push([flat[i], flat[i + 1]]);
  return r;
};
const area = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
};
const insideRing = ([x, z], r) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i];
    const [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
export const insidePolys = (p, polys) => polys.some((poly) => insideRing(p, poly.outer) && !poly.holes.some((h) => insideRing(p, h)));

// Real outline → local frame: long side along u, centred, scaled to SIZE.
export function localFootprint(building) {
  const src = building.footprint?.length ? building.footprint : null;
  if (!src) {
    const r = [[-20, -11], [20, -11], [20, 11], [-20, 11]];
    return { polys: [{ outer: r, holes: [] }], W: 40, D: 22 };
  }
  const rings = src.map((p) => ({ outer: ringOf(p.outer), holes: p.holes.map(ringOf) }));
  const pts = rings.flatMap((p) => p.outer);
  // Minimum-area bounding rectangle over the edge directions.
  let best = null;
  for (const poly of rings) {
    for (let i = 0; i < poly.outer.length; i++) {
      const [ax, az] = poly.outer[i];
      const [bx, bz] = poly.outer[(i + 1) % poly.outer.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 2) continue;
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const [x, z] of pts) {
        const u = x * ux + z * uz;
        const v = -x * uz + z * ux;
        u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
      }
      const a = (u1 - u0) * (v1 - v0);
      if (!best || a < best.a) best = { a, ux, uz, u0, u1, v0, v1 };
    }
  }
  let { ux, uz, u0, u1, v0, v1 } = best;
  if (v1 - v0 > u1 - u0) {
    // make u the long side
    [ux, uz] = [-uz, ux];
    [u0, u1, v0, v1] = [v0, v1, -u1, -u0];
  }
  const uc = (u0 + u1) / 2;
  const vc = (v0 + v1) / 2;
  const scale = Math.min(SIZE / (u1 - u0), MAX_DEPTH / Math.max(1, v1 - v0));
  const tf = ([x, z]) => [((x * ux + z * uz) - uc) * scale, ((-x * uz + z * ux) - vc) * scale];
  const polys = rings.map((p) => ({ outer: p.outer.map(tf), holes: p.holes.map((h) => h.map(tf)) }));
  return { polys, W: (u1 - u0) * scale, D: (v1 - v0) * scale };
}

// Sutherland–Hodgman clip of a ring to the vertical band x0 ≤ u ≤ x1.
export function clipBand(ring, x0, x1) {
  const clip = (pts, keep, cross) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ka = keep(a);
      const kb = keep(b);
      if (ka) out.push(a);
      if (ka !== kb) out.push(cross(a, b));
    }
    return out;
  };
  const at = (x) => (a, b) => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
  let r = clip(ring, (p) => p[0] >= x0, at(x0));
  if (r.length) r = clip(r, (p) => p[0] <= x1, at(x1));
  return r.length >= 3 && Math.abs(area(r)) > 0.3 ? r : null;
}

// Segments of the line u = x that lie inside the footprint (for partitions).
export function segmentsAt(x, polys) {
  const vs = [];
  for (const poly of polys) {
    for (const ring of [poly.outer, ...poly.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const [au, av] = ring[i];
        const [bu, bv] = ring[(i + 1) % ring.length];
        if ((au <= x && bu > x) || (bu <= x && au > x)) vs.push(av + ((bv - av) * (x - au)) / (bu - au));
      }
    }
  }
  vs.sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i + 1 < vs.length; i += 2) if (vs[i + 1] - vs[i] > 1) segs.push([vs[i], vs[i + 1]]);
  return segs;
}

// THREE shapes in the floor plane: shape (u, −v), rotated so v becomes world z.
function shapesOf(polys) {
  return polys.map(({ outer, holes }) => {
    const s = new THREE.Shape(outer.map(([u, v]) => new THREE.Vector2(u, -v)));
    for (const h of holes) s.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, -v))));
    return s;
  });
}
const flatGeo = (geo) => geo.rotateX(-Math.PI / 2);

// Thin translucent wall strips along every ring edge, merged into one mesh.
function wallGeometry(polys, y0, y1) {
  const pos = [];
  for (const poly of polys) {
    for (const ring of [poly.outer, ...poly.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const [au, av] = ring[i];
        const [bu, bv] = ring[(i + 1) % ring.length];
        pos.push(au, y0, av, bu, y0, bv, bu, y1, bv, au, y0, av, bu, y1, bv, au, y1, av);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Lift & stairs position: inside the footprint, near its middle.
export function findCore(plan) {
  let best = [0, 0];
  let bestD = Infinity;
  for (let u = -20; u <= 20; u += 1) {
    for (let v = -14; v <= 14; v += 1) {
      if (!insidePolys([u, v], plan.polys) || !insidePolys([u + 2, v], plan.polys) || !insidePolys([u - 2, v], plan.polys)) continue;
      const d = Math.hypot(u, v * 1.5);
      if (d < bestD) [best, bestD] = [[u, v], d];
    }
  }
  return best;
}

export class BuildingView {
  constructor(container, { onFloorSelect }) {
    this.container = container;
    this.onFloorSelect = onFloorSelect;
    this.floorGroups = [];
    this.selected = null;
    this.hover = null;
    this.idleSpin = true;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'label-layer';
    container.appendChild(this.labels.domElement);

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x99aabb, 1.35));
    const sun = new THREE.DirectionalLight(0xffffff, 1.25);
    sun.position.set(30, 80, 40);
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 2000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.addEventListener('start', () => {
      this.idleSpin = false;
      this.camGoal = null;
    });

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.#bindPointer();
    new ResizeObserver(() => this.#resize()).observe(container);
    this.#resize();
    this.renderer.setAnimationLoop(() => this.#tick());
  }

  show(building, stats) {
    const sameBuilding = this.building?.id === building.id;
    this.building = building;
    this.stats = stats;
    if (!sameBuilding) {
      this.plan = localFootprint(building);
      this.corePoint = findCore(this.plan);
    }
    this.#clear();

    const n = stats.floors.length;
    stats.floors.forEach((f, i) => this.#addFloor(f, i));
    this.#addCore(n);
    this.#addStreetLevel(stats.floors);

    if (!sameBuilding) {
      this.selected = null;
      this.idleSpin = true;
      const midY = ((n - 1) * GAP) / 2;
      this.controls.target.set(0, midY, 0);
      // Fit the whole stack (plus room for a lifted floor) in the field of view.
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      const fitH = (midY + 9) / tanHalf;
      const fitW = (this.plan.W / 2 + 10) / (tanHalf * Math.max(0.5, this.camera.aspect));
      const dist = Math.max(70, fitH, fitW);
      const dir = new THREE.Vector3(0.5, 0.42, 1).normalize();
      this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
      this.overview = { target: this.controls.target.clone(), pos: this.camera.position.clone() };
      this.camGoal = null;
    }
    this.#refresh();
  }

  selectFloor(index) {
    const changed = index !== this.selected;
    this.selected = index;
    this.#refresh();
    if (changed && this.overview) {
      // Zoom in on the chosen floor so its furniture and people are readable; back out when cleared.
      if (index == null) this.camGoal = { ...this.overview };
      else {
        const target = new THREE.Vector3(0, index * GAP + 1.5, 0);
        const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
        const dist = Math.max(42, (this.plan.W / 2 + 4) / (tanHalf * Math.max(0.5, this.camera.aspect)));
        const dir = new THREE.Vector3(0.45, 0.75, 1).normalize();
        this.camGoal = { target, pos: target.clone().addScaledVector(dir, dist) };
      }
    }
  }

  // Floor Claude recommended: drawn with a pulsing outline. Call before show().
  setPick(index) {
    this.pick = index != null && index >= 0 ? index : null;
  }

  #clear() {
    this.pulse = null;
    for (const g of [...this.floorGroups, this.core].filter(Boolean)) {
      g.traverse((o) => {
        if (o.isCSS2DObject) o.element.remove();
        if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      });
      this.root.remove(g);
    }
    this.floorGroups = [];
    this.core = null;
  }

  #addFloor(f, i) {
    const { polys, W } = this.plan;
    const g = new THREE.Group();
    g.position.y = i * GAP;
    g.userData.index = i;
    const mat = (opts, base = 1) => {
      const m = new THREE.MeshStandardMaterial({ transparent: true, opacity: base, ...opts });
      m.userData.baseOpacity = base;
      return m;
    };

    // Slab in the real outline; its edge carries the floor's own crowd colour.
    const shapes = shapesOf(polys);
    const slab = new THREE.Mesh(flatGeo(new THREE.ExtrudeGeometry(shapes, { depth: SLAB, bevelEnabled: false })), mat({ color: occColor(f.occupancy), roughness: 0.6 }));
    slab.userData.floorIndex = i;
    g.add(slab);

    if (i === this.pick) {
      const outline = new THREE.Mesh(
        flatGeo(new THREE.ExtrudeGeometry(shapes, { depth: SLAB + 0.6, bevelEnabled: false })),
        new THREE.MeshBasicMaterial({ color: 0x6d5cff, transparent: true, opacity: 0.5, depthWrite: false }),
      );
      outline.material.userData.baseOpacity = 0.5;
      outline.scale.set(1.07, 1, 1.07);
      outline.position.y = -0.3;
      g.add(outline);
      this.pulse = outline;
    }

    // Outer walls (and courtyard walls), low and see-through.
    const walls = new THREE.Mesh(wallGeometry(polys, SLAB, SLAB + WALL_H), mat({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.3 }, 0.42));
    g.add(walls);

    // Zones: equal bands along the long side, clipped to the outline.
    const u0 = -W / 2;
    const zw = W / f.zones.length;
    const rand = seeded(hashStr(`${this.building.id}|${f.label}`));
    const fb = new FurnitureBatch();
    f.zones.forEach((z, zi) => {
      const x0 = u0 + zw * zi;
      const x1 = x0 + zw;
      const zonePolys = polys
        .map((p) => ({ outer: clipBand(p.outer, x0, x1), holes: p.holes.map((h) => clipBand(h, x0, x1)).filter(Boolean) }))
        .filter((p) => p.outer);
      if (zonePolys.length) {
        const tile = new THREE.Mesh(
          flatGeo(new THREE.ShapeGeometry(shapesOf(zonePolys))),
          mat({ color: occColor(z.occupancy), roughness: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }),
        );
        tile.position.y = SLAB + 0.02;
        tile.userData.floorIndex = i;
        g.add(tile);
      }
      // partitions between zones
      if (zi > 0) {
        for (const [a, b] of segmentsAt(x0, polys)) {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.2, b - a - 1.2), mat({ color: 0xffffff }, 0.55));
          wall.position.set(x0, SLAB + 0.6, (a + b) / 2);
          g.add(wall);
        }
      }
      // What's in this zone, from its name: shelves, lecture seats, lab benches, café…
      const { spots: keep } = furnishZone(z.name, f.kind, {
        fb, x0, x1, D: this.plan.D, inside: (u, v) => insidePolys([u, v], polys), rand, occupancy: z.occupancy,
      });

      const zl = document.createElement('div');
      zl.className = 'zone-label';
      zl.textContent = `${z.name} · ${Math.round(z.occupancy * 100)}%`;
      const zlo = new CSS2DObject(zl);
      const c = keep[Math.floor(keep.length / 2)] ?? [(x0 + x1) / 2, 0];
      zlo.position.set(c[0], SLAB + 1.8, c[1]);
      g.add(zlo);
    });

    fb.build(g, SLAB);

    // ⚡ / 💧 markers
    const am = f.amenities;
    if (am) {
      const badge = (cls, text, title, [u, v]) => {
        const el = document.createElement('div');
        el.className = `amen-badge ${cls}`;
        el.textContent = text;
        el.title = title;
        const o = new CSS2DObject(el);
        o.position.set(u, SLAB + 2.4, v);
        g.add(o);
      };
      const est = (a) => (a.confirmed ? '' : ' est');
      if (am.power.value !== 'few') {
        badge(`power${est(am.power)}`, am.power.value === 'most' ? '⚡⚡' : '⚡', am.power.confirmed ? 'Charging confirmed by students' : 'Charging: estimate', [W / 2 - 3, -this.plan.D / 2 + 3]);
      }
      if (am.water.value) {
        const p = this.corePoint ?? [0, 0];
        badge(`water${est(am.water)}`, '💧', am.water.confirmed ? 'Water point confirmed by students' : 'Water point: estimate', [p[0] + 3, p[1]]);
        const fountain = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.1, 12), mat({ color: 0x3b9ad9, roughness: 0.3 }));
        fountain.position.set(p[0] + 2.2, SLAB + 0.55, p[1]);
        g.add(fountain);
      }
    }

    const label = document.createElement('div');
    label.className = 'floor-label';
    label.title = `${FLOOR_KIND_LABEL[f.kind]} · ${busyLabel(f.occupancy)}`;
    label.innerHTML = `<b>${f.label}</b> <span style="color:#${occColor(f.occupancy).toString(16).padStart(6, '0')}">${Math.round(f.occupancy * 100)}%</span>`;
    if (i === this.pick) {
      label.classList.add('pick');
      label.innerHTML += ' <i>✦</i>';
    }
    label.addEventListener('click', () => this.onFloorSelect(i));
    const lo = new CSS2DObject(label);
    lo.position.set(-W / 2 - 4, 0, 0);
    g.add(lo);

    this.root.add(g);
    this.floorGroups.push(g);
  }

  // Lift & stairs: a glass shaft through every floor (see findCore).
  // Basements (B1, B2, LG…) sit below a translucent "street level" plane.
  #addStreetLevel(floors) {
    const first = floors.findIndex((f) => !/^(B\d*|LG)$/i.test(f.label));
    if (first <= 0) return;
    const y = first * GAP - GAP / 2 + 0.6;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(this.plan.W + 16, this.plan.D + 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x6aa36f, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
    );
    plane.position.y = y;
    const el = document.createElement('div');
    el.className = 'street-level';
    el.textContent = '▲ Street level · basements below ▼';
    const tag = new CSS2DObject(el);
    tag.position.set(this.plan.W / 2 + 4, y, this.plan.D / 2 + 4);
    plane.add(tag);
    this.core.add(plane);
  }

  #addCore(n) {
    const [u, v] = this.corePoint;
    const h = (n - 1) * GAP + SLAB + 2.5;
    const core = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, h, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x8fb3cf, transparent: true, opacity: 0.35, roughness: 0.2, depthWrite: false }),
    );
    shaft.position.set(u, h / 2 - 0.5, v);
    core.add(shaft);
    const tag = document.createElement('div');
    tag.className = 'core-label';
    tag.textContent = 'Lift & stairs';
    const t = new CSS2DObject(tag);
    t.position.set(u, h + 0.5, v);
    core.add(t);
    this.core = core;
    this.root.add(core);
  }

  #refresh() {
    for (const g of this.floorGroups) {
      const i = g.userData.index;
      const focus = this.selected == null || this.selected === i;
      const lift = this.hover === i ? 0.8 : 0;
      g.userData.liftTarget = lift + (this.selected === i ? 1.2 : 0);
      g.traverse((o) => {
        if (o.material && !o.isInstancedMesh) {
          o.material.opacity = focus ? (o.material.userData.baseOpacity ?? 1) : 0.14;
        }
        if (o.isCSS2DObject) {
          o.element.classList.toggle('dim', !focus);
          o.element.classList.toggle('active', this.selected === i);
        }
      });
      g.children.filter((o) => o.isInstancedMesh).forEach((o) => (o.visible = focus));
    }
  }

  #bindPointer() {
    const el = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down = null;
    const pick = (ev) => {
      const r = el.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const hit = ray.intersectObjects(this.floorGroups, true).find((h) => h.object.userData.floorIndex != null);
      return hit ? hit.object.userData.floorIndex : null;
    };
    el.addEventListener('pointerdown', (ev) => (down = [ev.clientX, ev.clientY]));
    el.addEventListener('pointerup', (ev) => {
      if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 6) return;
      this.onFloorSelect(pick(ev));
    });
    el.addEventListener('pointermove', (ev) => {
      const i = pick(ev);
      if (i !== this.hover) {
        this.hover = i;
        el.style.cursor = i != null ? 'pointer' : 'grab';
        this.#refresh();
      }
    });
  }

  #resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  #tick() {
    if (this.pulse) this.pulse.material.opacity = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(performance.now() / 260));
    if (this.idleSpin) this.root.rotation.y = Math.sin(performance.now() / 2500) * 0.3;
    for (const g of this.floorGroups) {
      const base = g.userData.index * GAP;
      g.position.y += (base + (g.userData.liftTarget ?? 0) - g.position.y) * 0.15;
    }
    if (this.camGoal) {
      this.controls.target.lerp(this.camGoal.target, 0.12);
      this.camera.position.lerp(this.camGoal.pos, 0.12);
      if (this.camera.position.distanceTo(this.camGoal.pos) < 0.3) this.camGoal = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }
}
