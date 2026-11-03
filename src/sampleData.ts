// Example events for web, previews and devices without calendar access.
import { addDays, dayOnly, key, parse } from './dates';
import { noRepeat, type CalEvent, type CalInfo, type EventDraft } from './types';

export const SAMPLE_CALS: CalInfo[] = [
  { id: 'work', writable: true, account: '範例', isGoogle: true, name: '工作', color: '#3465d4' },
  { id: 'proj', writable: true, account: '範例', isGoogle: true, name: '專案：新品上市', color: '#7d50c9' },
  { id: 'personal', writable: true, account: '範例', isGoogle: true, name: '個人', color: '#22916a' },
  { id: 'family', writable: true, account: '範例', isGoogle: true, name: '家庭', color: '#d27419' },
  { id: 'holiday', writable: false, account: '範例', isGoogle: false, name: '台灣假日', color: '#cf423c' },
];

export function sampleEvents(): CalEvent[] {
  const out: CalEvent[] = [];
  const allDay = (cal: string, title: string, start: string, endIncl?: string, location?: string) => {
    const sDay = parse(start);
    const eDay = parse(endIncl ?? start);
    out.push({ id: `s${out.length}`, cal, title, location, rawId: `s${out.length}`, recurring: false, alarm: null, notes: '', rawNotes: '', allDay: true, st: sDay, en: addDays(eDay, 1), sDay, eDay, span: true });
  };
  const timed = (cal: string, title: string, date: string, t1: string, t2: string, location?: string) => {
    const d = parse(date);
    const [h1, m1] = t1.split(':').map(Number);
    const [h2, m2] = t2.split(':').map(Number);
    const st = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h1, m1);
    const en = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h2, m2);
    out.push({ id: `s${out.length}`, cal, title, location, rawId: `s${out.length}`, recurring: false, alarm: null, notes: '', rawNotes: '', allDay: false, st, en, sDay: dayOnly(st), eDay: dayOnly(st), span: false });
  };

  allDay('proj', '需求訪談', '2026-11-09', '2026-11-27');
  allDay('proj', '介面設計', '2026-11-30', '2027-01-15');
  allDay('proj', '開發衝刺', '2027-01-18', '2027-03-26');
  allDay('proj', '測試與修正', '2027-03-29', '2027-04-23');
  allDay('proj', '新品上市週', '2027-04-26', '2027-04-30');
  allDay('work', '東京出差', '2026-11-16', '2026-11-19', '東京');
  allDay('work', '年度預算編列', '2026-12-07', '2026-12-18');
  allDay('work', '季度規劃 Offsite', '2027-01-06', '2027-01-07', '宜蘭');
  allDay('work', '新加坡展會', '2027-05-17', '2027-05-20', '新加坡');
  allDay('personal', '年假', '2026-12-28', '2026-12-31');
  allDay('personal', '半程馬拉松', '2027-03-14', undefined, '台北');
  allDay('family', '媽媽生日', '2026-11-22');
  allDay('family', '北海道家族旅行', '2027-02-11', '2027-02-16', '札幌');
  allDay('family', '搬家', '2027-05-22', '2027-05-23');
  allDay('holiday', '元旦', '2027-01-01');
  allDay('holiday', '春節連假', '2027-02-05', '2027-02-10');
  allDay('holiday', '和平紀念日', '2027-02-28');
  allDay('holiday', '兒童節・清明節', '2027-04-03', '2027-04-06');
  allDay('holiday', '勞動節', '2027-05-01');
  allDay('holiday', '端午節', '2027-06-09');
  timed('work', '面試：前端工程師', '2026-11-04', '11:00', '12:00');
  timed('work', '客戶簡報', '2026-11-05', '14:00', '15:30', '信義區辦公室');
  timed('work', '面試：設計師', '2026-11-06', '16:00', '17:00');
  timed('personal', '牙醫回診', '2026-11-12', '14:30', '15:30');
  timed('personal', '音樂會', '2026-11-28', '19:30', '21:30', '國家音樂廳');
  timed('work', '董事會報告', '2026-12-03', '09:30', '11:00');
  timed('work', '年終考核面談', '2026-12-21', '10:00', '11:00');
  timed('work', '尾牙', '2027-01-22', '18:30', '21:30');
  timed('personal', '健康檢查', '2027-02-24', '08:00', '11:00');
  timed('family', '家長會', '2027-03-05', '19:00', '20:30');
  timed('work', '上市發表會', '2027-04-28', '14:00', '17:00', '松山文創園區');

  for (let d = parse('2026-09-28'), i = 0; d <= parse('2027-07-31'); d = addDays(d, 1), i++) {
    const k = key(d);
    const wd = d.getDay();
    const wk = Math.floor(i / 7);
    if (wd === 1) timed('work', '週會', k, '10:00', '11:00');
    if (wd === 3) timed('personal', '健身', k, '19:30', '20:30');
    if (wd === 5 && wk % 2 === 0) timed('work', '1:1 與主管', k, '15:00', '15:30');
    if (wd === 4 && d >= parse('2026-11-09') && d <= parse('2027-04-30')) timed('proj', '專案站會', k, '09:30', '09:45');
    if (wd === 0 && wk % 2 === 1) timed('family', '回爸媽家吃飯', k, '18:00', '20:00');
  }
  return out;
}

