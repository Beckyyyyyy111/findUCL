import {
  BUILDINGS, BOOKING_CHECKED, CAMPUSES, FLOOR_KIND_LABEL, LIVE_SEATS_URL, POWER_LABEL, bookingFor, hasOfficialSeatCounts, buildingCentre, campusOf, findBuilding, latLngToLocal,
  searchBuildings, setMapGeometry, walkMinutes,
} from './data.js';
import {
  buildingStats, busyLabel, campusSnapshot, floorStats, liveSource, noiseLabel, occCss, rankStudySpots,
  reportCount, setShared,
} from './occupancy.js';
import { CampusMap } from './campus3d.js';
import { BuildingView } from './building3d.js';
import { measureNoise } from './noise.js';
import { floorPlanSVG } from './floorplan.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------- per-device preferences (best effort; the app works without storage) ----------
const LS = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(`spacefinder.${key}`)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`spacefinder.${key}`, JSON.stringify(value));
    } catch {
      /* private mode etc. */
    }
  },
};
const prefs = {
  favs: LS.get('favs', []), // ["student-centre|5", "main-library|"]
  alerts: LS.get('alerts', []), // [{ buildingId, floor, threshold }]
  me: LS.get('me', null), // { label, campus, x, z, buildingId? }
  timetable: LS.get('timetable', ''),
  profile: LS.get('profile', { name: '', subject: '' }),
  checkin: LS.get('checkin', null), // { id, buildingId, floor, at }
};
const save = (key) => LS.set(key, prefs[key]);

const state = {
  offsetSteps: 0, // time slider, 30 min per step
  buildingId: null,
  floorIndex: null,
  campus: 'bloomsbury',
  pick: null, // Claude's recommendation { buildingId, floor }
  explorer: false, // big floor explorer open?
  reportFloor: null, // floor chosen in the report bar
};

// Which AI answers (set by the server: Gemini or Claude).
let AI_NAME = 'Claude';
fetch('/api/config')
  .then((r) => r.json())
  .then((c) => {
    AI_NAME = c.ai || AI_NAME;
    document.querySelectorAll('.ai-name').forEach((el) => (el.textContent = AI_NAME));
    if (mapReady) renderAll(); // otherwise the first render picks it up
  })
  .catch(() => {});

const viewDate = () => new Date(Date.now() + state.offsetSteps * 30 * 60 * 1000);
const hhmm = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const minsAgo = (t) => Math.max(0, Math.round((Date.now() - t) / 60000));
// "just now" / "4 min ago" / "11:20"
const ago = (t) => {
  if (!t) return 'unknown';
  const m = minsAgo(t);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : hhmm(t);
};

// What students can tap when they're in a building.
const REPORTS = {
  noisy: { icon: '📣', label: 'Noisy here' },
  quiet: { icon: '🤫', label: 'Quiet here' },
  seats: { icon: '🪑', label: 'Seats free' },
  crowded: { icon: '🚫', label: 'Crowded' },
};



// ---------- server ----------
async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function refreshShared() {
  try {
    const s = await fetch('/api/state').then((r) => r.json());
    setShared(s);
    // Forget our own check-in if the server expired it.
    if (prefs.checkin && Date.now() - prefs.checkin.at > 4 * 3600 * 1000) {
      prefs.checkin = null;
      save('checkin');
    }
  } catch {
    /* offline — keep last state */
  }
  renderSourcePill();
  checkAlerts();
  renderAll();
}
setInterval(refreshShared, 20 * 1000);

function renderSourcePill() {
  const live = liveSource();
  const pill = $('#source-pill');
  const isLive = live.source === 'uclapi' && !live.error;
  pill.textContent = isLive ? '● Live UCL sensors' : 'Simulated + student reports';
  pill.classList.toggle('live', isLive);
  pill.title = isLive
    ? `Desk sensors via UCL API, updated ${hhmm(live.updatedAt)}`
    : `No live sensor feed (${live.error || 'not configured'}). Using a time-of-day model plus live student reports.`;
}

// ---------- toasts & notifications ----------
function toast(html, ms = 5000) {
  const div = document.createElement('div');
  div.className = 'toast';
  div.innerHTML = html;
  $('#toasts').appendChild(div);
  setTimeout(() => div.remove(), ms);
}

function checkAlerts() {
  const now = new Date();
  const remaining = [];
  for (const a of prefs.alerts) {
    const b = findBuilding(a.buildingId);
    const fi = b?.floors.findIndex((f) => f.label === a.floor) ?? -1;
    if (fi < 0) continue;
    const pct = Math.round(floorStats(b, fi, now).occupancy * 100);
    if (pct <= a.threshold) {
      const text = `${b.name} floor ${a.floor} is now ${pct}% full — under your ${a.threshold}% alert.`;
      toast(`🔔 ${esc(text)}`, 10000);
      try {
        if (Notification.permission === 'granted') new Notification('SpaceFinder', { body: text });
      } catch {
        /* notifications unsupported */
      }
    } else {
      remaining.push(a);
    }
  }
  if (remaining.length !== prefs.alerts.length) {
    prefs.alerts = remaining;
    save('alerts');
  }
}

// ---------- 3D views ----------
const mapData = await fetch('data/map.json').then((r) => r.json());
setMapGeometry(mapData);
const map = new CampusMap($('#map'), { onSelect: (id) => selectBuilding(id), map: mapData });
map.setMe(prefs.me);
var mapReady = true; // eslint-disable-line no-var -- hoisted so the early /api/config callback can check it

