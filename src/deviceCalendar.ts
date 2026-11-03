// Reads and writes the calendars the device already syncs (Google accounts added in iOS Settings included).
// iOS pushes changes made here back to Google on its own.
import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';

import { addDays, dayOnly } from './dates';
import { noRepeat, type CalEvent, type CalInfo, type EventDraft, type Repeat, type RepeatFreq } from './types';

export const deviceCalendarSupported = Platform.OS === 'ios' || Platform.OS === 'android';

export async function requestAccess(): Promise<boolean> {
  if (!deviceCalendarSupported) return false;
  const res = await Calendar.requestCalendarPermissions();
  return res.granted;
}

const GOOGLE = /google|gmail/i;
const SOURCE_LABELS: Record<string, string> = { subscribed: '訂閱', birthdays: '系統' };

export async function loadCalendars(): Promise<CalInfo[]> {
  const cals = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  return cals.map(c => {
    const src = c.source;
    const local = !src || src.isLocalAccount || src.type === 'local';
    const isGoogle = !local && (GOOGLE.test(src.name) || GOOGLE.test(c.title));
    return {
      id: c.id,
      name: c.title,
      color: c.color ?? '#8a93a6',
      account: local || !src.name ? '本機' : isGoogle ? 'Google' : (SOURCE_LABELS[String(src.type)] ?? src.name),
      isGoogle,
      writable: c.allowsModifications,
    };
  });
}

/**
 * All-day dates can come back as UTC or local midnight depending on the source,
 * so take the calendar day from whichever reading sits on midnight.
 */
function allDayStart(d: Date): Date {
  if (d.getHours() === 0 && d.getMinutes() === 0) return dayOnly(d);
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return dayOnly(d);
}

type StoredRule = NonNullable<Calendar.ExpoCalendarEvent['recurrenceRule']>;

// The iOS module is asymmetric: it writes weekdays as Monday = 1 … Sunday = 7, but reads them back
// as EventKit's raw values, Sunday = 1 … Saturday = 7. Ours are 0 = Sunday … 6 = Saturday.
const toNativeDay = (d: number) => (d === 0 ? 7 : d);
const fromNativeDay = (n: number) => n - 1;

function fromRule(rule: StoredRule | null | undefined, start: Date): Repeat | undefined {
  if (!rule) return undefined;
  const base = noRepeat(start);
  return {
    freq: rule.frequency as RepeatFreq,
    interval: rule.interval ?? 1,
    weekdays: rule.daysOfTheWeek?.length ? rule.daysOfTheWeek.map(d => fromNativeDay(d.dayOfTheWeek)) : base.weekdays,
    end: rule.occurrence ? 'count' : rule.endDate ? 'date' : 'never',
    until: rule.endDate ? new Date(rule.endDate) : base.until,
    count: rule.occurrence ?? base.count,
  };
}

function toRule(r: Repeat): StoredRule | null {
  if (r.freq === 'none') return null;
  return {
    frequency: r.freq as Calendar.Frequency,
    interval: Math.max(1, r.interval),
    ...(r.freq === 'weekly' && r.weekdays.length ? { daysOfTheWeek: r.weekdays.map(d => ({ dayOfTheWeek: toNativeDay(d) })) } : {}),
    ...(r.end === 'date' ? { endDate: new Date(r.until.getFullYear(), r.until.getMonth(), r.until.getDate(), 23, 59) } : {}),
    ...(r.end === 'count' ? { occurrence: Math.max(1, r.count) } : {}),
  };
}

export async function loadEvents(calIds: string[], from: Date, to: Date): Promise<CalEvent[]> {
  if (!calIds.length) return [];
  const evs = await Calendar.listEvents(calIds, from, to);
  return evs.map(ev => {
    const st = new Date(ev.startDate);
    const en = new Date(ev.endDate);
    let sDay: Date;
    let eDay: Date;
    if (ev.allDay) {
      sDay = allDayStart(st);
      const days = Math.max(1, Math.round((+en - +st) / 864e5));
      eDay = addDays(sDay, days - 1);
    } else {
      sDay = dayOnly(st);
      eDay = en > st ? dayOnly(new Date(+en - 1)) : sDay;
    }
    return {
      // Occurrences of a recurring event share an id, so add the start time.
      id: `${ev.id}@${+st}`,
      rawId: ev.id,
      recurring: !!ev.recurrenceRule,
      repeat: fromRule(ev.recurrenceRule, st),
      alarm: ev.alarms?.[0]?.relativeOffset ?? null,
      notes: ev.notes ?? '',
      cal: ev.calendarId,
      title: ev.title || '（無標題）',
      location: ev.location,
      allDay: ev.allDay,
      st,
      en,
      sDay,
      eDay,
      span: ev.allDay || eDay > sDay,
    };
  });
}

/** Start/end as the calendar stores them. An all-day event ends late on its last day. */
function toStored(d: EventDraft) {
  if (!d.allDay) return { startDate: d.start, endDate: d.end };
  const e = dayOnly(d.end);
  return { startDate: dayOnly(d.start), endDate: new Date(e.getFullYear(), e.getMonth(), e.getDate(), 23, 59) };
}

function fields(d: EventDraft, withRule: boolean) {
  const rule = toRule(d.repeat);
  return {
    title: d.title,
    location: d.location,
    notes: d.notes,
    allDay: d.allDay,
    ...toStored(d),
    ...(d.alarm !== null ? { alarms: [{ relativeOffset: d.alarm }] } : {}),
    ...(withRule && rule ? { recurrenceRule: rule } : {}),
  };
}

export async function createEvent(d: EventDraft): Promise<void> {
  const cal = await Calendar.ExpoCalendar.get(d.cal);
  await cal.createEvent(fields(d, true));
}

/** future = this occurrence and every later one in the series. */
async function target(ev: CalEvent, future: boolean) {
  const base = await Calendar.ExpoCalendarEvent.get(ev.rawId);
  return ev.recurring ? base.getOccurrenceSync({ instanceStartDate: ev.st, futureEvents: future }) : base;
}

type Update = (details: object, nullableFields?: string[]) => Promise<void>;

export async function updateEvent(ev: CalEvent, d: EventDraft, future: boolean): Promise<void> {
  const t = await target(ev, future);
  // A single occurrence keeps the series' rule; everything else takes the rule from the editor.
  const withRule = !ev.recurring || future;
  const clear = [
    ...(d.alarm === null ? ['alarms'] : []),
    ...(withRule && d.repeat.freq === 'none' ? ['recurrenceRule'] : []),
  ];
  // The native module also moves the event when given a calendarId and accepts fields to clear,
  // though its TypeScript signature lists neither.
  const update = t.update.bind(t) as unknown as Update;
  const base = fields(d, withRule);
  if (d.cal === ev.cal) return update(base, clear);
  try {
    await update({ ...base, calendarId: d.cal }, clear);
  } catch {
    // Some accounts refuse moves between them: copy into the new calendar, then remove the original.
    await createEvent(d);
    await t.delete();
  }
}

export async function deleteEvent(ev: CalEvent, future: boolean): Promise<void> {
  const t = await target(ev, future);
  await t.delete();
}
