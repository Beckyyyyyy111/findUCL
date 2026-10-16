// Shared, crowd-sourced state: crowd reports, noise readings and check-ins.
// Kept in memory and flushed to data/store.json so a restart doesn't wipe it.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const REPORT_TTL = 45 * 60 * 1000;
const NOISE_TTL = 30 * 60 * 1000;
const CHECKIN_TTL = 4 * 60 * 60 * 1000;
const AMENITY_TTL = 14 * 24 * 60 * 60 * 1000; // sockets and water fountains don't move often
const MAX_ITEMS = 2000;

export class Store {
  constructor(file) {
    this.file = file;
    this.data = { reports: [], noise: [], checkins: [], amenities: [] };
    try {
      Object.assign(this.data, JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
      /* first run */
    }
    this.saveTimer = null;
  }

  #prune() {
    const now = Date.now();
    this.data.reports = this.data.reports.filter((r) => now - r.at < REPORT_TTL).slice(-MAX_ITEMS);
    this.data.noise = this.data.noise.filter((r) => now - r.at < NOISE_TTL).slice(-MAX_ITEMS);
    this.data.checkins = this.data.checkins.filter((c) => now - c.at < CHECKIN_TTL).slice(-MAX_ITEMS);
    this.data.amenities = (this.data.amenities ?? []).filter((a) => now - a.at < AMENITY_TTL).slice(-MAX_ITEMS);
  }

  #save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFile(this.file, JSON.stringify(this.data), () => {});
    }, 500);
  }

  // kind: 'crowded' | 'seats' (seats free) | 'noisy' | 'quiet'
  addReport({ buildingId, floor, kind }) {
    this.data.reports.push({ buildingId, floor, kind, at: Date.now() });
    this.#prune();
    this.#save();
  }

  // kind: 'power-yes' | 'power-no' | 'water-yes' | 'water-no'
  addAmenity({ buildingId, floor, kind }) {
    this.data.amenities.push({ buildingId, floor, kind, at: Date.now() });
    this.#prune();
    this.#save();
  }

  addNoise({ buildingId, floor, db }) {
    this.data.noise.push({ buildingId, floor, db: Math.round(db), at: Date.now() });
    this.#prune();
    this.#save();
  }

  checkIn({ buildingId, floor, name, subject, open }) {
    const c = {
      id: crypto.randomUUID(),
      buildingId,
      floor,
      name: name || 'A student',
      subject: subject || '',
      open: !!open,
      at: Date.now(),
    };
    this.data.checkins.push(c);
    this.#prune();
    this.#save();
    return c;
  }

  checkOut(id) {
    this.data.checkins = this.data.checkins.filter((c) => c.id !== id);
    this.#save();
  }

  // What every browser gets. Check-in ids stay private to whoever created them.
  publicState() {
    this.#prune();
    return {
      reports: this.data.reports,
      noise: this.data.noise,
      amenities: this.data.amenities,
      checkins: this.data.checkins.map(({ id, ...rest }) => ({ ...rest, key: id.slice(0, 8) })),
    };
  }
}