// Rotate / Move toggle for what a left-drag does on the map.
document.querySelectorAll('.drag-mode button').forEach((btn) =>
  btn.addEventListener('click', () => {
    map.setDragMode(btn.dataset.mode);
    document.querySelectorAll('.drag-mode button').forEach((x) => x.classList.toggle('active', x === btn));
    document.querySelector('.map-tools').dataset.mode = btn.dataset.mode;
  }),
);
let interior = null; // created lazily once the panel is visible so it gets a real size

// ---------- rendering ----------
function renderAll() {
  const d = viewDate();
  // The second part is hidden on phones to keep the top bar on one line.
  $('#time-label').innerHTML = state.offsetSteps === 0
    ? `Now<span class="tl-extra"> · ${hhmm(d)}</span>`
    : `${hhmm(d)}<span class="tl-extra"> (forecast)</span>`;
  $('#spots-when').textContent = state.offsetSteps === 0 ? 'right now' : `at ${hhmm(d)}`;
  map.update(d);
  renderSpots(d);
  renderMe();
  if (state.buildingId) renderDetail();
}

function renderSpots(d) {
  const list = $('#spots');
  list.innerHTML = '';
  for (const s of rankStudySpots(d, 6, { campus: state.campus, from: prefs.me })) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="bar" style="background:${occCss(s.floor.occupancy)}"></span>
      <span><div class="title"></div><div class="sub"></div></span>
      <span class="pct">${Math.round(s.floor.occupancy * 100)}%</span>`;
    li.querySelector('.title').textContent = s.building.name;
    li.querySelector('.sub').textContent = [
      `Floor ${s.floor.label}`,
      FLOOR_KIND_LABEL[s.floor.kind],
      s.walk != null ? `🚶 ${s.walk} min` : `${s.floor.seatsFree} seats free`,
      s.floor.live ? '● live' : null,
    ]
      .filter(Boolean)
      .join(' · ');
    li.addEventListener('click', () => {
      selectBuilding(s.building.id);
      selectFloor(s.building.floors.findIndex((f) => f.label === s.floor.label));
    });
    list.appendChild(li);
  }
}

// ---------- "Me" card: location, timetable, favourites, alerts ----------
function initMe() {
  const sel = $('#me-location');
  for (const [cid, c] of Object.entries(CAMPUSES)) {
    const group = document.createElement('optgroup');
    group.label = c.name;
    BUILDINGS.filter((b) => campusOf(b) === cid).forEach((b) => group.appendChild(new Option(b.name, b.id)));
    sel.appendChild(group);
  }
  if (prefs.me?.label === 'GPS location') sel.appendChild(new Option('📍 GPS location', 'gps'));
  sel.value = prefs.me ? prefs.me.buildingId ?? 'gps' : '';
  sel.addEventListener('change', () => {
    const b = findBuilding(sel.value);
    if (sel.value === 'gps') return;
    setMe(b ? { label: b.name, buildingId: b.id, campus: campusOf(b), ...buildingCentre(b) } : null);
  });

  $('#me-gps').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Location is not available in this browser.');
    toast('📍 Finding you…', 2500);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const p = latLngToLocal(coords.latitude, coords.longitude);
        if (p.dist > 3000) {
          toast(`You seem to be ~${(p.dist / 1000).toFixed(1)} km from campus. Pick a building instead.`);
          return;
        }
        if (![...sel.options].some((o) => o.value === 'gps')) sel.appendChild(new Option('📍 GPS location', 'gps'));
        sel.value = 'gps';
        setMe({ label: 'GPS location', campus: p.campus, x: p.x, z: p.z });
        switchCampus(p.campus);
      },
      (err) => toast(`Couldn't get your location (${esc(err.message)}).`),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });

  const tt = $('#me-timetable');
  tt.value = prefs.timetable;
  tt.addEventListener('input', () => {
    prefs.timetable = tt.value;
    save('timetable');
  });
  if (!prefs.me && !prefs.favs.length) $('#me-card').open = false;
  else $('#me-card').open = true;
}

function setMe(me) {
  prefs.me = me;
  save('me');
  map.setMe(me);
  renderAll();
}

const favKey = (buildingId, floor = '') => `${buildingId}|${floor}`;
const isFav = (buildingId, floor) => prefs.favs.includes(favKey(buildingId, floor));
function toggleFav(buildingId, floor) {
  const k = favKey(buildingId, floor);
  prefs.favs = isFav(buildingId, floor) ? prefs.favs.filter((f) => f !== k) : [...prefs.favs, k];
  save('favs');
  renderAll();
}
function favLabel(k) {
  const [id, floor] = k.split('|');
  const b = findBuilding(id);
  return b ? `${b.name}${floor ? ` · floor ${floor}` : ''}` : k;
}

function renderMe() {
  $('#me-summary').textContent = prefs.me ? `near ${prefs.me.label}` : 'set your location';
  const d = viewDate();

  const favs = $('#favs');
  favs.innerHTML = '';
  if (!prefs.favs.length) favs.innerHTML = '<li class="muted">Tap ☆ on a building or floor to save it.</li>';
  for (const k of prefs.favs) {
    const [id, floor] = k.split('|');
    const b = findBuilding(id);
    if (!b) continue;
    const fi = b.floors.findIndex((f) => f.label === floor);
    const occ = fi >= 0 ? floorStats(b, fi, d).occupancy : buildingStats(b, d).occupancy;
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot" style="background:${occCss(occ)}"></span><span class="grow">${esc(
      favLabel(k),
    )}</span><b>${Math.round(occ * 100)}%</b>`;
    li.addEventListener('click', () => {
      selectBuilding(id);
      if (fi >= 0) selectFloor(fi);
    });
    favs.appendChild(li);
  }

  const alerts = $('#alerts');
  alerts.innerHTML = '';
  if (!prefs.alerts.length) alerts.innerHTML = '<li class="muted">Open a floor and set "alert me when quiet".</li>';
  prefs.alerts.forEach((a, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="grow">${esc(favLabel(favKey(a.buildingId, a.floor)))} &lt; ${a.threshold}%</span>`;
    const rm = document.createElement('button');
    rm.className = 'x';
    rm.textContent = '✕';
    rm.title = 'Remove alert';
    rm.addEventListener('click', () => {
      prefs.alerts.splice(i, 1);
      save('alerts');
      renderAll();
    });
    li.appendChild(rm);
    alerts.appendChild(li);
  });
}

