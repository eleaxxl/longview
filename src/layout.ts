import { addDays, diff } from './dates';
import type { CalEvent } from './types';

export type Density = {
  name: 'full' | 'mid' | 'compact' | 'micro';
  /** Day header height, lane height, font size (0 = no text). */
  hh: number;
  lh: number;
  fs: number;
  /** How single (timed) events show: with time, title only, or collapsed into a count. */
  timed: 'time' | 'title' | null;
};

export function density(rowH: number): Density {
  if (rowH >= 100) return { name: 'full', hh: 22, lh: 18, fs: 11, timed: 'time' };
  if (rowH >= 62) return { name: 'mid', hh: 20, lh: 16, fs: 10, timed: 'title' };
  if (rowH >= 32) return { name: 'compact', hh: 17, lh: 13, fs: 9, timed: null };
  return { name: 'micro', hh: 12, lh: 4, fs: 0, timed: null };
}

export type Piece = {
  e: CalEvent;
  lane: number;
  /** Visible column range of this segment within the week (0–6). */
  a: number;
  b: number;
};

export type WeekLayout = {
  pieces: Piece[];
  hiddenCount: number[];
  /** Lane index where the "+n" label goes on each day. */
  limit: number[];
  maxLanes: number;
  timedCount: number[];
};

/**
 * Packs a week's events into lanes. Bars (multi-day / all-day) get one lane across all
 * their days; timed events fill the free lanes of their day. Days that overflow give up
 * their last lane to a "+n" label, which can split a bar into several visible segments.
 */
export function layoutWeek(ws: Date, events: CalEvent[], dens: Density, rowH: number): WeekLayout {
  const we = addDays(ws, 6);
  const vis = events.filter(e => e.eDay >= ws && e.sDay <= we);
  const spans = vis
    .filter(e => e.span)
    .sort((a, b) => +a.sDay - +b.sDay || +b.eDay - +b.sDay - (+a.eDay - +a.sDay));
  const singles = vis.filter(e => !e.span).sort((a, b) => +a.st - +b.st);

  const occ: boolean[][] = Array.from({ length: 7 }, () => []);
  const placed: { e: CalEvent; c0: number; c1: number; lane: number }[] = [];

  for (const e of spans) {
    const c0 = Math.max(0, diff(ws, e.sDay));
    const c1 = Math.min(6, diff(ws, e.eDay));
    let lane = 0;
    for (;;) {
      let free = true;
      for (let c = c0; c <= c1; c++) if (occ[c][lane]) { free = false; break; }
      if (free) break;
      lane++;
    }
    for (let c = c0; c <= c1; c++) occ[c][lane] = true;
    placed.push({ e, c0, c1, lane });
  }

  const timedCount = Array(7).fill(0);
  for (const e of singles) {
    const c = diff(ws, e.sDay);
    timedCount[c]++;
    if (!dens.timed) continue;
    let lane = 0;
    while (occ[c][lane]) lane++;
    occ[c][lane] = true;
    placed.push({ e, c0: c, c1: c, lane });
  }

  const maxLanes = Math.max(0, Math.floor((rowH - dens.hh - 1) / dens.lh));
  const limit = occ.map(o => (o.length > maxLanes ? Math.max(0, maxLanes - 1) : maxLanes));
  const hiddenCount = Array(7).fill(0);
  const pieces: Piece[] = [];

  for (const p of placed) {
    let runStart: number | null = null;
    for (let c = p.c0; c <= p.c1 + 1; c++) {
      const show = c <= p.c1 && p.lane < limit[c];
      if (c <= p.c1 && !show) hiddenCount[c]++;
      if (show && runStart === null) runStart = c;
      if (!show && runStart !== null) {
        pieces.push({ e: p.e, lane: p.lane, a: runStart, b: c - 1 });
        runStart = null;
      }
    }
  }
  return { pieces, hiddenCount, limit, maxLanes, timedCount };
}
