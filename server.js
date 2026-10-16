// Static server + small JSON API:
//   GET  /api/state     live sensor data + shared crowd reports, noise readings, check-ins
//   POST /api/report    { buildingId, floor, kind: crowded|seats|noisy|quiet }
//   POST /api/amenity   { buildingId, floor, kind: power-yes|power-no|water-yes|water-no }
//   POST /api/noise     { buildingId, floor, db }
//   POST /api/checkin   { buildingId, floor, name, subject, open } → { id }
//   POST /api/checkout  { id }
//   GET  /api/config    which AI answers ("Gemini" or "Claude")
//   POST /api/ask       the AI recommends where to study from the live snapshot

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { Store } from './server/store.js';
import { UclLive } from './server/uclapi.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Load API keys from .env next to this file (git-ignored). Variables already set
// in the environment win, so hosting dashboards like Render still take priority.
try {
  process.loadEnvFile(path.join(here, '.env'));
} catch {
  /* no .env file: fine */
}
const PUBLIC = path.join(here, 'public');
const PORT = Number(process.env.PORT) || 3000;
const MODEL = 'claude-opus-5-5';

// Which AI answers "Ask …": AI_PROVIDER=gemini|claude, or picked from whichever key is set.
// Gemini: GEMINI_API_KEY (+ optional GEMINI_MODEL). Claude: ANTHROPIC_API_KEY.
const AI_PROVIDER = (process.env.AI_PROVIDER || (process.env.GEMINI_API_KEY ? 'gemini' : 'claude')).toLowerCase();
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const AI_NAME = AI_PROVIDER === 'gemini' ? 'Gemini' : 'Claude';

// Gemini REST generateContent (https://ai.google.dev/api). Returns the reply text.
async function askGemini(system, messages) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: 1024, temperature: 0.4 },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error?.message || `Gemini HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const cand = body.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  if (!text) {
    const why = cand?.finishReason || body.promptFeedback?.blockReason || 'empty reply';
    return `Sorry, I can't help with that one (${why}). Ask me where to study!\nTARGET: none`;
  }
  return text;
}

const store = new Store(path.join(here, 'data', 'store.json'));
const live = new UclLive(process.env.UCLAPI_TOKEN);
let client = null; // created on first request so a missing key doesn't crash startup

const SYSTEM = `You are SpaceFinder (powered by ${AI_NAME}), a friendly assistant that helps UCL students decide where to study (Bloomsbury campus and UCL East).
You receive a live snapshot of every building and floor: busy percentage now and for the next hours (busyNextHours: [now, +1h, +2h, +3h]), floor use (silent / quiet / group / social / teaching), approximate noise in dB, free seats, whether the number comes from real desk sensors, recent student reports (noisy / quiet / seats free / crowded, with how long ago), and how many SpaceFinder users are checked in (some open to studying together, with their subject). Buildings marked "teaching building, no dedicated study space" only have an overall estimate.
You may also get the student's location (walking minutes to each building), their favourite spots and their timetable notes.

How to answer:
- Always reply in English, even if the student writes in another language (understand their request either way).
- Recommend one specific building AND floor, plus one backup. Base it strictly on the snapshot; never invent buildings, floors or numbers.
- If they say how long they'll stay (e.g. "两小时", "2 hours"), check busyNextHours over that whole window and pick a floor that stays calm the entire time; say so briefly.
- Match the request: silent/focus work → silent or quiet floors with low noise; group work or talking → group or social floors; avoid teaching floors unless asked.
- Trust fresh student reports: a recent "noisy" or "crowded" report counts against a floor, "quiet" or "seats free" for it. Mention a report when it changed your choice.
- Weigh walking time: a slightly busier floor 3 minutes away can beat a quiet one 15 minutes away, especially if they have a class soon. Prefer their favourites when they're comparable.
- Each floor has power (sockets at "most" / "some" / "few" desks) and water (drinking-water refill point on the floor: true/false), with how sure we are (estimate vs confirmed by students). If they need to charge a laptop/phone or want water, only pick floors that have it, and say if it's only an estimate.
- Each building has a "booking" note (what can be booked and by whom). If they need a group room or a guaranteed seat, prefer a building with bookable rooms, say what to book, and mention that bookings open 3 days ahead at 12:00 (UCL Library) and must be checked into within 30 minutes. The page shows the booking link.
- If they want a study buddy, point to a floor with someone open to studying together in a matching subject.
- If the place they asked about is busy (above ~75%) or loud, say so plainly and suggest a better option.
- Keep it short: 2–4 sentences, warm and practical, no markdown headings or bullet lists.
- On the very last line, output exactly: TARGET: <building id>|<floor label>  (use the ids from the snapshot; write TARGET: none if you are not recommending a place).`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 300_000) throw new Error('Request too large');
  }
  return JSON.parse(raw || '{}');
}

