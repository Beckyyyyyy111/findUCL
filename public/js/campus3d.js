// 3D campus map built from real OpenStreetMap footprints (public/data/map.json):
// every building at its real shape and height, with procedural facades
// (stone/brick windows, concrete ribbon windows, glass curtain walls), real
// streets, squares and rivers, plus hand-modelled UCL landmarks.
// UCL buildings are clickable; their roofs show how busy they are.

import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { BUILDINGS, CAMPUSES } from './data.js';
import { buildingStats, occColor } from './occupancy.js';

const CAMERA_OFFSET = new THREE.Vector3(-250, 330, 400);
const MUTED_WALL = new THREE.Color('#e9e7e2');
const MUTED_ROOF = new THREE.Color('#d4d3cf');
const BAY_W = 3.4; // facade texture: one window bay per 3.4 m…
const STOREY = 3.8; // …and per storey

// ---------- procedural facade textures ----------
function facadeTexture(kind, soft = false) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  if (kind === 0) {
    // punched windows in stone / brick
    g.fillStyle = '#e6e2da';
    g.fillRect(0, 54, 64, 3); // string course
    g.fillStyle = '#4d5a66';
    g.fillRect(18, 12, 28, 34);
    g.fillStyle = '#7d8c99';
    g.fillRect(18, 12, 28, 6);
    g.fillStyle = '#f4f1ea';
    g.fillRect(31, 12, 2, 34);
    g.fillRect(16, 46, 32, 3); // sill
  } else if (kind === 1) {
    // concrete with ribbon windows
    g.fillStyle = '#46525d';
    g.fillRect(0, 20, 64, 30);
    g.fillStyle = '#6f7f8c';
    g.fillRect(0, 20, 64, 6);
    g.fillStyle = '#d9d6cf';
    for (let x = 0; x < 64; x += 16) g.fillRect(x, 20, 2, 30);
  } else if (kind === 2) {
    // glass curtain wall
    const grad = g.createLinearGradient(0, 0, 64, 64);
    grad.addColorStop(0, '#6f8796');
    grad.addColorStop(1, '#9fb3bf');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#e9edf0';
    g.fillRect(0, 0, 64, 4);
    g.fillRect(0, 0, 3, 64);
    g.fillRect(32, 0, 2, 64);
  }
  if (soft) {
    // fade the windows for background buildings
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------- geometry building ----------
class GeoBuffer {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
  }
  tri(a, b, c, n, color, uvs) {
    // keep the winding consistent with the intended normal
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    if (ab.cross(ac).dot(n) < 0) {
      [b, c] = [c, b];
      if (uvs) uvs = [uvs[0], uvs[2], uvs[1]];
    }
    for (const v of [a, b, c]) {
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(n.x, n.y, n.z);
      this.col.push(color.r, color.g, color.b);
    }
    this.uv.push(...(uvs ? uvs.flat() : [0, 0, 0, 0, 0, 0]));
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
  get empty() {
    return this.pos.length === 0;
  }
}

const toRing = (flat) => {
  const r = [];
  for (let i = 0; i < flat.length; i += 2) r.push([flat[i], flat[i + 1]]);
  return r;
};
const signedArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
};
const isConvex = (r) => {
  let sign = 0;
  for (let i = 0; i < r.length; i++) {
    const [a, b, c] = [r[i], r[(i + 1) % r.length], r[(i + 2) % r.length]];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 1e-6) continue;
    if (sign && Math.sign(cr) !== sign) return false;
    sign = Math.sign(cr);
  }
  return true;
};
const bbox = (r) => {
  const xs = r.map((p) => p[0]);
  const zs = r.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
};

function addWalls(buf, ring, isHole, y0, y1, color) {
  const out = (signedArea(ring) > 0) !== isHole ? 1 : -1;
  let u = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const n = new THREE.Vector3((bz - az) * out, 0, -(bx - ax) * out).normalize();
    const a0 = new THREE.Vector3(ax, y0, az);
    const b0 = new THREE.Vector3(bx, y0, bz);
    const a1 = new THREE.Vector3(ax, y1, az);
    const b1 = new THREE.Vector3(bx, y1, bz);
    const u0 = u / BAY_W;
    const u1 = (u + len) / BAY_W;
    const v0 = y0 / STOREY;
    const v1 = y1 / STOREY;
    buf.tri(a0, b0, b1, n, color, [[u0, v0], [u1, v0], [u1, v1]]);
    buf.tri(a0, b1, a1, n, color, [[u0, v0], [u1, v1], [u0, v1]]);
    u += len;
  }
}

