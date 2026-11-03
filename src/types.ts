export type CalInfo = {
  id: string;
  name: string;
  color: string;
  /** Account the calendar belongs to, e.g. "Google", "iCloud", "本機". */
  account: string;
  /** Changes sync to Google only for calendars in a Google account. */
  isGoogle: boolean;
  /** False for subscribed or system calendars such as holidays and birthdays. */
  writable: boolean;
};

export type RepeatFreq = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export type Repeat = {
  freq: RepeatFreq;
  /** Every N days/weeks/months/years. */
  interval: number;
  /** Weekly only: 0 = Sunday … 6 = Saturday. */
  weekdays: number[];
  end: 'never' | 'date' | 'count';
  until: Date;
  count: number;
};

/** One event occurrence, normalized for the grid. */
export type CalEvent = {
  id: string;
  /** Id of the stored event; occurrences of a recurring event share it. */
  rawId: string;
  recurring: boolean;
  repeat?: Repeat;
  /** Reminder offset in minutes from the start (negative = before); null for none. */
  alarm: number | null;
  notes: string;
  cal: string;
  title: string;
  location?: string | null;
  allDay: boolean;
  st: Date;
  en: Date;
  /** First and last day the event covers (inclusive, local midnight). */
  sDay: Date;
  eDay: Date;
  /** Drawn as a bar: all-day or crossing midnight. */
  span: boolean;
};

/** What the editor produces. For all-day events, start and end are the first and last day. */
export type EventDraft = {
  cal: string;
  title: string;
  location: string;
  notes: string;
  allDay: boolean;
  start: Date;
  end: Date;
  repeat: Repeat;
  alarm: number | null;
};

export const noRepeat = (from: Date): Repeat => ({
  freq: 'none',
  interval: 1,
  weekdays: [from.getDay()],
  end: 'never',
  until: new Date(from.getFullYear(), from.getMonth() + 3, from.getDate()),
  count: 10,
});