// ---------- building detail ----------
function renderDetail() {
  const b = findBuilding(state.buildingId);
  const s = buildingStats(b, viewDate());

  $('#d-name').textContent = b.name;
  const fav = $('#d-fav');
  fav.textContent = isFav(b.id, '') ? '★' : '☆';
  fav.classList.toggle('on', isFav(b.id, ''));

  // With a floor selected the badges describe that floor, otherwise the whole building.
  const sel = state.floorIndex != null ? s.floors[state.floorIndex] : null;
  const occNow = sel ? sel.occupancy : s.occupancy;
  const dbNow = sel ? sel.noise : s.noise;
  const where = sel ? `Floor ${sel.label} · ` : '';
  const busy = $('#d-busy');
  busy.textContent = `${where}${busyLabel(occNow)} · ${Math.round(occNow * 100)}%`;
  busy.style.background = occCss(occNow);
  const noise = $('#d-noise');
  noise.textContent = `${where}${noiseLabel(dbNow)} · ~${dbNow} dB`;
  noise.style.background = occCss((dbNow - 25) / 45);
  const walk = walkMinutes(prefs.me, b);
  $('#d-walk').hidden = walk == null;
  $('#d-walk').textContent = `🚶 ${walk} min from ${prefs.me?.label ?? ''}`;
  $('#d-live').hidden = !s.live;
  const n = reportCount(b.id) + s.checkins;
  $('#d-reports').hidden = n === 0 || state.offsetSteps !== 0;
  $('#d-reports').textContent = `👥 ${n} student update${n === 1 ? '' : 's'}`;

  $('#d-verdict').innerHTML = b.generic
    ? `🏛 <b>UCL teaching building.</b> Teaching rooms and offices, no dedicated study space, so floor numbers are a generic estimate. Overall it's ${busyLabel(s.occupancy).toLowerCase()} (${Math.round(s.occupancy * 100)}%).`
    : verdict(b, s);
  const booking = bookingFor(b);
  const book = $('#d-book');
  book.hidden = !booking.bookable;
  book.href = booking.links[0].url;
  book.textContent = `📅 ${booking.links[0].label} ↗`;

  const ul = $('#d-floors');
  ul.innerHTML = '';
  s.floors.forEach((f, i) => {
    const li = document.createElement('li');
    li.classList.toggle('active', i === state.floorIndex);
    const picked = state.pick?.buildingId === b.id && state.pick.floor === f.label;
    li.classList.toggle('pick', picked);
    const tags = [
      picked ? `<span class="tag pick">✦ ${AI_NAME} pick</span>` : '',
      f === s.best ? '<span class="tag best">BEST</span>' : '',
      f.live ? '<span class="tag live">LIVE</span>' : '',
      isFav(b.id, f.label) ? '<span class="tag fav">★</span>' : '',
      f.checkins.length ? `<span class="tag">👥 ${f.checkins.length}</span>` : '',
    ].join('');
    li.innerHTML = `
      <span class="fl">${f.label}</span>
      <span class="kind">${FLOOR_KIND_LABEL[f.kind]}${tags}
        <small>${busyLabel(f.occupancy)} · ${noiseLabel(f.noise)} · ${f.seatsFree} free ${amenityIcons(f)}</small></span>
      <span class="meter"><i style="width:${Math.round(f.occupancy * 100)}%;background:${occCss(f.occupancy)}"></i></span>`;
    li.addEventListener('click', () => selectFloor(i));
    ul.appendChild(li);
  });

  if (!interior) interior = new BuildingView($('#building-view'), { onFloorSelect: (i) => selectFloor(i) });
  interior.setPick(state.pick?.buildingId === b.id ? b.floors.findIndex((x) => x.label === state.pick.floor) : null);
  interior.show(b, s);
  interior.selectFloor(state.floorIndex);
  renderReportBar(b, s);
  if (state.explorer) renderExplorer(b, s);

  // Don't wipe a half-typed check-in form on the background refresh
  // (only while typing: a focused button must not block the update).
  const box = $('#d-floor-detail');
  const typing = box.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (!typing || box.dataset.for !== `${b.id}|${state.floorIndex}`) {
    renderFloorDetail(b, s);
  }
}

