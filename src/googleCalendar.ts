// Google Calendar for the web version: Google's REST API, with an access token from Google sign-in.
// Nothing goes through a server of ours; the browser talks to Google directly.
import { addDays, dayOnly, key, parse } from './dates';
import { htmlToText } from './html';
import { noRepeat, type CalEvent, type CalInfo, type EventDraft, type Repeat, type RepeatFreq } from './types';

const CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';
const SCOPES = ['https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events'];
const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_KEY = 'google-token';
const CONNECTED_KEY = 'google-connected';

export const googleConfigured = typeof window !== 'undefined' && !!CLIENT_ID;

/** The token is missing or has expired: the person has to connect again. */
// A tagged Error rather than a subclass: subclasses of Error lose instanceof once compiled down.
const signInNeeded = () => Object.assign(new Error('需要重新連接 Google 日曆'), { signInNeeded: true });
export const isSignInNeeded = (e: unknown) => e instanceof Error && 'signInNeeded' in e;

type TokenResponse = { access_token?: string; expires_in?: number; error?: string };
type Gis = {
  accounts: {
    oauth2: {
      initTokenClient(cfg: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: () => void }): {
        requestAccessToken(o?: { prompt?: string }): void;
      };
      hasGrantedAllScopes(r: TokenResponse, ...scopes: string[]): boolean;
      revoke(token: string, done?: () => void): void;
    };
  };
};
const gisGlobal = () => (window as unknown as { google?: Gis }).google?.accounts?.oauth2;

type Token = { value: string; exp: number };

function readToken(): Token | null {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null') as Token | null;
    return t && t.exp > Date.now() ? t : null;
  } catch {
    return null;
  }
}

let token: Token | null = googleConfigured ? readToken() : null;

function clearToken() {
  token = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

// Load Google's sign-in script early: the sign-in popup has to open straight from the click.
let gis: Promise<void> | null = null;
function loadGis(): Promise<void> {
  gis ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gis = null;
      reject(new Error('無法載入 Google 登入'));
    };
    document.head.appendChild(s);
  });
  return gis;
}
if (googleConfigured) loadGis().catch(() => {});

/** True when an earlier sign-in is still valid. Never opens a popup. */
export const hasSession = () => !!token && token.exp > Date.now();

/** Opens Google's sign-in popup. Call it from a click. */
export function connect(): Promise<boolean> {
  return new Promise(resolve => {
    const start = () => {
      const oauth = gisGlobal();
      if (!oauth) return resolve(false);
      const client = oauth.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES.join(' '),
        callback: r => {
          if (!r.access_token || !oauth.hasGrantedAllScopes(r, ...SCOPES)) return resolve(false);
          // Renew a little early so a request never goes out with a token about to lapse.
          token = { value: r.access_token, exp: Date.now() + ((r.expires_in ?? 3600) - 60) * 1000 };
          try {
            localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
            localStorage.setItem(CONNECTED_KEY, '1');
          } catch {}
          resolve(true);
        },
        error_callback: () => resolve(false),
      });
      let before = false;
      try {
        before = localStorage.getItem(CONNECTED_KEY) === '1';
      } catch {}
      // After the first time, Google skips the consent screen.
      client.requestAccessToken(before ? { prompt: '' } : {});
    };
    if (gisGlobal()) start();
    else loadGis().then(start, () => resolve(false));
  });
}

/** Signs out and withdraws this site's access to the calendar. */
export function disconnect() {
  const t = token?.value;
  clearToken();
  try {
    localStorage.removeItem(CONNECTED_KEY);
  } catch {}
  if (t) gisGlobal()?.revoke(t);
}

const enc = encodeURIComponent;

async function call<T>(path: string, init: { method?: string; body?: object } = {}): Promise<T> {
  if (!hasSession()) {
    clearToken();
    throw signInNeeded();
  }
  const res = await fetch(API + path, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token!.value}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401) {
    clearToken();
    throw signInNeeded();
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(j?.error?.message ?? `Google 回應錯誤（${res.status}）`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

async function pages<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined;
  do {
    const r = await call<{ items?: T[]; nextPageToken?: string }>(path + (next ? `&pageToken=${enc(next)}` : ''));
    out.push(...(r.items ?? []));
    next = r.nextPageToken;
  } while (next);
  return out;
}

type GReminder = { method: string; minutes: number };
type GCal = {
  id: string;
  summary: string;
  summaryOverride?: string;
  backgroundColor?: string;
  accessRole: 'owner' | 'writer' | 'reader' | 'freeBusyReader';
  hidden?: boolean;
  defaultReminders?: GReminder[];
};
type GTime = { date?: string; dateTime?: string; timeZone?: string };
type GEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start: GTime;
  end: GTime;
  recurringEventId?: string;
  originalStartTime?: GTime;
  recurrence?: string[];
  reminders?: { useDefault: boolean; overrides?: GReminder[] };
};

/** Each calendar's default reminder, for events that use it. */
const defaultAlarm = new Map<string, number | null>();