const REPORT_KINDS = ['crowded', 'seats', 'noisy', 'quiet'];
const AMENITY_KINDS = ['power-yes', 'power-no', 'water-yes', 'water-no'];
const str = (v, max = 60) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function parseTarget(text) {
  const m = text.match(/TARGET:\s*([a-z0-9-]+)\s*\|\s*([A-Za-z0-9]+)/);
  const reply = text.replace(/\n?\s*TARGET:.*$/m, '').trim();
  return { reply, target: m ? { buildingId: m[1], floor: m[2] } : null };
}

// Used when no Claude credentials are configured, so the demo never dead-ends.
// Understands English and Chinese requests, group vs quiet, and "for N hours".
const CN_NUM = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 半: 0.5 };
function parseHours(q) {
  const m = q.match(/(\d+(?:\.\d+)?)\s*(?:h\b|hrs?\b|hours?\b|个?小时)/i) ?? q.match(/([一两二三四半])\s*个?小时/);
  if (!m) return 1;
  const n = CN_NUM[m[1]] ?? Number(m[1]);
  return Math.max(1, Math.min(3, Math.round(n)));
}
function offlineAnswer(question, snapshot, campus) {
  const wantsGroup = /group|talk|discuss|team|friends|buddy|讨论|小组|一起|聊|组队/i.test(question);
  const hours = parseHours(question);
  const kinds = wantsGroup ? ['group', 'social'] : ['silent', 'quiet'];
  const needPower = /charg|socket|plug|power|laptop|充电|插座|插头|电源/i.test(question);
  const needWater = /water|drink|refill|喝水|饮用水|接水|水/i.test(question);
  const penalty = (f) =>
    (f.studentReports ?? []).reduce((p, r) => p + (/^(noisy|crowded)/.test(r) ? 15 : /^(quiet|seats)/.test(r) ? -10 : 0), 0);
  const spots = snapshot
    .flatMap((b) => (b.floors ?? []).map((f) => ({ b, f })))
    .filter(({ f }) => kinds.includes(f.use))
    .filter(({ f }) => (!needPower || f.power !== 'few') && (!needWater || f.water))
    .map((x) => {
      const window = (x.f.busyNextHours ?? [x.f.busyPercent]).slice(0, hours + 1);
      const worst = Math.max(...window);
      const away = campus && x.b.campus !== campus ? 60 : 0; // stay on the campus they're on
      return { ...x, worst, score: worst + away + (x.b.walkMinutes ?? 0) * 2 + penalty(x.f) + (wantsGroup ? 0 : (x.f.noiseDb - 30) * 0.8) };
    })
    .sort((p, q) => p.score - q.score);
  const [top, backup] = spots;
  if (!top) return { reply: 'I could not find a matching space right now.', target: null, offline: true };
  const walk = (b) => (b.walkMinutes != null ? `, ${b.walkMinutes} min walk` : '');
  const reply =
    `Try ${top.b.name}, floor ${top.f.floor}: ${top.f.busyPercent}% full now, ~${top.f.noiseDb} dB${walk(top.b)}, ` +
    `and it stays at or below ${top.worst}% for the next ${hours} h.` +
    (needPower ? ` Sockets at ${top.f.power === 'most' ? 'most' : 'some'} desks.` : '') +
    (needWater ? ' There is a drinking-water refill point on this floor.' : '') +
    (backup ? ` Backup: ${backup.b.name}, floor ${backup.f.floor} (${backup.f.busyPercent}%).` : '') +
    ` (Offline rules: set ${AI_PROVIDER === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'} for ${AI_NAME}.)`;
  return { reply, target: { buildingId: top.b.id, floor: top.f.floor }, offline: true };
}

async function handleAsk(req, res) {
  const { question, history = [], time, selected, snapshot = [], me = {} } = await readJson(req);
  if (!question || typeof question !== 'string') return send(res, 400, { error: 'Missing question' });
  if (question.length > 500) return send(res, 400, { error: 'Question too long (max 500 characters)' });

  const context = [
    `Current time: ${time}`,
    me.location && `Student's location: near ${me.location} (walkMinutes in the snapshot are from there)`,
    me.campusName && `The student is on / looking at the ${str(me.campusName, 30)} campus: recommend a place there unless they ask for another campus (the other campus is a ~40 min trip).`,
    me.favourites?.length && `Student's favourite spots: ${me.favourites.join(', ')}`,
    me.timetable && `Student's timetable notes: ${str(me.timetable, 500)}`,
    selected && `The student currently has this building open on the map: ${selected}`,
    `Live snapshot (JSON):\n${JSON.stringify(snapshot)}`,
  ]
    .filter(Boolean)
    .join('\n');

  const messages = [
    ...history.slice(-8).filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'),
    { role: 'user', content: `${context}\n\nStudent's question: ${question}` },
  ];

  if (AI_PROVIDER === 'gemini') {
    if (!process.env.GEMINI_API_KEY) return send(res, 200, offlineAnswer(question, snapshot, me.campus));
    try {
      return send(res, 200, parseTarget(await askGemini(SYSTEM, messages)));
    } catch (err) {
      if (err.status === 400 && /api key/i.test(err.message)) return send(res, 200, offlineAnswer(question, snapshot, me.campus));
      console.error('Gemini request failed:', err.message);
      return send(res, err.status === 429 ? 429 : 502, { error: err.message });
    }
  }

  try {
    client ??= new Anthropic();
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: SYSTEM,
      messages,
    });
    if (response.stop_reason === 'refusal') {
      return send(res, 200, { reply: "Sorry, I can't help with that one. Ask me where to study!", target: null });
    }
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return send(res, 200, parseTarget(text));
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || /credentials|authenticat|api key|apiKey/i.test(err.message)) {
      return send(res, 200, offlineAnswer(question, snapshot, me.campus));
    }
    console.error('Claude request failed:', err);
    const status = err instanceof Anthropic.RateLimitError ? 429 : 502;
    return send(res, status, { error: err.message });
  }
}

