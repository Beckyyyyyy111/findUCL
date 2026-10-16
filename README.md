# FindUCL

> Find a quiet seat at UCL before you walk there.

## 👉 [Try it: finducl.onrender.com](https://finducl.onrender.com/)

Works on desktop and phone. Free hosting: if nobody has opened it for a while, the first load takes 30–60 seconds to wake up.

**Find a seat before you walk there.** A 3D map of UCL (Bloomsbury + UCL East) that shows how busy each building is, floor by floor. Click or search a building (e.g. *Student Centre*) to see its floors in 3D, spot the quiet one, or skip the building if it's packed. Ask Gemini for a recommendation in plain English.

Track: **Better Student Life**, Claude Campus Hackathon (UCL Entrepreneurs × Claude Builder Club UCL)

## Run it

```bash
npm install
npm start          # → http://localhost:3000
```

Put your keys in a **`.env`** file next to `server.js` (copy `.env.example`; `.env` is git-ignored and loaded automatically at start). Environment variables set elsewhere, e.g. in Render, take priority.

Available settings:

| Variable | What it unlocks |
|---|---|
| `GEMINI_API_KEY` | Real Google Gemini answers in "Ask Gemini" (free key at aistudio.google.com). Without a key, a rule-based fallback answers. |
| `GEMINI_MODEL` | Gemini model, default `gemini-3.5-flash-lite` (if it's busy, the server retries and falls back to other Gemini models) |
| `AI_PROVIDER` | Optional: set to `claude` and add `ANTHROPIC_API_KEY` to use Claude instead of Gemini |
| `UCLAPI_TOKEN` | **Real desk-sensor occupancy** from UCL API's Workspaces endpoint (free token at uclapi.com). Floors with sensor data get a green LIVE tag. |
| `PORT` | Port (default 3000) |

Deep links for demos: `/?b=student-centre&f=2`, `/?b=marshgate`

> The microphone and GPS need https: they work on the hosted site and on `http://localhost`.

## Features

**See it**
- **Map controls**: left-drag rotates the view; right-drag or Shift + drag moves the map; scroll zooms towards the cursor; arrow keys move (after clicking the map). The **⟳ Rotate / ✋ Move** toggle at the bottom swaps what a left-drag does (handy on trackpads). Touch: one finger rotates (or moves in Move mode), two fingers move and zoom.
- **Real 3D campus** for **Bloomsbury** and **UCL East**, built from OpenStreetMap: every building at its real footprint and height (≈1,500 buildings), real streets, squares and rivers. UCL buildings have procedural facades (stone/brick windows, concrete ribbon windows, glass curtain walls), real massing from OSM building parts (Senate House's stepped tower, the IOE's terraces, the Wilkins dome) and hand-modelled details (the Portico's columns and pediment, the Cruciform's central tower, the ArcelorMittal Orbit). Their **roofs show the crowd level** (green → red); other buildings are muted.
- **Every UCL building is marked**: besides the 15 study buildings above, ~60 other UCL teaching/department buildings OSM lists as UCL-operated (Chadwick, Darwin, Medical Sciences, Malet Place Engineering, the Gordon Square and Woburn Square department houses…) are drawn in UCL style, searchable and clickable with a generic crowd estimate; their labels appear when you zoom in. UCL halls of residence get a purple roof and a 🛏 label.
- **Works on phones**: full-screen map, a bottom drawer for Ask Gemini and the quietest spots, building details as a bottom sheet, and a full-screen floor explorer.
- Search by name or nickname (`sc`, `dms watson`, `ioe`, `marshgate`…).
- Inside view: floors pulled apart in 3D, zones and people dots, click a floor for zone-level crowd, noise and free seats.
- Verdict per building ("Good time to go → floor 2" / "Very busy, try … instead").
- Time slider: forecast up to 6 h ahead.

**Real data**
- UCL API desk sensors when `UCLAPI_TOKEN` is set (polled every 2 min, mapped to building + floor). Falls back to a time-of-day model otherwise. The header pill shows which one is active.

**Crowdsourced (shared between everyone via the server)**
- 🎙 **Measure the noise**: 4 s phone-mic reading. Only the dB number is shared, audio never leaves the device. Measured noise outweighs the model.
- 📍 **Check in** to a floor, which feeds the "people here" count.

**Personal (saved on your device)**
- I'm near (pick a building or 📍 GPS): walking minutes everywhere, and rankings prefer closer spots.
- My day: free-text timetable that Gemini takes into account.
- ★ Favourite buildings and floors with live %.
- 🔔 Alerts: "tell me when Student Centre floor 2 drops under 40%" (browser notification + in-app, while the tab is open).

**Social**
- 🤝 Study buddies: check in with first name + subject + "open to studying together", see who's on each floor.
- 📅 Link to UCL Library's bookable group rooms, pods and booths.

**Booking, per building** (rules from the official pages, checked 15 Oct 2026, not live availability)
- UCL Library booking system (https://library-calendars.ucl.ac.uk/r/new): Student Centre (quiet areas on B1, 2 and 3; Graduate Hub for postgrads), Science Library, IOE Library, Cruciform Hub, Bartlett Library (22 Gordon St), Institute of Archaeology, UCL East Library (Marshgate). Up to 3 days ahead from 12:00, max 7 h/day, check in within 30 min.
- Senate House Library: its own booking for group rooms, carrels and the accessibility suite (1–3 h slots, max 10 h/week, free membership first); desks on floors 4–7 need no booking.
- Main Library, Bentham House, One Pool Street: no bookable rooms, first come first served.
- Students' Union rooms: society presidents/treasurers only. Teaching buildings: rooms booked by staff/Union officers, so the app points students to a library instead.
- Library-run buildings also link to UCL Library's official live seat counts for comparison.

**Live data you can trust**
- Every number says where it comes from and when: **seats** (UCL desk sensors, or time-of-day estimate + N student reports), **noise** (phone mic readings, or estimated from crowd + noise reports), **booking** (UCL Library rules, with the date they were checked; not live availability).
- **Here now? Report it**: one tap for 📣 Noisy, 🤫 Quiet, 🪑 Seats free, 🚫 Crowded. Reports change that floor's numbers immediately for everyone (you see the before → after), fade out over 45 min, and show in a recent-reports feed.
- **Floor-by-floor 3D interiors**: every floor is drawn in the building's **real outline** (Senate House's courtyards, the Wilkins U-shape, the Cruciform cross), with its slab coloured by the floor's crowd level and zones by theirs. Furniture is chosen from each zone's real use (public/js/interiors.js, ~25 kits): bookshelves in Stacks/Archives, long tables with green lamps in reading rooms (Donaldson Room), carrels, PC desks, glass group pods, booths, café counters, the Bloomsbury Theatre's stage and bar, raked lecture theatres with screen and lectern (XLG, Jeffery Hall), lab benches with fume cupboards, Bartlett studios with drawing tables and models, the Bentham House moot court, foyers with reception and plants, lockers, lounges. Narrow wings get the same furniture drawn smaller, people sit at the desks in proportion to the crowd, and a glass lift/stair core runs through the building. Click a floor to zoom in on it.
- **Real floors where known**: e.g. the Student Centre's B2 (contemplation rooms, showers, lockers), B1, G (tiered steps), M (Student Help Point), 1–4 (enquiries, quiet study, café, terrace), with a "street level" marker between basements and the ground floor.
- **Floor explorer** (⤢ Expand in the building panel, or `?b=student-centre&f=G&explore=1`): a near-full-screen view with the big 3D model on the left and a **2D floor plan** of the selected floor on the right (real outline, zones coloured by crowd, furniture from above, people, lift & stairs, ⚡/💧), floor tabs along the top, key numbers with sources, and the report buttons. The plan is generated from the same layout as the 3D view, so they always match.
- **⚡ Charging & 💧 drinking water** per floor, on the 3D floors, in the floor list and in the floor details. There is no public per-floor data, so it starts as an **estimate from the building type** (shown with a dashed marker); students tap ✓/✗ to confirm or correct it, and the panel then shows "N student reports · updated …". Gemini and the offline rules respect "need to charge / need water".

**Ask Gemini**
- **Ask Gemini where to go** (top of the sidebar, or the chat): e.g. *Quiet study for 2 hours*. Gemini always answers in English (it understands other languages too), checks the forecast for the whole time you want to stay, weighs fresh student reports and walking time, then opens the building and **highlights the recommended floor** (✦ Gemini pick). Demo link: `/?ask=Quiet%20study%20for%202%20hours`.
- It sends the live snapshot (crowd, noise, sensors, check-ins, buddies' subjects, charging, water, booking rules), your location, favourites and day to `gemini-3.5-flash-lite`. If Gemini is busy, the server retries and tries other Gemini models; if all are busy, a rule-based pick from the live data answers instead, so the student always gets a recommendation.
- Each visitor is rate-limited (8 questions a minute, 80 a day) so the public site can't burn the API quota.

## How it works

| File | Role |
|---|---|
| `scripts/build-map.mjs` | Turns the OpenStreetMap extracts in `scripts/osm/` into `public/data/map.json` (footprints, heights, materials, roofs, streets, greens, rivers). Re-run with `node scripts/build-map.mjs` after changing the UCL building table at its top. |
| `public/js/data.js` | UCL buildings and floors, campuses, walking time, GPS → map conversion |
| `public/js/occupancy.js` | Picks the best data source per floor and blends in reports, noise and check-ins |
| `public/js/campus3d.js` / `building3d.js` | The two 3D scenes |
| `public/js/floorplan.js` | 2D SVG floor plan of one floor (same layout as the 3D view) |
| `public/js/interiors.js` | Furniture kits for each kind of zone (shelves, lecture theatre, labs, café…) |
| `public/js/noise.js` | Microphone noise measurement |
| `public/js/app.js` | UI, personal settings, social, chat |
| `server.js` | Static files + JSON API + Gemini (or Claude) |
| `server/store.js` | Shared reports, noise and check-ins (memory + `data/store.json`, auto-expiring) |
| `server/uclapi.js` | UCL API Workspaces adapter |

Positions are real within each campus; UCL East is drawn 2.5 km east of Bloomsbury instead of the real ~8 km. Map data © OpenStreetMap contributors (ODbL).