function addRoof(buf, outer, holes, y, shape, roofH, color) {
  const up = new THREE.Vector3(0, 1, 0);
  const pitched = ['gabled', 'hipped', 'pyramidal', 'saltbox', 'gambrel', 'quadruple_saltbox', 'mansard', 'half-hipped', 'round'];
  if (pitched.includes(shape) && !holes.length && outer.length <= 16 && isConvex(outer)) {
    // Pyramid / hip approximation: every eave meets one ridge point.
    const cx = outer.reduce((s, p) => s + p[0], 0) / outer.length;
    const cz = outer.reduce((s, p) => s + p[1], 0) / outer.length;
    const apex = new THREE.Vector3(cx, y + (roofH ?? 3), cz);
    for (let i = 0; i < outer.length; i++) {
      const a = new THREE.Vector3(outer[i][0], y, outer[i][1]);
      const b = new THREE.Vector3(outer[(i + 1) % outer.length][0], y, outer[(i + 1) % outer.length][1]);
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(apex, a)).normalize();
      if (n.y < 0) n.negate();
      buf.tri(a, b, apex, n, color);
    }
    return;
  }
  const contour = outer.map(([x, z]) => new THREE.Vector2(x, z));
  const holeV = holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
  const verts = [...contour, ...holeV.flat()];
  let tris;
  try {
    tris = THREE.ShapeUtils.triangulateShape(contour, holeV);
  } catch {
    return;
  }
  for (const [i, j, k] of tris) {
    buf.tri(
      new THREE.Vector3(verts[i].x, y, verts[i].y),
      new THREE.Vector3(verts[j].x, y, verts[j].y),
      new THREE.Vector3(verts[k].x, y, verts[k].y),
      up,
      color,
    );
  }
}

// Flat ribbon along a polyline (roads, paths, rivers).
function addRibbon(buf, flat, width, y, color) {
  const pts = toRing(flat);
  const up = new THREE.Vector3(0, 1, 0);
  const hw = width / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const nx = (-(bz - az) / len) * hw;
    const nz = ((bx - ax) / len) * hw;
    const p = [
      new THREE.Vector3(ax + nx, y, az + nz),
      new THREE.Vector3(ax - nx, y, az - nz),
      new THREE.Vector3(bx - nx, y, bz - nz),
      new THREE.Vector3(bx + nx, y, bz + nz),
    ];
    buf.tri(p[0], p[1], p[2], up, color);
    buf.tri(p[0], p[2], p[3], up, color);
    // round-ish joint so bends don't show gaps
    if (i > 0) {
      const steps = 6;
      const centre = new THREE.Vector3(ax, y, az);
      for (let s = 0; s < steps; s++) {
        const t0 = (s / steps) * Math.PI * 2;
        const t1 = ((s + 1) / steps) * Math.PI * 2;
        buf.tri(
          centre,
          new THREE.Vector3(ax + Math.cos(t0) * hw, y, az + Math.sin(t0) * hw),
          new THREE.Vector3(ax + Math.cos(t1) * hw, y, az + Math.sin(t1) * hw),
          up,
          color,
        );
      }
    }
  }
}

function addPolygon(buf, outerFlat, holesFlat, y, color) {
  addRoof(buf, toRing(outerFlat), holesFlat.map(toRing), y, 'flat', 0, color);
}

