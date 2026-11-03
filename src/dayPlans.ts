// Day plans live only on this device; they are never written to the calendar.
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

/** Which days have a plan (as date keys), and a save that keeps that set current. */
export function useDayPlans() {
  const [planned, setPlanned] = useState(plannedDays);
  const save = useCallback((day: Date, plan: DayPlan) => {
    const k = key(day);
    const empty = isEmpty(plan);
    try {
      if (empty) storage?.removeItemSync(PREFIX + k);
      else storage?.setItemSync(PREFIX + k, JSON.stringify(plan));
    } catch {
      // Kept for this session only.
    }
    setPlanned(s => {
      if (s.has(k) !== empty) return s;
      const n = new Set(s);
      if (empty) n.delete(k);
      else n.add(k);
      return n;
    });
  }, []);
  return { planned, save };
}