function verdict(b, s) {
  const best = `floor <b>${s.best.label}</b> (${FLOOR_KIND_LABEL[s.best.kind].toLowerCase()}, ${Math.round(
    s.best.occupancy * 100,
  )}% full)`;
  if (s.occupancy >= 0.78) {
    const alt = rankStudySpots(viewDate(), 10, { from: prefs.me, campus: campusOf(b) }).find((x) => x.building.id !== b.id);
    if (!alt) return `🚫 <b>Very busy right now.</b> Try again later or check another campus.`;
    const altWalk = alt.walk != null ? `, ${alt.walk} min walk` : '';
    return `🚫 <b>Very busy right now.</b> Consider ${esc(alt.building.name)}, floor ${alt.floor.label} instead (${Math.round(
      alt.floor.occupancy * 100,
    )}% full${altWalk}).`;
  }
  if (s.occupancy >= 0.55) return `⚠️ <b>Getting busy.</b> Your best bet is ${best}.`;
  return `✅ <b>Good time to go.</b> Head to ${best}.`;
}

function renderFloorDetail(b, s) {
  const box = $('#d-floor-detail');
  box.dataset.for = `${b.id}|${state.floorIndex}`;
  if (state.floorIndex == null) {
    box.hidden = true;
    return;
  }
  const f = s.floors[state.floorIndex];
  const now = state.offsetSteps === 0;
  const mine = prefs.checkin;
  const hereMine = mine && mine.buildingId === b.id && mine.floor === f.label;
  const others = f.checkins.filter((c) => !(hereMine && c.key === mine.id.slice(0, 8)));
  const buddies = others.filter((c) => c.open);
  const hasAlert = prefs.alerts.some((a) => a.buildingId === b.id && a.floor === f.label);

  box.hidden = false;
  box.innerHTML = `
    <div class="fd-head">
      <h3>Floor ${f.label} · ${FLOOR_KIND_LABEL[f.kind]} ${f.live ? '<span class="tag live">LIVE</span>' : ''}</h3>
      <button class="icon-btn ${isFav(b.id, f.label) ? 'on' : ''}" data-act="fav" title="Save floor">${
        isFav(b.id, f.label) ? '★' : '☆'
      }</button>
    </div>
    <div class="zones">${f.zones
      .map(
        (z) => `<div class="zone" style="background:${occCss(z.occupancy)}">${esc(z.name)}<b>${Math.round(
          z.occupancy * 100,
        )}%</b></div>`,
      )
      .join('')}</div>
    ${sourcesTable(b, f)}

    <div class="fd-section">
      <div class="row">
        <span class="small">🔔 Alert me when under</span>
        <select data-act="alert-threshold">
          ${[30, 40, 50, 60].map((t) => `<option value="${t}" ${t === 40 ? 'selected' : ''}>${t}%</option>`).join('')}
        </select>
        <button class="btn" data-act="alert">${hasAlert ? 'Alert set ✓' : 'Set alert'}</button>
      </div>
    </div>

    ${
      now
        ? `
    <div class="fd-section">
      <h4>Study buddies <span class="muted small">${others.length} SpaceFinder user${
        others.length === 1 ? '' : 's'
      } here</span></h4>
      ${
        buddies.length
          ? `<ul class="buddies">${buddies
              .map(
                (c) =>
                  `<li>🤝 <b>${esc(c.name)}</b>${c.subject ? ` · ${esc(c.subject)}` : ''} <span class="muted small">${minsAgo(
                    c.at,
                  )} min ago</span></li>`,
              )
              .join('')}</ul>`
          : '<p class="muted small">Nobody here is open to study together yet.</p>'
      }
      ${
        hereMine
          ? `<p class="small">✅ You're checked in here since ${hhmm(mine.at)}.</p>
             <button class="btn wide" data-act="checkout">Check out</button>`
          : `<form class="checkin" data-act="checkin">
               <input name="name" placeholder="First name (optional)" maxlength="30" value="${esc(prefs.profile.name)}" />
               <input name="subject" placeholder="Subject, e.g. Maths" maxlength="40" value="${esc(prefs.profile.subject)}" />
               <label class="small"><input type="checkbox" name="open" checked /> Open to studying together</label>
               <button class="btn primary">📍 I'm studying here</button>
             </form>`
      }
    </div>`
        : '<p class="muted small">Switch the time back to “Now” to report, measure noise or check in.</p>'
    }`;

  box.querySelector('[data-act="fav"]').addEventListener('click', () => toggleFav(b.id, f.label));
  box.querySelectorAll('[data-amenity]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await post('/api/amenity', { buildingId: b.id, floor: f.label, kind: btn.dataset.amenity });
        toast(`Thanks! Your ${btn.dataset.amenity.startsWith('power') ? 'charging' : 'water'} info for ${esc(b.name)} floor ${f.label} is shared with everyone.`);
        await refreshShared();
      } catch (err) {
        toast(`Couldn't send (${esc(err.message)}).`);
        btn.disabled = false;
      }
    }),
  );

  box.querySelector('[data-act="alert"]').addEventListener('click', async () => {
    const threshold = Number(box.querySelector('[data-act="alert-threshold"]').value);
    prefs.alerts = prefs.alerts.filter((a) => !(a.buildingId === b.id && a.floor === f.label));
    prefs.alerts.push({ buildingId: b.id, floor: f.label, threshold });
    save('alerts');
    try {
      if (Notification.permission === 'default') await Notification.requestPermission();
    } catch {
      /* notifications unsupported — in-app toast still works */
    }
    toast(`🔔 We'll tell you when ${esc(b.name)} floor ${f.label} drops under ${threshold}%.`);
    checkAlerts();
    renderAll();
  });

  if (!now) return;

  box.querySelector('[data-act="checkout"]')?.addEventListener('click', async () => {
    await post('/api/checkout', { id: mine.id }).catch(() => {});
    prefs.checkin = null;
    save('checkin');
    refreshShared();
  });

  box.querySelector('form[data-act="checkin"]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    prefs.profile = { name: fd.get('name').trim(), subject: fd.get('subject').trim() };
    save('profile');
    try {
      if (prefs.checkin) await post('/api/checkout', { id: prefs.checkin.id }).catch(() => {});
      const { id } = await post('/api/checkin', {
        buildingId: b.id, floor: f.label, ...prefs.profile, open: fd.get('open') === 'on',
      });
      prefs.checkin = { id, buildingId: b.id, floor: f.label, at: Date.now() };
      save('checkin');
      document.activeElement?.blur();
      toast(`📍 Checked in at ${esc(b.name)} floor ${f.label}. Others can see a study buddy here.`);
      refreshShared();
    } catch (err) {
      toast(`Couldn't check in (${esc(err.message)}).`);
    }
  });
}