// ---------- the map ----------
export class CampusMap {
  constructor(container, { onSelect, map }) {
    this.container = container;
    this.onSelect = onSelect;
    this.mapData = map;
    this.pickable = [];
    this.byId = new Map(); // app building id -> { walls[], roofs[], label, centre, top, size }
    this.selectedId = null;
    this.hoverId = null;
    this.flyTo = null;
    this.campus = 'bloomsbury';

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'label-layer';
    container.appendChild(this.labels.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 5, 6000);
    // Left-drag rotates the view (as before); moving the map is added on top:
    // right-drag or Shift/Ctrl + left-drag, arrow keys, or the "Move" mode toggle
    // (handy on trackpads). Wheel zooms towards the cursor. Touch: one finger
    // rotates, two fingers move and zoom.
    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.setDragMode('rotate');
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = false; // pan along the ground, not the screen
    this.controls.zoomToCursor = true;
    this.controls.keyPanSpeed = 25;
    // Arrow keys pan once the map has focus (click it), so typing in inputs is unaffected.
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.addEventListener('pointerdown', () => this.renderer.domElement.focus({ preventScroll: true }));
    this.controls.listenToKeyEvents(this.renderer.domElement);
    this.controls.maxPolarAngle = Math.PI * 0.45;
    this.controls.minDistance = 60;
    this.controls.maxDistance = 1800;
    this.controls.addEventListener('start', () => (this.flyTo = null));

    this.textures = [0, 1, 2, 3].map((k) => facadeTexture(k));
    this.softTextures = [0, 1, 2, 3].map((k) => facadeTexture(k, true));
    this.#buildWorld();
    this.#bindPointer();
    this.applyTheme();
    this.showCampus('bloomsbury', true);

    new ResizeObserver(() => this.#resize()).observe(container);
    this.#resize();
    this.renderer.setAnimationLoop(() => this.#tick());
  }

  applyTheme() {
    const dark = document.documentElement.dataset.theme === 'dark' ||
      (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    this.dark = dark;
    this.scene.background = new THREE.Color(dark ? 0x10151c : 0xdfe6ea);
    this.scene.fog = new THREE.Fog(this.scene.background, 1400, 3200);
    this.groundMat.color.set(dark ? 0x232a31 : 0xeeece6);
    this.parkGroundMat.color.set(dark ? 0x26332a : 0xd9e6cc); // Queen Elizabeth Olympic Park
    this.roadMat.color.set(dark ? 0x9aa3ad : 0xffffff);
    this.pathMat.color.set(dark ? 0x7d858d : 0xffffff);
    this.greenMat.color.set(dark ? 0x6d8f72 : 0xffffff);
    for (const m of this.contextMats) m.color.set(dark ? 0x5d636b : 0xffffff);
    this.hemi.intensity = dark ? 0.7 : 1.15;
    this.sun.intensity = dark ? 1.0 : 1.9;
  }

  #buildWorld() {
    this.hemi = new THREE.HemisphereLight(0xf4f7ff, 0x8a8577, 1.15);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff4e5, 1.9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    Object.assign(sun.shadow.camera, { left: -700, right: 700, top: 700, bottom: -700, near: 10, far: 2500 });
    this.scene.add(sun, sun.target);
    this.sun = sun;

    // Ground per campus
    this.groundMat = new THREE.MeshStandardMaterial({ roughness: 1 });
    this.parkGroundMat = new THREE.MeshStandardMaterial({ roughness: 1 });
    for (const c of Object.values(CAMPUSES)) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(c.ground.w, c.ground.d), c.park ? this.parkGroundMat : this.groundMat);
      g.rotation.x = -Math.PI / 2;
      g.position.set(c.ground.x, 0, c.ground.z);
      g.receiveShadow = true;
      this.scene.add(g);
    }

    const m = this.mapData;
    const hex = (h) => new THREE.Color(h);

    // Greens, then streets, then paths, then rivers — stacked a few cm apart.
    const greens = new GeoBuffer();
    for (const gr of m.greens) addPolygon(greens, gr.outer, gr.holes, 0.15, hex('#a9cf9a'));
    this.greenMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    this.#addStatic(greens, this.greenMat, { receive: true });

    const roads = new GeoBuffer();
    const paths = new GeoBuffer();
    const ROAD = { primary: '#c3c8cd', secondary: '#c9cdd1', tertiary: '#cfd3d6', residential: '#d6d9db', unclassified: '#d6d9db', living_street: '#dcdedf', service: '#dfe1e2' };
    const PATH = { pedestrian: '#f2ede2', footway: '#f6f2e8', cycleway: '#efe9dd' };
    for (const r of m.roads) {
      if (ROAD[r.k]) addRibbon(roads, r.p, r.w, 0.3 + (r.w > 10 ? 0.02 : 0), hex(ROAD[r.k]));
      else addRibbon(paths, r.p, r.w, 0.4, hex(PATH[r.k] ?? '#f2ede2'));
    }
    this.roadMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    this.pathMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    this.#addStatic(roads, this.roadMat, { receive: true });
    this.#addStatic(paths, this.pathMat, { receive: true });

    const water = new GeoBuffer();
    for (const w of m.water) addRibbon(water, w.p, w.w, 0.5, hex('#79b3d4'));
    this.#addStatic(water, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.1 }), { receive: true });

    // Buildings: context merged by facade style; UCL ones grouped per building.
    const ctxWalls = [0, 1, 2, 3].map(() => new GeoBuffer());
    const ctxRoofs = new GeoBuffer();
    const ucl = new Map();
    for (const b of m.buildings) {
      if (b.osm === 'way/149637725') continue; // Orbit — drawn as a sculpture below
      if (b.ucl === 'main-library' && b.name === 'Portico') continue; // hand-modelled in #landmarks()
      const outer = toRing(b.outer);
      const holes = b.holes.map(toRing);
      // Context buildings are muted so UCL's stand out.
      const wallC = b.ucl ? hex(b.wall) : hex(b.wall).lerp(MUTED_WALL, 0.55);
      const roofC = b.ucl ? hex(b.roofC) : hex(b.roofC).lerp(MUTED_ROOF, 0.7);
      let walls;
      let roofs;
      if (b.ucl) {
        const u = ucl.get(b.ucl) ?? { walls: [0, 1, 2, 3].map(() => new GeoBuffer()), roofs: new GeoBuffer() };
        ucl.set(b.ucl, u);
        walls = u.walls[b.t];
        roofs = u.roofs;
      } else {
        walls = ctxWalls[b.t];
        roofs = ctxRoofs;
      }
      if (b.roof === 'dome') {
        this.#dome(b, outer, b.ucl);
        continue;
      }
      addWalls(walls, outer, false, b.minH, b.h, wallC);
      for (const h of holes) addWalls(walls, h, true, b.minH, b.h, wallC);
      addRoof(roofs, outer, holes, b.h, b.roof, b.roofH, roofC);
    }
    this.contextMats = [];
    ctxWalls.forEach((buf, t) => {
      const mat = new THREE.MeshStandardMaterial({ map: this.softTextures[t], vertexColors: true, roughness: 0.9 });
      this.contextMats.push(mat);
      this.#addStatic(buf, mat, { cast: true, receive: true });
    });
    const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    this.contextMats.push(roofMat);
    this.#addStatic(ctxRoofs, roofMat, { cast: true, receive: true });

    const extra = new Map((m.uclExtra ?? []).map((x) => [x.id, x]));
    for (const [id, u] of ucl) {
      const info = m.ucl[id];
      const app = BUILDINGS.find((b) => b.id === id); // halls aren't app buildings
      const entry = { walls: [], roofs: [], centre: new THREE.Vector3(info.x, 0, info.z), top: info.top, size: Math.max(info.w, info.d), app };
      const clickable = (mesh) => {
        if (!app) return;
        mesh.userData.buildingId = id;
        this.pickable.push(mesh);
      };
      u.walls.forEach((buf, t) => {
        if (buf.empty) return;
        const mat = new THREE.MeshStandardMaterial({ map: this.textures[t], vertexColors: true, roughness: t === 2 ? 0.35 : 0.8, metalness: t === 2 ? 0.15 : 0 });
        const mesh = this.#addStatic(buf, mat, { cast: true, receive: true });
        clickable(mesh);
        entry.walls.push(mesh);
      });
      if (!u.roofs.empty) {
        // Roof colour = crowd level (set in update()); halls get a plain UCL-purple roof.
        const mesh = this.#addStatic(u.roofs, new THREE.MeshStandardMaterial({ color: app ? 0xcccccc : 0x8f86b8, roughness: 0.7 }), { cast: true, receive: true });
        clickable(mesh);
        if (app) entry.roofs.push(mesh);
      }
      const x = extra.get(id);
      if (!x) entry.label = this.#buildingLabel(id, info, 'major');
      else if (x.kind === 'hall') this.#buildingLabel(id, info, 'hall', x.name);
      else if (x.named) entry.label = this.#buildingLabel(id, info, 'minor');
      if (app) this.byId.set(id, entry);
    }
    for (const d of this.domes ?? []) {
      if (d.ucl && this.byId.has(d.ucl)) {
        this.byId.get(d.ucl).roofs.push(d.mesh);
        d.mesh.userData.buildingId = d.ucl;
        this.pickable.push(d.mesh);
      }
    }

    this.#landmarks();
    for (const l of m.labels) if (l.kind !== 'street' || l.major) this.#mapLabel(l);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 72),
      new THREE.MeshBasicMaterial({ color: 0x4b3cf0, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.ring);

    // "You are here" pin
    this.me = new THREE.Group();
    const pinMat = new THREE.MeshStandardMaterial({ color: 0x4b3cf0, emissive: 0x4b3cf0, emissiveIntensity: 0.35 });
    const pin = new THREE.Mesh(new THREE.ConeGeometry(4, 12, 16), pinMat);
    pin.rotation.x = Math.PI;
    pin.position.y = 10;
    const head = new THREE.Mesh(new THREE.SphereGeometry(5, 20, 14), pinMat);
    head.position.y = 19;
    this.me.add(pin, head);
    this.me.visible = false;
    this.scene.add(this.me);
  }

  #addStatic(buf, material, { cast = false, receive = false } = {}) {
    if (buf.empty) return null;
    const mesh = new THREE.Mesh(buf.geometry(), material);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    this.scene.add(mesh);
    return mesh;
  }

