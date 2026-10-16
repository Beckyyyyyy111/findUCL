// Real seat-sensor data from UCL API's Workspaces endpoint (OccupEye sensors
// under library desks). Needs a free token from https://uclapi.com — set
// UCLAPI_TOKEN. Without it, or if the API is unreachable, the app falls back
// to its simulated model.
//
// Response shape: { ok, surveys: [{ id, name, maps: [{ id, name,
//   sensors_absent, sensors_occupied, sensors_other }] }] }

const URL_SUMMARY = 'https://uclapi.com/workspaces/sensors/summary';
const POLL_MS = 2 * 60 * 1000;

// Survey name keyword → our building id.
const SURVEY_MATCH = [
  [/student cent/i, 'student-centre'],
  [/science|dms watson/i, 'science-library'],
  [/main library|wilkins/i, 'main-library'],
  [/ioe|newsam|education/i, 'ioe'],
  [/cruciform/i, 'cruciform'],
  [/senate/i, 'senate-house'],
  [/bartlett/i, 'gordon-street-22'],
  [/law|bentham/i, 'bentham-house'],
  [/marshgate/i, 'marshgate'],
  [/pool street/i, 'one-pool-street'],
];

function floorLabel(mapName) {
  const n = mapName.toLowerCase();
  if (/lower ground|\blg\b/.test(n)) return 'LG';
  if (/ground|\bg\b/.test(n)) return 'G';
  if (/basement|\bb\b/.test(n)) return 'B';
  const m = n.match(/(\d+)/);
  return m ? m[1] : null;
}

export class UclLive {
  constructor(token) {
    this.token = token;
    this.state = {
      source: 'simulated',
      updatedAt: null,
      error: token ? null : 'No UCLAPI_TOKEN set',
      floors: {},
    };
    if (token) {
      this.#poll();
      setInterval(() => this.#poll(), POLL_MS).unref();
    }
  }

  async #poll() {
    try {
      const url = `${URL_SUMMARY}?token=${encodeURIComponent(this.token)}&survey_filter=all`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || `HTTP ${res.status}`);

      const floors = {};
      for (const survey of body.surveys) {
        const id = SURVEY_MATCH.find(([re]) => re.test(survey.name))?.[1];
        if (!id) continue;
        for (const map of survey.maps) {
          const label = floorLabel(map.name);
          if (!label) continue;
          const f = ((floors[id] ??= {})[label] ??= { occupied: 0, total: 0 });
          f.occupied += map.sensors_occupied;
          f.total += map.sensors_occupied + map.sensors_absent + map.sensors_other;
        }
      }
      this.state = { source: 'uclapi', updatedAt: Date.now(), error: null, floors };
    } catch (err) {
      // Keep the last good reading if there was one.
      this.state = { ...this.state, error: String(err.message || err) };
      console.warn('UCL API poll failed:', this.state.error);
    }
  }
}