let nextId = 1;

/** Start times of every occurrence a draft describes, capped at two years or 500 occurrences. */
function occurrenceStarts(d: EventDraft): Date[] {
  const r = d.repeat;
  if (r.freq === 'none') return [d.start];
  const s = d.start;
  const at = (y: number, m: number, day: number) => new Date(y, m, day, s.getHours(), s.getMinutes());
  const last = r.end === 'date' ? at(r.until.getFullYear(), r.until.getMonth(), r.until.getDate()) : at(s.getFullYear() + 2, s.getMonth(), s.getDate());
  const max = r.end === 'count' ? Math.max(1, r.count) : 500;
  const n = Math.max(1, r.interval);
  const out: Date[] = [];
  for (let i = 0; out.length < max && i < 2000; i++) {
    let batch: Date[];
    if (r.freq === 'daily') batch = [at(s.getFullYear(), s.getMonth(), s.getDate() + i * n)];
    else if (r.freq === 'weekly') {
      const ws = addDays(dayOnly(s), -s.getDay() + i * 7 * n);
      const days = r.weekdays.length ? [...r.weekdays].sort() : [s.getDay()];
      batch = days.map(wd => at(ws.getFullYear(), ws.getMonth(), ws.getDate() + wd)).filter(x => x >= s);
    } else {
      const months = r.freq === 'monthly' ? i * n : i * n * 12;
      const x = at(s.getFullYear(), s.getMonth() + months, s.getDate());
      // Skip months without this date (e.g. the 31st).
      batch = x.getDate() === s.getDate() ? [x] : [];
    }
    if (batch.length && batch[0] > last) break;
    for (const x of batch) if (x <= last && out.length < max) out.push(x);
  }
  return out;
}

function toEvent(d: EventDraft, start: Date, id: string, rawId: string, recurring: boolean, repeat = d.repeat): CalEvent {
  const length = +d.end - +d.start;
  const end = new Date(+start + length);
  const sDay = dayOnly(start);
  const eDay = d.allDay ? dayOnly(end) : dayOnly(new Date(Math.max(+start, +end - 1)));
  return {
    id,
    rawId,
    recurring,
    repeat: recurring ? repeat : undefined,
    alarm: d.alarm,
    notes: d.notes,
    rawNotes: d.notes,
    cal: d.cal,
    title: d.title,
    location: d.location || null,
    allDay: d.allDay,
    st: d.allDay ? sDay : start,
    en: d.allDay ? addDays(eDay, 1) : end,
    sDay,
    eDay,
    span: d.allDay || eDay > sDay,
  };
}

/** Turns an editor draft into in-memory events, one per occurrence. */
function expandDraft(d: EventDraft): CalEvent[] {
  const rawId = `new${nextId++}`;
  const recurring = d.repeat.freq !== 'none';
  return occurrenceStarts(d).map(st => toEvent(d, st, `${rawId}@${+st}`, rawId, recurring));
}

/** Applies an editor save to sample data the way a calendar store would. */
export function applySampleEdit(list: CalEvent[], ev: CalEvent | undefined, d: EventDraft, future: boolean): CalEvent[] {
  if (!ev) return [...list, ...expandDraft(d)];
  if (ev.recurring && !future) {
    // One occurrence changes; it stays part of its series.
    return list.map(x => (x.id === ev.id ? toEvent({ ...d, repeat: ev.repeat ?? noRepeat(d.start) }, d.start, ev.id, ev.rawId, true, ev.repeat) : x));
  }
  return [...removeSample(list, ev, future), ...expandDraft(d)];
}

export function removeSample(list: CalEvent[], ev: CalEvent, future: boolean): CalEvent[] {
  if (ev.recurring && future) return list.filter(x => !(x.rawId === ev.rawId && x.st >= ev.st));
  return list.filter(x => x.id !== ev.id);
}