  // Drum + dome (e.g. the Wilkins Building's Octagon).
  #dome(b, outer, ucl) {
    const bb = bbox(outer);
    const r = Math.min(bb.x1 - bb.x0, bb.z1 - bb.z0) / 2;
    const cx = (bb.x0 + bb.x1) / 2;
    const cz = (bb.z0 + bb.z1) / 2;
    const group = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: b.wall, roughness: 0.8 });
    // Big domes sit on a tall drum (Wilkins); small ones like the Quad observatories don't.
    const drumH = r > 4 ? Math.max(3, b.h - b.minH) + 4 : Math.max(1.5, (b.h - b.minH) * 0.55);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.92, drumH, 24), stone);
    drum.position.set(cx, b.minH + drumH / 2, cz);
    const domeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    dome.position.set(cx, b.minH + drumH, cz);
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.18, r * 0.22, r * 0.5, 12), stone);
    lantern.position.set(cx, b.minH + drumH + r + r * 0.2, cz);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 0.2, 12, 8), domeMat);
    cap.position.set(cx, b.minH + drumH + r + r * 0.5, cz);
    for (const o of [drum, dome, lantern, cap]) {
      o.castShadow = true;
      group.add(o);
    }
    this.scene.add(group);
    (this.domes ??= []).push({ ucl, mesh: dome });
    if (ucl) {
      drum.userData.buildingId = ucl;
      this.pickable.push(drum);
    }
  }

  // Hand-made details OSM can't express.
  #landmarks() {
    const m = this.mapData;
    const stone = new THREE.MeshStandardMaterial({ color: 0xeee8d8, roughness: 0.75 });
    const add = (mesh, id) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (id) {
        mesh.userData.buildingId = id;
        this.pickable.push(mesh);
      }
      this.scene.add(mesh);
      return mesh;
    };

    // Wilkins Building portico: ten Corinthian columns, pediment and steps, facing the Main Quad (west).
    const portico = m.buildings.find((b) => b.ucl === 'main-library' && /Portico/.test(b.name ?? '')) ??
      m.buildings.filter((b) => b.ucl === 'main-library').find((b) => {
        const bb = bbox(toRing(b.outer));
        return Math.abs((bb.x0 + bb.x1) / 2 - 20) < 6 && Math.abs((bb.z0 + bb.z1) / 2 + 6) < 6;
      });
    if (portico) {
      // Oriented bounding box of the portico footprint, so the colonnade follows
      // the building's real angle (Bloomsbury's grid is tilted ~20° off north).
      const ring = toRing(portico.outer);
      let best = null;
      for (let i = 0; i < ring.length; i++) {
        const [ax, az] = ring[i];
        const [bx, bz] = ring[(i + 1) % ring.length];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 1) continue;
        const ux = (bx - ax) / len, uz = (bz - az) / len; // along the edge
        const vx = -uz, vz = ux; // perpendicular
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        for (const [px, pz] of ring) {
          const u = px * ux + pz * uz, v = px * vx + pz * vz;
          u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
        }
        const area = (u1 - u0) * (v1 - v0);
        if (!best || area < best.area) best = { area, ux, uz, vx, vz, u0, u1, v0, v1 };
      }
      // Of the four sides, the front is the one facing the Main Quad (west, −x).
      const { ux, uz, vx, vz, u0, u1, v0, v1 } = best;
      const sides = [
        { n: [-vx, -vz], c: [(u0 + u1) / 2, v0], width: u1 - u0, depth: v1 - v0 },
        { n: [vx, vz], c: [(u0 + u1) / 2, v1], width: u1 - u0, depth: v1 - v0 },
        { n: [-ux, -uz], c: [u0, (v0 + v1) / 2], width: v1 - v0, depth: u1 - u0 },
        { n: [ux, uz], c: [u1, (v0 + v1) / 2], width: v1 - v0, depth: u1 - u0 },
      ];
      const front = sides.reduce((a, b) => (b.n[0] < a.n[0] ? b : a));
      const fx = front.c[0] * ux + front.c[1] * vx;
      const fz = front.c[0] * uz + front.c[1] * vz;
      // Local frame: origin at the middle of the front edge, +X pointing into the building.
      const g = new THREE.Group();
      g.position.set(fx, 0, fz);
      g.rotation.y = Math.atan2(front.n[1], -front.n[0]);
      const span = Math.min(30, front.width - 3);
      const podiumH = 3.5;
      const colH = 13;
      const depth = Math.min(9, front.depth);
      const part = (mesh) => {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.buildingId = 'main-library';
        this.pickable.push(mesh);
        g.add(mesh);
      };
      for (let s = 0; s < 4; s++) {
        const out = (4 - s) * 1.2; // each step reaches a little less far out
        const step = new THREE.Mesh(new THREE.BoxGeometry(depth + out, 0.9, span + 8 - s * 1.5), stone);
        step.position.set((depth - out) / 2, 0.45 + s * 0.9, 0);
        part(step);
      }
      const deck = new THREE.Mesh(new THREE.BoxGeometry(depth, podiumH, span + 4), stone);
      deck.position.set(depth / 2, podiumH / 2, 0);
      part(deck);
      const colGeo = new THREE.CylinderGeometry(0.75, 0.9, colH, 14);
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 10; i++) {
          const col = new THREE.Mesh(colGeo, stone);
          col.position.set(1.6 + row * 4, podiumH + colH / 2, -span / 2 + (span * i) / 9);
          part(col);
        }
      }
      const entab = new THREE.Mesh(new THREE.BoxGeometry(depth - 0.5, 2.2, span + 3), stone);
      entab.position.set((depth - 0.5) / 2, podiumH + colH + 1.1, 0);
      part(entab);
      const tri = new THREE.Shape();
      tri.moveTo(-(span + 3) / 2, 0);
      tri.lineTo((span + 3) / 2, 0);
      tri.lineTo(0, 5.5);
      tri.closePath();
      const ped = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: depth - 0.5, bevelEnabled: false }), stone);
      ped.rotation.y = Math.PI / 2; // width along the front, depth into the building
      ped.position.set(0, podiumH + colH + 2.2, 0);
      part(ped);
      this.scene.add(g);
    }

    // Cruciform: the octagonal central tower with its lantern spire at the crossing.
    const cru = m.ucl.cruciform;
    if (cru) {
      const brick = new THREE.MeshStandardMaterial({ color: 0xa24a35, roughness: 0.85 });
      const lead = new THREE.MeshStandardMaterial({ color: 0x55605d, roughness: 0.6 });
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 7, 31, 8), brick);
      tower.position.set(cru.x, 15.5, cru.z);
      add(tower, 'cruciform');
      const lantern = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4.2, 6, 8), stone);
      lantern.position.set(cru.x, 34, cru.z);
      add(lantern, 'cruciform');
      const spire = new THREE.Mesh(new THREE.ConeGeometry(4.2, 9, 8), lead);
      spire.position.set(cru.x, 41.5, cru.z);
      add(spire, 'cruciform');
    }

    // ArcelorMittal Orbit at UCL East: a red looping steel tower.
    const orbit = m.buildings.find((b) => b.osm === 'way/149637725');
    if (orbit) {
      const bb = bbox(toRing(orbit.outer));
      const cx = (bb.x0 + bb.x1) / 2;
      const cz = (bb.z0 + bb.z1) / 2;
      const pts = [];
      for (let i = 0; i <= 120; i++) {
        const t = i / 120;
        const a = t * Math.PI * 5;
        const r = 14 * (1 - t * 0.55) + 4 * Math.sin(a * 1.7);
        pts.push(new THREE.Vector3(cx + Math.cos(a) * r, t * 100, cz + Math.sin(a) * r));
      }
      const red = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.5, metalness: 0.3 });
      add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 300, 2.2, 8), red));
      const deck = new THREE.Mesh(new THREE.CylinderGeometry(9, 7, 8, 16), red);
      deck.position.set(cx, 96, cz);
      add(deck);
    }
  }

  // kind: 'major' (tracked study buildings), 'minor' (other UCL buildings, shown
  // when zoomed in) or 'hall' (halls of residence, not clickable).
  #buildingLabel(id, info, kind, name) {
    const b = BUILDINGS.find((x) => x.id === id);
    const div = document.createElement('div');
    div.className = `bldg-label ${kind}`;
    div.innerHTML = kind === 'hall'
      ? '<span class="icon">🛏</span><span class="name"></span>'
      : `<span class="dot"></span><span class="name"></span><span class="pct"></span>`;
    div.querySelector('.name').textContent = name ?? b?.name ?? id;
    if (kind !== 'hall') div.addEventListener('click', () => this.onSelect(id));
    const label = new CSS2DObject(div);
    label.position.set(info.x, info.top + (kind === 'major' ? 8 : 4), info.z);
    this.scene.add(label);
    return div;
  }

  #mapLabel(l) {
    const div = document.createElement('div');
    div.className = `map-label ${l.kind}`;
    div.textContent = l.name;
    const obj = new CSS2DObject(div);
    obj.position.set(l.x, 1, l.z);
    this.scene.add(obj);
  }

  update(date) {
    for (const b of BUILDINGS) {
      const entry = this.byId.get(b.id);
      if (!entry) continue;
      const s = buildingStats(b, date);
      const color = occColor(s.occupancy);
      for (const m of entry.roofs) m.material.color.setHex(color);
      entry.occColor = color;
      if (entry.label) {
        entry.label.querySelector('.dot').style.background = '#' + color.toString(16).padStart(6, '0');
        entry.label.querySelector('.pct').textContent = `${Math.round(s.occupancy * 100)}%`;
      }
    }
    this.#refreshHighlights();
  }

  showCampus(id, instant = false) {
    const [x, z] = CAMPUSES[id].target;
    const target = new THREE.Vector3(x, 0, z);
    const pos = target.clone().add(CAMERA_OFFSET);
    if (instant) {
      this.controls.target.copy(target);
      this.camera.position.copy(pos);
    } else {
      this.flyTo = { target, pos };
    }
    // keep the shadow camera over the campus we're looking at
    this.sun.target.position.copy(target);
    this.sun.position.set(x - 500, 800, z + 350);
    this.campus = id;
  }

  setView(pos, target) {
    this.flyTo = null;
    this.camera.position.set(...pos);
    this.controls.target.set(...target);
  }

  setMe(pos) {
    this.me.visible = !!pos;
    if (pos) this.me.position.set(pos.x, 0, pos.z);
  }

  select(id) {
    this.selectedId = id;
    this.#refreshHighlights();
    if (!id) {
      this.showCampus(this.campus ?? 'bloomsbury');
      return;
    }
    const e = this.byId.get(id);
    if (!e) return;
    const target = e.centre.clone().setY(e.top / 3);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.flyTo = { target, pos: target.clone().add(dir.multiplyScalar(Math.max(260, e.size * 3 + e.top * 2.5))) };
  }

  #refreshHighlights() {
    for (const [id, e] of this.byId) {
      const sel = id === this.selectedId;
      const hov = id === this.hoverId;
      for (const m of [...e.walls, ...e.roofs]) {
        m.material.emissive?.setHex(sel ? 0x1c1c1c : hov ? 0x262626 : 0x000000);
      }
      e.label?.classList.toggle('selected', sel);
      e.label?.classList.toggle('dim', !!this.selectedId && !sel);
    }
    const e = this.byId.get(this.selectedId);
    this.ring.visible = !!e;
    if (e) {
      this.ring.position.set(e.centre.x, 1, e.centre.z);
      this.ring.userData.base = e.size * 0.62;
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
      return ray.intersectObjects(this.pickable, false)[0]?.object.userData.buildingId ?? null;
    };
    el.addEventListener('pointerdown', (ev) => (down = [ev.clientX, ev.clientY]));
    el.addEventListener('pointerup', (ev) => {
      if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 6) return;
      this.onSelect(pick(ev));
    });
    let last = 0;
    el.addEventListener('pointermove', (ev) => {
      if (performance.now() - last < 50) return; // raycasting thousands of triangles: throttle
      last = performance.now();
      const id = pick(ev);
      if (id !== this.hoverId) {
        this.hoverId = id;
        el.style.cursor = id ? 'pointer' : 'grab';
        this.#refreshHighlights();
      }
    });
  }

  // 'rotate': left-drag rotates, right-drag moves. 'move': left-drag moves, right-drag rotates.
  setDragMode(mode) {
    const { ROTATE, PAN, DOLLY } = THREE.MOUSE;
    const { ROTATE: T_ROTATE, PAN: T_PAN, DOLLY_PAN } = THREE.TOUCH;
    this.dragMode = mode;
    this.controls.mouseButtons = mode === 'move'
      ? { LEFT: PAN, MIDDLE: DOLLY, RIGHT: ROTATE }
      : { LEFT: ROTATE, MIDDLE: DOLLY, RIGHT: PAN };
    this.controls.touches = { ONE: mode === 'move' ? T_PAN : T_ROTATE, TWO: DOLLY_PAN };
  }

  // Don't let a drag wander off the edge of the campus into empty space.
  #clampToCampus() {
    const g = CAMPUSES[this.campus ?? 'bloomsbury'].ground;
    const t = this.controls.target;
    const x = Math.min(g.x + g.w / 2 - 80, Math.max(g.x - g.w / 2 + 80, t.x));
    const z = Math.min(g.z + g.d / 2 - 80, Math.max(g.z - g.d / 2 + 80, t.z));
    if (x !== t.x || z !== t.z) {
      const dx = x - t.x;
      const dz = z - t.z;
      t.x = x;
      t.z = z;
      this.camera.position.x += dx;
      this.camera.position.z += dz;
    }
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
    if (this.flyTo) {
      // Hopping between campuses: cut, don't fly over kilometres of nothing.
      const t = this.controls.target.distanceTo(this.flyTo.target) > 1000 ? 1 : 0.08;
      this.controls.target.lerp(this.flyTo.target, t);
      this.camera.position.lerp(this.flyTo.pos, t);
      if (this.camera.position.distanceTo(this.flyTo.pos) < 1) this.flyTo = null;
    }
    if (this.me.visible) this.me.children[1].position.y = 19 + Math.sin(performance.now() / 300) * 1.5;
    if (this.ring.visible) {
      const t = (performance.now() / 1400) % 1;
      this.ring.scale.setScalar(this.ring.userData.base * (1 + t * 0.5));
      this.ring.material.opacity = 1 - t;
    }
    this.controls.update();
    this.#clampToCampus();
    const far = this.camera.position.distanceTo(this.controls.target) > 430;
    if (far !== this.far) {
      this.far = far;
      this.labels.domElement.classList.toggle('far', far);
    }
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }
}