// Seats, noise and booking — each with where it comes from and when it was updated.
function sourcesTable(b, f) {
  const crowdNote = f.crowdReports.n
    ? ` + ${f.crowdReports.n} student report${f.crowdReports.n === 1 ? '' : 's'} (latest ${ago(f.crowdReports.updatedAt)})`
    : '';
  const noiseNote = f.noiseReports.n
    ? ` + ${f.noiseReports.n} noise report${f.noiseReports.n === 1 ? '' : 's'} (latest ${ago(f.noiseReports.updatedAt)})`
    : '';
  const occTime = f.occSource.kind === 'sensor' ? ago(f.occSource.updatedAt) : `${hhmm(f.occSource.updatedAt)} slot`;
  const booking = bookingFor(b);
  const link = (l) => `<a href="${l.url}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`;
  return `
    <table class="sources">
      <tr>
        <th>🪑 Seats</th>
        <td><b>~${f.seatsFree}</b> of ${f.seatsTotal} free
          <div class="src">Source: ${esc(f.occSource.label)}${crowdNote} · updated ${occTime}</div>${
            hasOfficialSeatCounts(b) ? `<div class="src"><a href="${LIVE_SEATS_URL}" target="_blank" rel="noopener">Compare with UCL Library's official live seat counts ↗</a></div>` : ''
          }</td>
      </tr>
      <tr>
        <th>🔊 Noise</th>
        <td><b>~${f.noise} dB</b> ${noiseLabel(f.noise).toLowerCase()}
          <div class="src">Source: ${esc(f.noiseSource.label)}${noiseNote} · updated ${
            f.noiseSource.kind === 'measured' ? ago(f.noiseSource.updatedAt) : `${hhmm(f.noiseSource.updatedAt)} slot`
          }</div></td>
      </tr>
      ${amenityRow('power', '⚡ Charging', POWER_LABEL[f.amenities.power.value], f.amenities.power)}
      ${amenityRow('water', '💧 Water', f.amenities.water.value ? 'Drinking-water refill point on this floor' : 'No refill point on this floor (try another floor)', f.amenities.water)}
      <tr>
        <th>📅 Booking</th>
        <td><b>${booking.bookable ? 'Bookable' : 'No booking needed / not bookable'}</b> · ${esc(booking.what)}
          ${booking.rules ? `<div class="small">${esc(booking.rules)}</div>` : ''}
          <div class="book-links">${booking.links.map(link).join('')}</div>
          <div class="src">Source: ${esc(booking.source)} · checked ${BOOKING_CHECKED} (rules, not live availability)</div></td>
      </tr>
    </table>`;
}

function amenityIcons(f) {
  const p = f.amenities.power;
  const w = f.amenities.water;
  const cls = (a, on) => `amen ${on ? '' : 'off'} ${a.confirmed ? 'ok' : ''}`;
  return `<span class="${cls(p, p.value !== 'few')}" title="${POWER_LABEL[p.value]}${p.confirmed ? ' (confirmed)' : ' (estimate)'}">⚡</span>` +
    `<span class="${cls(w, w.value)}" title="${w.value ? 'Water refill point' : 'No water point'}${w.confirmed ? ' (confirmed)' : ' (estimate)'}">💧</span>`;
}

function amenityRow(key, title, text, a) {
  const now = state.offsetSteps === 0;
  return `
      <tr>
        <th>${title}</th>
        <td><b>${esc(text)}</b>
          <div class="src">Source: ${esc(a.source)}${a.updatedAt ? ` · updated ${ago(a.updatedAt)}` : ' · help confirm it'}</div>
          ${now ? `<div class="amen-confirm">
            <button data-amenity="${key}-yes">✓ ${key === 'power' ? 'Has sockets' : 'Has water'}</button>
            <button data-amenity="${key}-no">✗ ${key === 'power' ? 'No sockets' : 'No water'}</button>
          </div>` : ''}</td>
      </tr>`;
}

// Send a "noisy / quiet / seats free / crowded" report, select that floor and
// tell the student exactly what changed (before → after).
async function sendReport(b, floorLabel, kind, btn) {
  const fi = b.floors.findIndex((x) => x.label === floorLabel);
  const before = floorStats(b, fi, new Date());
  if (btn) btn.disabled = true;
  try {
    await post('/api/report', { buildingId: b.id, floor: floorLabel, kind });
  } catch (err) {
    toast(`Couldn't send report (${esc(err.message)}). Is the server running the latest version? Restart it with npm start.`);
    if (btn) btn.disabled = false;
    return;
  }
  state.floorIndex = fi;
  await refreshShared();
  const after = floorStats(b, fi, new Date());
  const r = REPORTS[kind];
  const change = kind === 'noisy' || kind === 'quiet'
    ? `noise ${before.noise} → ${after.noise} dB (now ${noiseLabel(after.noise)})`
    : `${Math.round(before.occupancy * 100)}% → ${Math.round(after.occupancy * 100)}% full (now ${busyLabel(after.occupancy)})`;
  toast(`${r.icon} Thanks! ${esc(b.name)} floor ${floorLabel}: ${change}. Shared with everyone for the next 45 min.`, 7000);
}