// The site is public: cap how often one visitor can ask the AI or post reports,
// so nobody can burn through the API quota.
const LIMITS = { ask: [8, 60_000], askDay: [80, 86_400_000], write: [40, 60_000] };
const hits = new Map();
function limited(ip, key) {
  const [max, windowMs] = LIMITS[key];
  const k = `${ip}|${key}`;
  const now = Date.now();
  const recent = (hits.get(k) ?? []).filter((t) => now - t < windowMs);
  const over = recent.length >= max;
  if (!over) recent.push(now);
  hits.set(k, recent);
  return over;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, ts] of hits) if (!ts.some((t) => now - t < 86_400_000)) hits.delete(k);
}, 10 * 60 * 1000).unref();
// Render and other hosts put the visitor's address in x-forwarded-for.
const clientIp = (req) => req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

async function handleApi(req, res, route) {
  if (route === 'GET /api/state') return send(res, 200, { live: live.state, ...store.publicState() });
  if (route === 'GET /api/config') return send(res, 200, { ai: AI_NAME, model: AI_PROVIDER === 'gemini' ? GEMINI_MODEL : MODEL });
  if (req.method !== 'POST') return send(res, 404, { error: 'Not found' });
  const ip = clientIp(req);
  if (route === 'POST /api/ask') {
    if (limited(ip, 'ask') || limited(ip, 'askDay')) return send(res, 429, { error: 'Too many questions, please wait a minute and try again.' });
  } else if (limited(ip, 'write')) {
    return send(res, 429, { error: 'Slow down a little, please try again in a minute.' });
  }

  if (route === 'POST /api/ask') return handleAsk(req, res);
  const body = await readJson(req);
  const buildingId = str(body.buildingId, 40);
  const floor = str(body.floor, 4);

  if (route === 'POST /api/report') {
    if (!buildingId || !REPORT_KINDS.includes(body.kind)) return send(res, 400, { error: 'Bad report' });
    store.addReport({ buildingId, floor, kind: body.kind });
    return send(res, 200, { ok: true });
  }
  if (route === 'POST /api/amenity') {
    if (!buildingId || !floor || !AMENITY_KINDS.includes(body.kind)) return send(res, 400, { error: 'Bad amenity report' });
    store.addAmenity({ buildingId, floor, kind: body.kind });
    return send(res, 200, { ok: true });
  }
  if (route === 'POST /api/noise') {
    const db = Number(body.db);
    if (!buildingId || !floor || !(db >= 15 && db <= 110)) return send(res, 400, { error: 'Bad reading' });
    store.addNoise({ buildingId, floor, db });
    return send(res, 200, { ok: true });
  }
  if (route === 'POST /api/checkin') {
    if (!buildingId || !floor) return send(res, 400, { error: 'Missing place' });
    const c = store.checkIn({
      buildingId, floor, name: str(body.name, 30), subject: str(body.subject, 40), open: body.open,
    });
    return send(res, 200, { id: c.id });
  }
  if (route === 'POST /api/checkout') {
    store.checkOut(str(body.id, 60));
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'Not found' });
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.normalize(path.join(PUBLIC, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    const data = await fs.readFile(file);
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}

http
  .createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://x').pathname;
      if (pathname.startsWith('/api/')) return await handleApi(req, res, `${req.method} ${pathname}`);
      if (req.method === 'GET') return await serveStatic(req, res);
      send(res, 405, { error: 'Method not allowed' });
    } catch (err) {
      send(res, 500, { error: err.message });
    }
  })
  .listen(PORT, () => {
    console.log(`UCL SpaceFinder → http://localhost:${PORT}`);
    console.log(`Live data: ${process.env.UCLAPI_TOKEN ? 'UCL API (polling)' : 'simulated (set UCLAPI_TOKEN for real sensors)'}`);
    const key = AI_PROVIDER === 'gemini' ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY;
    console.log(`AI: ${AI_NAME} (${AI_PROVIDER === 'gemini' ? GEMINI_MODEL : MODEL})${key ? '' : ' — no API key, using offline rules'}`);
  });
