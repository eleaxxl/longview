// The last calendars and events loaded, kept on this device so the next visit can show them at once
// while fresh ones load. Web only: in the apps the device calendar is already local and fast.
import type { CalEvent, CalInfo } from './types';
import { storage } from './storage';

const KEY = 'calendar-cache';

type Cached = { cals: CalInfo[]; events: CalEvent[] };

export function readCache(): Cached | null {
  try {
    const raw = storage?.getItemSync(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cached;
    // Dates come back from JSON as strings.
    const events = c.events.map(e => ({
      ...e,
      st: new Date(e.st),
      en: new Date(e.en),
      sDay: new Date(e.sDay),
      eDay: new Date(e.eDay),
      repeat: e.repeat && { ...e.repeat, until: new Date(e.repeat.until) },
    }));
    return { cals: c.cals, events };
  } catch {
    return null;
  }
}

export function writeCache(cals: CalInfo[], events: CalEvent[]) {
  try {
    storage?.setItemSync(KEY, JSON.stringify({ cals, events }));
  } catch {
    // Full or unavailable storage only costs the instant start.
  }
}

export function clearCache() {
  try {
    storage?.removeItemSync(KEY);
  } catch {}
}