// "Here now?" bar: one tap to tell everyone it's noisy / quiet / has seats / is crowded.
function renderReportBar(b, s) {
  const bar = $('#d-report');
  if (state.offsetSteps !== 0) {
    bar.innerHTML = '<p class="muted small">Switch the time back to “Now” to report what it is like here.</p>';
    return;
  }
  const pickFloor = state.pick?.buildingId === b.id ? state.pick.floor : null;
  const label =
    (state.floorIndex != null && s.floors[state.floorIndex]?.label) ??
    (b.floors.some((x) => x.label === state.reportFloor) ? state.reportFloor : null) ??
    pickFloor ??
    s.best.label;
  const f = s.floors.find((x) => x.label === label) ?? s.floors[0];
  const feed = f.reports.slice(0, 4);
  bar.innerHTML = `
    <div class="rb-head">
      <h4>Here now? Report it</h4>
      <label class="small">Floor <select data-act="floor">${s.floors
        .map((x) => `<option value="${x.label}" ${x.label === f.label ? 'selected' : ''}>${x.label}</option>`)
        .join('')}</select></label>
    </div>
    <div class="rb-buttons">${Object.entries(REPORTS)
      .map(([k, r]) => `<button data-kind="${k}"><span>${r.icon}</span>${r.label}</button>`)
      .join('')}</div>
    <button class="btn wide" data-act="noise">🎙 Measure the noise here (4 s)</button>
    <ul class="rb-feed">${
      feed.length
        ? feed.map((r) => `<li>${REPORTS[r.kind]?.icon ?? '•'} ${REPORTS[r.kind]?.label ?? r.kind} · floor ${esc(r.floor || 'all')} <span class="muted">${ago(r.at)}</span></li>`).join('')
        : '<li class="muted">No reports for this floor in the last 45 min. Be the first!</li>'
    }</ul>`;

  bar.querySelector('[data-act="floor"]').addEventListener('change', (e) => {
    state.reportFloor = e.target.value;
    if (state.floorIndex != null) state.floorIndex = b.floors.findIndex((x) => x.label === e.target.value);
    renderDetail();
  });
  bar.querySelectorAll('[data-kind]').forEach((btn) => btn.addEventListener('click', () => sendReport(b, f.label, btn.dataset.kind, btn)));
  const noiseBtn = bar.querySelector('[data-act="noise"]');
  noiseBtn.addEventListener('click', async () => {
    noiseBtn.disabled = true;
    try {
      const db = await measureNoise(4, (p) => (noiseBtn.textContent = `🎙 Listening… ${Math.round(p * 100)}%`));
      await post('/api/noise', { buildingId: b.id, floor: f.label, db });
      toast(`🎙 Measured ~${db} dB (${noiseLabel(db).toLowerCase()}). Shared with everyone, thanks! Audio never left your device.`);
      refreshShared();
    } catch (err) {
      toast(`Couldn't measure noise: ${esc(err.message)}`);
      noiseBtn.disabled = false;
      noiseBtn.textContent = '🎙 Measure the noise here (4 s)';
    }
  });
}

// ---------- big floor explorer: large 3D + 2D floor plan ----------
let fxView = null;
function openExplorer() {
  const b = findBuilding(state.buildingId);
  if (!b) return;
  state.explorer = true;
  $('#explorer').hidden = false;
  if (state.floorIndex == null) {
    const s = buildingStats(b, viewDate());
    const pickIdx = state.pick?.buildingId === b.id ? b.floors.findIndex((x) => x.label === state.pick.floor) : -1;
    state.floorIndex = pickIdx >= 0 ? pickIdx : s.floors.indexOf(s.best);
  }
  renderDetail();
}
function closeExplorer() {
  state.explorer = false;
  $('#explorer').hidden = true;
}
function setFloor(i) {
  if (i == null) return;
  state.floorIndex = i;
  renderDetail();
}

