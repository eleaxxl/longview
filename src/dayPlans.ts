// Day plans live on this device (and, on the web, optionally in the person's Google Drive; see planSync).
// They are never written to the calendar.
import { useCallback, useState } from 'react';

import { key } from './dates';
import { storage } from './storage';

export type Todo = { id: string; text: string; done: boolean };

export type DayPlan = {
  /** The day's three most important things. */
  top: string[];
  /** What to do in each hour, by hour of day (0–23). */
  hours: Record<number, string>;
  todos: Todo[];
  notes: string;
};

const PREFIX = 'dayplan:';
/** When each day's plan last changed here, cleared days included, so a sync can tell which copy is newer. */
const META_KEY = 'dayplan-meta';

/** One day as synced: its plan (null once cleared) and when it last changed. */
export type PlanEntry = { plan: DayPlan | null; updated: number };

export const emptyPlan = (): DayPlan => ({ top: ['', '', ''], hours: {}, todos: [], notes: '' });

const isEmpty = (p: DayPlan) =>
  p.top.every(s => !s.trim()) && Object.values(p.hours).every(s => !s.trim()) && p.todos.length === 0 && !p.notes.trim();

export function readPlan(day: Date): DayPlan {
  try {
    const raw = storage?.getItemSync(PREFIX + key(day));
    return raw ? { ...emptyPlan(), ...JSON.parse(raw) } : emptyPlan();
  } catch {
    return emptyPlan();
  }
}

function plannedDays(): Set<string> {
  try {
    return new Set((storage?.getAllKeysSync() ?? []).filter(k => k.startsWith(PREFIX)).map(k => k.slice(PREFIX.length)));
  } catch {
    return new Set();
  }
}

function readMeta(): Record<string, number> {
  try {
    return JSON.parse(storage?.getItemSync(META_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function store(k: string, plan: DayPlan | null, updated: number) {
  try {
    if (!plan || isEmpty(plan)) storage?.removeItemSync(PREFIX + k);
    else storage?.setItemSync(PREFIX + k, JSON.stringify(plan));
    storage?.setItemSync(META_KEY, JSON.stringify({ ...readMeta(), [k]: updated }));
  } catch {
    // Kept for this session only.
  }
}

/** Every day known here, by date key. Plans from before timestamps were kept count as oldest. */
export function localEntries(): Record<string, PlanEntry> {
  const meta = readMeta();
  const out: Record<string, PlanEntry> = {};
  for (const k of new Set([...Object.keys(meta), ...plannedDays()])) {
    const raw = storage?.getItemSync(PREFIX + k);
    out[k] = { plan: raw ? { ...emptyPlan(), ...(JSON.parse(raw) as DayPlan) } : null, updated: meta[k] ?? 0 };
  }
  return out;
}

/** Takes in days that changed elsewhere. */
export function storeEntries(entries: Record<string, PlanEntry>) {
  for (const [k, e] of Object.entries(entries)) store(k, e.plan, e.updated);
}

/**
 * Which days have a plan (as date keys), and a save that keeps that set current.
 * version changes when plans arrive from elsewhere, so an open page can reload.
 */
export function useDayPlans() {
  const [planned, setPlanned] = useState(plannedDays);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => {
    setPlanned(plannedDays());
    setVersion(v => v + 1);
  }, []);
  const save = useCallback((day: Date, plan: DayPlan) => {
    const k = key(day);
    const empty = isEmpty(plan);
    store(k, plan, Date.now());
    setPlanned(s => {
      if (s.has(k) !== empty) return s;
      const n = new Set(s);
      if (empty) n.delete(k);
      else n.add(k);
      return n;
    });
  }, []);
  return { planned, save, version, reload };
}