export async function loadCalendars(): Promise<CalInfo[]> {
  const list = await pages<GCal>('/users/me/calendarList?maxResults=250');
  return list
    .filter(c => !c.hidden)
    .map(c => {
      const first = c.defaultReminders?.[0];
      defaultAlarm.set(c.id, first ? -first.minutes : null);
      return {
        id: c.id,
        name: c.summaryOverride || c.summary,
        color: c.backgroundColor ?? '#8a93a6',
        account: 'Google',
        isGoogle: true,
        writable: c.accessRole === 'owner' || c.accessRole === 'writer',
      };
    });
}

const timeOf = (t: GTime) => (t.date ? parse(t.date) : new Date(t.dateTime!));

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const FREQS: RepeatFreq[] = ['daily', 'weekly', 'monthly', 'yearly'];

/** UNTIL in RRULE form: a date for all-day series, a UTC time otherwise. */
function untilText(d: Date, allDay: boolean) {
  if (allDay) return key(d).replace(/-/g, '');
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function untilDate(s: string, fallback: Date): Date {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(s);
  if (!m) return fallback;
  if (m[7]) return dayOnly(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])));
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

function fromRule(lines: string[] | undefined, start: Date): Repeat | undefined {
  const line = lines?.find(l => l.startsWith('RRULE:'));
  if (!line) return undefined;
  const f: Record<string, string> = Object.fromEntries(
    line
      .slice(6)
      .split(';')
      .map(p => p.split('=') as [string, string]),
  );
  const freq = (f.FREQ ?? '').toLowerCase() as RepeatFreq;
  if (!FREQS.includes(freq)) return undefined;
  const base = noRepeat(start);
  // Monthly rules can say "2MO" (second Monday); keep just the weekday.
  const days = f.BYDAY
    ? f.BYDAY.split(',')
        .map(s => DAYS.indexOf(s.slice(-2)))
        .filter(n => n >= 0)
    : [];
  return {
    freq,
    interval: +f.INTERVAL || 1,
    weekdays: days.length ? days : base.weekdays,
    end: f.COUNT ? 'count' : f.UNTIL ? 'date' : 'never',
    until: f.UNTIL ? untilDate(f.UNTIL, base.until) : base.until,
    count: +f.COUNT || base.count,
  };
}