function renderExplorer(b, s) {
  const idx = state.floorIndex ?? s.floors.indexOf(s.best);
  const f = s.floors[idx];
  $('#fx-title').textContent = b.name;
  $('#fx-sub').textContent = `${busyLabel(s.occupancy)} overall (${Math.round(s.occupancy * 100)}%) · ${noiseLabel(s.noise)} · ${state.offsetSteps ? 'forecast for ' + hhmm(viewDate()) : 'now'}`;

  const tabs = $('#fx-tabs');
  tabs.innerHTML = '';
  [...s.floors.keys()].reverse().forEach((i) => {
    const x = s.floors[i];
    const t = document.createElement('button');
    t.className = 'fx-tab';
    t.setAttribute('role', 'tab');
    t.setAttribute('aria-selected', String(i === idx));
    const picked = state.pick?.buildingId === b.id && state.pick.floor === x.label;
    t.innerHTML = `<i style="background:${occCss(x.occupancy)}"></i><b>${x.label}</b> ${Math.round(x.occupancy * 100)}%${picked ? ' ✦' : ''}`;
    t.title = `${FLOOR_KIND_LABEL[x.kind]} · ${busyLabel(x.occupancy)}`;
    t.addEventListener('click', () => setFloor(i));
    tabs.appendChild(t);
  });

  if (!fxView) fxView = new BuildingView($('#fx-3d'), { onFloorSelect: setFloor });
  fxView.setPick(state.pick?.buildingId === b.id ? b.floors.findIndex((x) => x.label === state.pick.floor) : null);
  fxView.show(b, s);
  fxView.selectFloor(idx);

  $('#fx-plan-title').textContent = `Floor ${f.label} · ${FLOOR_KIND_LABEL[f.kind]}`;
  $('#fx-plan').innerHTML = floorPlanSVG(b, f, fxView.plan, fxView.corePoint);

  const booking = bookingFor(b);
  const facts = $('#fx-facts');
  facts.innerHTML = `
    <div class="fx-stats">
      <div><b style="color:${occCss(f.occupancy)}">${Math.round(f.occupancy * 100)}%</b><span>${busyLabel(f.occupancy)}</span></div>
      <div><b>~${f.seatsFree}</b><span>seats free</span></div>
      <div><b>~${f.noise} dB</b><span>${noiseLabel(f.noise)}</span></div>
      <div><b>${f.amenities.power.value === 'few' ? '—' : f.amenities.power.value === 'most' ? '⚡⚡' : '⚡'}</b><span>${f.amenities.power.confirmed ? 'charging ✓' : 'charging (est.)'}</span></div>
      <div><b>${f.amenities.water.value ? '💧' : '—'}</b><span>${f.amenities.water.confirmed ? 'water ✓' : 'water (est.)'}</span></div>
    </div>
    <p class="src">Seats: ${esc(f.occSource.label)} · Noise: ${esc(f.noiseSource.label)} · Booking: ${esc(booking.what)}
      ${booking.bookable ? ` <a href="${booking.links[0].url}" target="_blank" rel="noopener">${esc(booking.links[0].label)} ↗</a>` : ''}</p>
    ${state.offsetSteps === 0 ? `<div class="fx-report">${Object.entries(REPORTS)
      .map(([k, r]) => `<button data-kind="${k}">${r.icon} ${r.label}</button>`)
      .join('')}</div>` : ''}`;
  facts.querySelectorAll('[data-kind]').forEach((btn) => btn.addEventListener('click', () => sendReport(b, f.label, btn.dataset.kind, btn)));
}

$('#d-explore').addEventListener('click', openExplorer);
$('#d-explore2').addEventListener('click', openExplorer);
$('#fx-close').addEventListener('click', closeExplorer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.explorer) closeExplorer();
});

// ---------- phone drawer (sidebar slides up from the bottom) ----------
const sidebar = $('#sidebar');
function setDrawer(open) {
  sidebar.classList.toggle('open', open);
  document.body.classList.toggle('drawer-open', open);
  $('#drawer-handle').setAttribute('aria-expanded', String(open));
}
$('#drawer-handle').addEventListener('click', () => setDrawer(!sidebar.classList.contains('open')));
// Tapping the map tucks the drawer away again.
$('#map').addEventListener('pointerdown', () => setDrawer(false));
// Focusing the Ask Claude box opens the drawer so the answer is visible.
$('#rec-input').addEventListener('focus', () => setDrawer(true));

// ---------- selection & campus ----------
function switchCampus(id) {
  state.campus = id;
  document.querySelectorAll('#campus-switch button').forEach((btn) =>
    btn.classList.toggle('active', btn.dataset.campus === id),
  );
  renderAll();
}

function selectBuilding(id) {
  if (state.buildingId !== id) state.floorIndex = null;
  state.buildingId = id;
  if (id) {
    const c = campusOf(findBuilding(id));
    if (c !== state.campus) {
      switchCampus(c);
      map.showCampus(c); // moves the sun/shadows; select() below sets the camera
    }
  }
  map.select(id);
  $('#detail').hidden = !id;
  document.body.classList.toggle('detail-open', !!id);
  if (id) setDrawer(false);
  if (!id) closeExplorer();
  if (id) renderDetail();
}

function selectFloor(i) {
  state.floorIndex = i === state.floorIndex ? null : i;
  renderDetail();
}

$('#detail-close').addEventListener('click', () => {
  state.pick = null;
  selectBuilding(null);
});
$('#d-fav').addEventListener('click', () => toggleFav(state.buildingId, ''));
document.querySelectorAll('#campus-switch button').forEach((btn) =>
  btn.addEventListener('click', () => {
    selectBuilding(null);
    switchCampus(btn.dataset.campus);
    map.showCampus(btn.dataset.campus);
  }),
);

// ---------- search ----------
const searchInput = $('#search');
const results = $('#search-results');
function showResults() {
  const hits = searchBuildings(searchInput.value);
  results.innerHTML = '';
  results.hidden = hits.length === 0;
  const d = viewDate();
  hits.forEach((b, i) => {
    const li = document.createElement('li');
    li.classList.toggle('active', i === 0);
    const occ = buildingStats(b, d).occupancy;
    li.innerHTML = `<span></span><b style="color:${occCss(occ)}">${Math.round(occ * 100)}%</b>`;
    li.firstChild.textContent = b.name;
    li.addEventListener('mousedown', () => pick(b.id));
    results.appendChild(li);
  });
}
function pick(id) {
  selectBuilding(id);
  searchInput.value = '';
  results.hidden = true;
  searchInput.blur();
}
searchInput.addEventListener('input', showResults);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const hit = searchBuildings(searchInput.value)[0];
    if (hit) pick(hit.id);
  }
  if (e.key === 'Escape') results.hidden = true;
});
searchInput.addEventListener('blur', () => setTimeout(() => (results.hidden = true), 150));

// ---------- time ----------
$('#time-slider').addEventListener('input', (e) => {
  state.offsetSteps = Number(e.target.value);
  renderAll();
});

// ---------- theme ----------
$('#theme-btn').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme
    ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  map.applyTheme();
});

// ---------- Ask Claude ----------
const chat = $('#chat');
const log = $('#chat-log');
const history = [];
$('#chat-fab').addEventListener('click', () => {
  chat.hidden = false;
  $('#chat-fab').hidden = true;
  $('#chat-input').focus();
});
$('#chat-close').addEventListener('click', () => {
  chat.hidden = true;
  $('#chat-fab').hidden = false;
});
document.querySelectorAll('.chat .chip').forEach((c) => c.addEventListener('click', () => ask(c.textContent)));
$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#chat-input').value.trim();
  if (q) ask(q);
  $('#chat-input').value = '';
});

function addMsg(cls, text) {
  const div = document.createElement('div');
  div.className = `msg ${cls}`;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

async function requestAdvice(question) {
  const d = viewDate();
  return post('/api/ask', {
    question,
    history,
    time: d.toLocaleString('en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit' }),
    selected: state.buildingId,
    snapshot: campusSnapshot(d, prefs.me),
    me: {
      location: prefs.me?.label,
      campus: prefs.me?.campus ?? state.campus,
      campusName: CAMPUSES[prefs.me?.campus ?? state.campus].name,
      favourites: prefs.favs.map(favLabel),
      timetable: prefs.timetable,
    },
  });
}

// Open the recommended building and light up the floor in the 3D view.
function applyPick(target) {
  const b = target && findBuilding(target.buildingId);
  if (!b) return null;
  const fi = b.floors.findIndex((x) => x.label === target.floor);
  state.pick = { buildingId: b.id, floor: fi >= 0 ? target.floor : null };
  state.floorIndex = null;
  selectBuilding(b.id);
  if (fi >= 0) selectFloor(fi);
  return { b, fi };
}

async function ask(question) {
  addMsg('me', question);
  const typing = addMsg('bot typing', 'Checking every floor on campus…');
  try {
    const data = await requestAdvice(question);
    typing.remove();
    const msg = addMsg('bot', data.reply);
    history.push({ role: 'user', content: question }, { role: 'assistant', content: data.reply });
    const picked = applyPick(data.target);
    if (picked) {
      const btn = document.createElement('button');
      btn.className = 'go';
      btn.textContent = `Show ${picked.b.name}${data.target.floor ? ` · floor ${data.target.floor}` : ''} →`;
      btn.addEventListener('click', () => applyPick(data.target));
      msg.appendChild(document.createElement('br'));
      msg.appendChild(btn);
    }
  } catch (err) {
    typing.remove();
    addMsg('bot', `Sorry, I couldn't reach ${AI_NAME} (${err.message}).`);
  }
}

// Sidebar "Ask Claude where to go" card
const recResult = $('#rec-result');
async function recommend(question) {
  question = question.trim();
  if (!question) return;
  $('#rec-input').value = question;
  recResult.hidden = false;
  recResult.innerHTML = '<p class="muted">✦ Checking every floor, the next hours and student reports…</p>';
  try {
    const data = await requestAdvice(question);
    history.push({ role: 'user', content: question }, { role: 'assistant', content: data.reply });
    const picked = applyPick(data.target);
    recResult.innerHTML = `
      <p class="rec-reply"></p>
      ${picked ? `<button class="btn wide" data-act="show">✦ Show ${esc(picked.b.name)}${data.target.floor ? ` · floor ${esc(data.target.floor)}` : ''}</button>` : ''}
      <p class="src">Based on what this page shows at ${hhmm(viewDate())}: crowd + forecast, noise, student reports${
        liveSource().source === 'uclapi' && !liveSource().error ? ', UCL desk sensors' : ''
      }.${data.offline ? ` Offline rules (no ${AI_NAME} API key on the server).` : ''}</p>`;
    recResult.querySelector('.rec-reply').textContent = data.reply;
    recResult.querySelector('[data-act="show"]')?.addEventListener('click', () => applyPick(data.target));
  } catch (err) {
    recResult.innerHTML = `<p class="muted">Sorry, I couldn't reach ${AI_NAME} (${esc(err.message)}).</p>`;
  }
}
$('#rec-form').addEventListener('submit', (e) => {
  e.preventDefault();
  recommend($('#rec-input').value);
});
document.querySelectorAll('.rec-chips .chip').forEach((c) => c.addEventListener('click', () => recommend(c.textContent)));

// ---------- start ----------
initMe();
renderAll();
refreshShared();
// Deep link: ?b=student-centre&f=2
const params = new URLSearchParams(location.search);
const deep = BUILDINGS.find((b) => b.id === params.get('b'));
// Camera deep link for demos/screenshots: ?cam=camX,camY,camZ,targetX,targetZ
const cam = params.get('cam')?.split(',').map(Number);
if (cam?.length === 5 && cam.every(Number.isFinite)) map.setView(cam.slice(0, 3), [cam[3], 0, cam[4]]);
if (deep) {
  selectBuilding(deep.id);
  const fi = deep.floors.findIndex((f) => f.label === params.get('f'));
  if (fi >= 0) selectFloor(fi);
}
if (params.get('explore') && state.buildingId) openExplorer();
// Demo deep link: ?ask=Quiet%20study%20for%202%20hours runs the Claude recommendation on load.
if (params.get('ask')) recommend(params.get('ask'));
// ?debug exposes the map for automated UI tests.
if (params.has('debug')) window.__spacefinder = { map, state };