function toRule(r: Repeat, allDay: boolean): string | null {
  if (r.freq === 'none') return null;
  const parts = [`FREQ=${r.freq.toUpperCase()}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === 'weekly' && r.weekdays.length) parts.push(`BYDAY=${r.weekdays.map(d => DAYS[d]).join(',')}`);
  if (r.end === 'date') {
    const u = r.until;
    parts.push(`UNTIL=${untilText(new Date(u.getFullYear(), u.getMonth(), u.getDate(), 23, 59, 59), allDay)}`);
  }
  if (r.end === 'count') parts.push(`COUNT=${Math.max(1, r.count)}`);
  return `RRULE:${parts.join(';')}`;
}

/** The series' rule replaced by the editor's, keeping exceptions (EXDATE and the like). */
function withRule(lines: string[] | undefined, d: EventDraft): string[] {
  const rule = toRule(d.repeat, d.allDay);
  return rule ? [...(lines ?? []).filter(l => !l.startsWith('RRULE:')), rule] : [];
}

/** The series cut off just before this occurrence. */
function endBefore(lines: string[], ev: CalEvent): string[] {
  const stop = ev.allDay ? untilText(addDays(ev.sDay, -1), true) : untilText(new Date(+ev.st - 1000), false);
  return lines.map(l =>
    l.startsWith('RRULE:')
      ? `RRULE:${l
          .slice(6)
          .split(';')
          .filter(p => !/^(UNTIL|COUNT)=/.test(p))
          .concat(`UNTIL=${stop}`)
          .join(';')}`
      : l,
  );
}

function toEvent(cal: string, ev: GEvent, masters: Map<string, GEvent>): CalEvent {
  const allDay = !!ev.start.date;
  const st = timeOf(ev.start);
  const en = timeOf(ev.end);
  const sDay = dayOnly(st);
  // All-day ends are exclusive; timed events ending at midnight belong to the day before.
  const eDay = allDay ? addDays(dayOnly(en), -1) : en > st ? dayOnly(new Date(+en - 1)) : sDay;
  const master = ev.recurringEventId ? masters.get(ev.recurringEventId) : undefined;
  const r = ev.reminders;
  const alarm = !r || r.useDefault ? (defaultAlarm.get(cal) ?? null) : r.overrides?.length ? -r.overrides[0].minutes : null;
  return {
    id: `${cal}/${ev.id}`,
    rawId: ev.id,
    recurring: !!ev.recurringEventId,
    series: ev.recurringEventId
      ? {
          id: ev.recurringEventId,
          first: !!master && !!ev.originalStartTime && +timeOf(ev.originalStartTime) === +timeOf(master.start),
        }
      : undefined,
    repeat: master ? fromRule(master.recurrence, st) : undefined,
    alarm,
    notes: htmlToText(ev.description ?? ''),
    rawNotes: ev.description ?? '',
    cal,
    title: ev.summary || '（無標題）',
    location: ev.location,
    allDay,
    st,
    en,
    sDay,
    eDay: eDay < sDay ? sDay : eDay,
    span: allDay || eDay > sDay,
  };
}

async function loadCalendar(cal: string, from: Date, to: Date): Promise<CalEvent[]> {
  const range = `timeMin=${enc(from.toISOString())}&timeMax=${enc(to.toISOString())}&maxResults=2500`;
  const base = `/calendars/${enc(cal)}/events?${range}`;
  try {
    // Occurrences come expanded; the series themselves carry the repeat rules.
    const [items, series] = await Promise.all([pages<GEvent>(`${base}&singleEvents=true`), pages<GEvent>(`${base}&singleEvents=false`)]);
    const masters = new Map(series.filter(s => s.recurrence).map(s => [s.id, s]));
    return items.filter(e => e.status !== 'cancelled').map(e => toEvent(cal, e, masters));
  } catch (e) {
    if (isSignInNeeded(e)) throw e;
    // One calendar failing (e.g. one shared with us and then withdrawn) shouldn't hide the rest.
    return [];
  }
}

export async function loadEvents(calIds: string[], from: Date, to: Date): Promise<CalEvent[]> {
  const lists = await Promise.all(calIds.map(id => loadCalendar(id, from, to)));
  return lists.flat();
}

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function body(d: EventDraft, keepNotes: boolean, recurrence?: string[]) {
  return {
    summary: d.title,
    location: d.location,
    ...(keepNotes ? {} : { description: d.notes }),
    ...(d.allDay
      ? { start: { date: key(d.start) }, end: { date: key(addDays(dayOnly(d.end), 1)) } }
      : { start: { dateTime: d.start.toISOString(), timeZone: zone }, end: { dateTime: d.end.toISOString(), timeZone: zone } }),
    reminders: { useDefault: false, overrides: d.alarm === null ? [] : [{ method: 'popup', minutes: Math.max(0, -d.alarm) }] },
    ...(recurrence ? { recurrence } : {}),
  };
}

const eventPath = (cal: string, id: string) => `/calendars/${enc(cal)}/events/${enc(id)}`;
const patch = (cal: string, id: string, b: object) => call(eventPath(cal, id), { method: 'PATCH', body: b });
const remove = (cal: string, id: string) => call(eventPath(cal, id), { method: 'DELETE' });
const move = (cal: string, id: string, to: string) => call(`${eventPath(cal, id)}/move?destination=${enc(to)}`, { method: 'POST' });

export async function createEvent(d: EventDraft): Promise<void> {
  const rule = toRule(d.repeat, d.allDay);
  await call(`/calendars/${enc(d.cal)}/events`, { method: 'POST', body: body(d, false, rule ? [rule] : undefined) });
}

/** future = this occurrence and every later one in the series. */
export async function updateEvent(ev: CalEvent, d: EventDraft, future: boolean): Promise<void> {
  // Untouched notes keep their stored form, so Google's formatting survives an edit made here.
  const keepNotes = d.notes === ev.notes.trim();
  const s = ev.series;
  if (!s) {
    if (d.cal !== ev.cal) await move(ev.cal, ev.rawId, d.cal);
    await patch(d.cal, ev.rawId, body(d, keepNotes, withRule([], d)));
    return;
  }
  if (!future) {
    if (d.cal === ev.cal) return void (await patch(ev.cal, ev.rawId, body(d, keepNotes)));
    // A single occurrence can't change calendars: copy it there and drop it from the series.
    await createEvent({ ...d, notes: keepNotes ? ev.rawNotes : d.notes, repeat: noRepeat(d.start) });
    await remove(ev.cal, ev.rawId);
    return;
  }
  const master = await call<GEvent>(eventPath(ev.cal, s.id));
  if (s.first) {
    if (d.cal !== ev.cal) await move(ev.cal, s.id, d.cal);
    await patch(d.cal, s.id, body(d, keepNotes, withRule(master.recurrence, d)));
    return;
  }
  // Later in the series: end the old series here and start a new one from this occurrence.
  await patch(ev.cal, s.id, { recurrence: endBefore(master.recurrence ?? [], ev) });
  await createEvent({ ...d, notes: keepNotes ? ev.rawNotes : d.notes });
}

export async function deleteEvent(ev: CalEvent, future: boolean): Promise<void> {
  const s = ev.series;
  if (!s || !future) return void (await remove(ev.cal, ev.rawId));
  if (s.first) return void (await remove(ev.cal, s.id));
  const master = await call<GEvent>(eventPath(ev.cal, s.id));
  await patch(ev.cal, s.id, { recurrence: endBefore(master.recurrence ?? [], ev) });
}
