import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { DOW, dayOnly, hm, key, parse } from './dates';
import type { Theme } from './theme';
import type { CalInfo, EventDraft, Repeat, RepeatFreq } from './types';
import { useScaled } from './zoom';

type Props = {
  t: Theme;
  initial: EventDraft;
  isNew: boolean;
  recurring: boolean;
  /** Calendars the event can be saved to. */
  cals: CalInfo[];
  /** future: apply to this occurrence and every later one in the series. */
  onSave: (d: EventDraft, future: boolean) => Promise<void>;
  onDelete?: (future: boolean) => Promise<void>;
  onCancel: () => void;
};

const FREQS: [RepeatFreq, string][] = [
  ['none', '不重複'],
  ['daily', '每天'],
  ['weekly', '每週'],
  ['monthly', '每月'],
  ['yearly', '每年'],
];
const UNIT: Record<RepeatFreq, string> = { none: '', daily: '天', weekly: '週', monthly: '個月', yearly: '年' };

// Offsets in minutes from the start; all-day events count from midnight of their first day.
const TIMED_ALARMS: [number | null, string][] = [
  [null, '不提醒'],
  [0, '準時'],
  [-10, '10 分鐘前'],
  [-30, '30 分鐘前'],
  [-60, '1 小時前'],
  [-1440, '1 天前'],
];
const ALLDAY_ALARMS: [number | null, string][] = [
  [null, '不提醒'],
  [540, '當天 09:00'],
  [-900, '前一天 09:00'],
  [-9540, '一週前 09:00'],
];

const withTime = (day: Date, time: Date) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.getHours(), time.getMinutes());

export function EventEditor({ t, initial, isNew, recurring, cals, onSave, onDelete, onCancel }: Props) {
  const styles = useScaled(baseStyles);
  const [d, setD] = useState<EventDraft>(initial);
  const [future, setFuture] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Changing one occurrence can't move it to another calendar or change the series' rule.
  const seriesLocked = recurring && !future;

  // Moving the start keeps the event's length, so the end never lands before it.
  const setStart = (start: Date) =>
    setD(p => ({ ...p, start, end: new Date(+start + Math.max(0, +p.end - +p.start)) }));
  const setEnd = (end: Date) => setD(p => ({ ...p, end }));
  const setRepeat = (r: Partial<Repeat>) => setD(p => ({ ...p, repeat: { ...p.repeat, ...r } }));

  const toggleAllDay = (allDay: boolean) =>
    setD(p => {
      if (allDay) return { ...p, allDay, alarm: p.alarm === null ? null : 540, start: dayOnly(p.start), end: dayOnly(p.end) };
      const s = withTime(p.start, new Date(0, 0, 1, 9, 0));
      return { ...p, allDay, alarm: p.alarm === null ? null : -10, start: s, end: new Date(+s + 60 * 60 * 1000) };
    });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(`沒有成功：${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  };

  const save = () => {
    if (!d.title.trim()) return setError('請輸入標題');
    if (d.end < d.start) return setError('結束時間不能早於開始時間');
    if (d.repeat.freq === 'weekly' && !d.repeat.weekdays.length) return setError('請至少選一個重複的星期');
    if (d.repeat.freq !== 'none' && d.repeat.end === 'date' && dayOnly(d.repeat.until) < dayOnly(d.start))
      return setError('重複的結束日期不能早於開始日期');
    run(() => onSave({ ...d, title: d.title.trim(), location: d.location.trim(), notes: d.notes.trim() }, future));
  };

  const sel = cals.find(c => c.id === d.cal);
  const calNotes: string[] = [];
  if (!isNew && d.cal !== initial.cal && sel) calNotes.push(`儲存後會移到「${sel.name}」。`);
  if (sel && !sel.isGoogle) calNotes.push(`「${sel.name}」不在 Google 帳號裡，不會同步到 Google 日曆。`);

  const alarms = d.allDay ? ALLDAY_ALARMS : TIMED_ALARMS;
  const alarmOptions = alarms.some(([v]) => v === d.alarm) ? alarms : [...alarms, [d.alarm, '自訂'] as [number | null, string]];
  const r = d.repeat;

  return (
    <ScrollView style={styles.wrap} keyboardShouldPersistTaps="handled">
      <Text style={[styles.heading, { color: t.ink }]}>{isNew ? '新增行程' : '編輯行程'}</Text>

      <TextInput
        value={d.title}
        onChangeText={title => setD(p => ({ ...p, title }))}
        placeholder="標題"
        placeholderTextColor={t.muted}
        autoFocus={isNew}
        style={[styles.input, styles.titleInput, { color: t.ink, borderColor: t.line, backgroundColor: t.bg }]}
      />

      {recurring && (
        <Section t={t} label="這是重複行程，要修改">
          <Chips
            t={t}
            options={[
              [false, '只有這次'],
              [true, '這次及之後的所有行程'],
            ]}
            value={future}
            onChange={setFuture}
          />
        </Section>
      )}

      <Section t={t} label="日曆">
        <View style={styles.wrapRow}>
          {cals.map(c => {
            const on = c.id === d.cal;
            const locked = seriesLocked && !on;
            return (
              <Pressable
                key={c.id}
                disabled={locked}
                onPress={() => setD(p => ({ ...p, cal: c.id }))}
                style={[
                  styles.chip,
                  { borderColor: on ? c.color : t.line, backgroundColor: on ? t.shade : 'transparent' },
                  locked && styles.dim,
                ]}
              >
                <View style={[styles.swatch, { backgroundColor: c.color }]} />
                <Text style={[styles.chipText, { color: on ? t.ink : t.muted }]}>{c.name}</Text>
                {!!c.account && <Text style={[styles.calAccount, { color: t.muted }]}>{c.account}</Text>}
              </Pressable>
            );
          })}
        </View>
        {calNotes.length > 0 && <Text style={[styles.note, { color: t.muted }]}>{calNotes.join('')}</Text>}
        {seriesLocked && <Text style={[styles.note, { color: t.muted }]}>要換日曆或改重複方式，請選「這次及之後的所有行程」。</Text>}
      </Section>

      <View style={[styles.row, styles.field]}>
        <Text style={[styles.label, { color: t.ink }]}>全天</Text>
        <Switch value={d.allDay} onValueChange={toggleAllDay} />
      </View>
      <DateRow t={t} label="開始" value={d.start} allDay={d.allDay} onChange={setStart} />
      <DateRow t={t} label="結束" value={d.end} allDay={d.allDay} onChange={setEnd} />

      <Section t={t} label="重複">
        <View style={seriesLocked && styles.dim} pointerEvents={seriesLocked ? 'none' : 'auto'}>
          <Chips
            t={t}
            options={FREQS}
            value={r.freq}
            onChange={freq => setRepeat({ freq, weekdays: r.weekdays.length ? r.weekdays : [d.start.getDay()] })}
          />
          {r.freq !== 'none' && (
            <View style={styles.repeatBox}>
              <View style={styles.row}>
                <Text style={[styles.label, { color: t.ink }]}>間隔</Text>
                <Stepper t={t} value={r.interval} min={1} max={99} onChange={interval => setRepeat({ interval })} prefix="每" suffix={UNIT[r.freq]} />
              </View>
              {r.freq === 'weekly' && (
                <View style={[styles.row, styles.gapTop]}>
                  <Text style={[styles.label, { color: t.ink }]}>星期</Text>
                  <View style={styles.weekdays}>
                    {DOW.map((name, i) => {
                      const on = r.weekdays.includes(i);
                      return (
                        <Pressable
                          key={i}
                          onPress={() => setRepeat({ weekdays: on ? r.weekdays.filter(x => x !== i) : [...r.weekdays, i] })}
                          style={[styles.weekday, { borderColor: on ? t.accent : t.line, backgroundColor: on ? t.accent : 'transparent' }]}
                        >
                          <Text style={[styles.weekdayText, { color: on ? t.onAccent : t.ink }]}>{name}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}
              <View style={styles.gapTop}>
                <Text style={[styles.label, { color: t.ink }]}>結束</Text>
                <View style={styles.gapSmall}>
                  <Chips<Repeat['end']>
                    t={t}
                    options={[
                      ['never', '永不'],
                      ['date', '於指定日期'],
                      ['count', '重複幾次後'],
                    ]}
                    value={r.end}
                    onChange={end => setRepeat({ end })}
                  />
                </View>
                {r.end === 'date' && (
                  <View style={[styles.row, styles.gapSmall]}>
                    <Text style={[styles.sub, { color: t.muted }]}>最後一天</Text>
                    <DatePart t={t} mode="date" value={r.until} onChange={until => setRepeat({ until })} />
                  </View>
                )}
                {r.end === 'count' && (
                  <View style={[styles.row, styles.gapSmall]}>
                    <Text style={[styles.sub, { color: t.muted }]}>總共</Text>
                    <Stepper t={t} value={r.count} min={1} max={999} onChange={count => setRepeat({ count })} suffix="次" />
                  </View>
                )}
              </View>
              <Text style={[styles.note, { color: t.muted }]}>{describeRepeat(d)}</Text>
            </View>
          )}
        </View>
      </Section>

      <Section t={t} label="提醒">
        <Chips t={t} options={alarmOptions} value={d.alarm} onChange={alarm => setD(p => ({ ...p, alarm }))} />
      </Section>

      <TextInput
        value={d.location}
        onChangeText={location => setD(p => ({ ...p, location }))}
        placeholder="地點（選填）"
        placeholderTextColor={t.muted}
        style={[styles.input, styles.field, { color: t.ink, borderColor: t.line, backgroundColor: t.bg }]}
      />
      <TextInput
        value={d.notes}
        onChangeText={notes => setD(p => ({ ...p, notes }))}
        placeholder="說明（選填）"
        placeholderTextColor={t.muted}
        multiline
        style={[styles.input, styles.field, styles.notes, { color: t.ink, borderColor: t.line, backgroundColor: t.bg }]}
      />

      {!!error && <Text style={[styles.note, { color: t.holiday }]}>{error}</Text>}

      <View style={[styles.row, styles.actions]}>
        {onDelete &&
          (confirmDelete ? (
            <Pressable disabled={busy} onPress={() => run(() => onDelete(future))} style={[styles.btn, { backgroundColor: t.holiday }]}>
              <Text style={[styles.btnText, { color: '#ffffff' }]}>{recurring ? (future ? '確定刪除這次及之後' : '確定只刪除這次') : '確定刪除'}</Text>
            </Pressable>
          ) : (
            <Pressable disabled={busy} onPress={() => setConfirmDelete(true)} style={styles.btn}>
              <Text style={[styles.btnText, { color: t.holiday }]}>刪除</Text>
            </Pressable>
          ))}
        <View style={styles.spacer} />
        {busy && <ActivityIndicator color={t.accent} />}
        <Pressable disabled={busy} onPress={onCancel} style={[styles.btn, { borderColor: t.line, borderWidth: StyleSheet.hairlineWidth }]}>
          <Text style={[styles.btnText, { color: t.ink }]}>取消</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={save} style={[styles.btn, { backgroundColor: t.accent }]}>
          <Text style={[styles.btnText, { color: t.onAccent }]}>儲存</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/** Plain-language summary, e.g. "每 2 週的一、三，共 10 次". */
function describeRepeat(d: EventDraft): string {
  const r = d.repeat;
  const every = r.interval === 1 ? { daily: '每天', weekly: '每週', monthly: '每月', yearly: '每年', none: '' }[r.freq] : `每 ${r.interval} ${UNIT[r.freq]}`;
  let when = every;
  if (r.freq === 'weekly') when += `的${[...r.weekdays].sort().map(i => DOW[i]).join('、')}`;
  if (r.freq === 'monthly') when += `的 ${d.start.getDate()} 號`;
  if (r.freq === 'yearly') when += `的 ${d.start.getMonth() + 1} 月 ${d.start.getDate()} 日`;
  const end = r.end === 'never' ? '，沒有結束日' : r.end === 'date' ? `，到 ${key(r.until)} 為止` : `，共 ${r.count} 次`;
  return when + end;
}

function Section({ t, label, children }: { t: Theme; label: string; children: React.ReactNode }) {
  const styles = useScaled(baseStyles);
  return (
    <View style={styles.field}>
      <Text style={[styles.sectionLabel, { color: t.muted }]}>{label}</Text>
      {children}
    </View>
  );
}

function Chips<T>({ t, options, value, onChange }: { t: Theme; options: [T, string][]; value: T; onChange: (v: T) => void }) {
  const styles = useScaled(baseStyles);
  return (
    <View style={styles.wrapRow}>
      {options.map(([v, label]) => {
        const on = v === value;
        return (
          <Pressable
            key={label}
            onPress={() => onChange(v)}
            style={[styles.chip, { borderColor: on ? t.accent : t.line, backgroundColor: on ? t.accent : 'transparent' }]}
          >
            <Text style={[styles.chipText, { color: on ? t.onAccent : t.ink }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Stepper({
  t,
  value,
  min,
  max,
  onChange,
  prefix,
  suffix,
}: {
  t: Theme;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  prefix?: string;
  suffix?: string;
}) {
  const styles = useScaled(baseStyles);
  const btn = (label: string, next: number) => (
    <Pressable
      disabled={next < min || next > max}
      onPress={() => onChange(next)}
      style={[styles.stepBtn, { borderColor: t.line }, (next < min || next > max) && styles.dim]}
    >
      <Text style={[styles.stepText, { color: t.ink }]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={styles.stepper}>
      {!!prefix && <Text style={[styles.sub, { color: t.ink }]}>{prefix}</Text>}
      {btn('−', value - 1)}
      <Text style={[styles.stepValue, { color: t.ink }]}>{value}</Text>
      {btn('+', value + 1)}
      {!!suffix && <Text style={[styles.sub, { color: t.ink }]}>{suffix}</Text>}
    </View>
  );
}

function DateRow({ t, label, value, allDay, onChange }: { t: Theme; label: string; value: Date; allDay: boolean; onChange: (d: Date) => void }) {
  const styles = useScaled(baseStyles);
  return (
    <View style={[styles.row, styles.field]}>
      <Text style={[styles.label, { color: t.ink }]}>{label}</Text>
      <View style={styles.pickers}>
        <DatePart t={t} mode="date" value={value} onChange={day => onChange(withTime(day, value))} />
        {!allDay && <DatePart t={t} mode="time" value={value} onChange={time => onChange(withTime(value, time))} />}
      </View>
    </View>
  );
}

/** Native compact picker on iOS/Android; a typed field on web, where the picker isn't available. */
function DatePart({ t, mode, value, onChange }: { t: Theme; mode: 'date' | 'time'; value: Date; onChange: (d: Date) => void }) {
  const styles = useScaled(baseStyles);
  const text = mode === 'date' ? key(value) : hm(value);
  const [draft, setDraft] = useState(text);
  const [lastText, setLastText] = useState(text);
  if (text !== lastText) {
    setLastText(text);
    setDraft(text);
  }

  if (Platform.OS !== 'web') {
    return (
      <DateTimePicker
        value={value}
        mode={mode}
        display="compact"
        locale="zh-Hant-TW"
        minuteInterval={5}
        accentColor={t.accent}
        onValueChange={(_, d) => onChange(d)}
      />
    );
  }

  const commit = () => {
    if (mode === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(draft)) return onChange(parse(draft));
    const m = /^(\d{1,2}):(\d{2})$/.exec(draft);
    if (mode === 'time' && m) return onChange(new Date(0, 0, 1, +m[1], +m[2]));
    setDraft(text);
  };
  return (
    <TextInput
      value={draft}
      onChangeText={setDraft}
      onBlur={commit}
      onSubmitEditing={commit}
      style={[styles.input, styles.webDate, { color: t.ink, borderColor: t.line, backgroundColor: t.bg }]}
    />
  );
}

const baseStyles = StyleSheet.create({
  wrap: { flexGrow: 0 },
  heading: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  titleInput: { fontSize: 16 },
  notes: { minHeight: 64, textAlignVertical: 'top' },
  field: { marginTop: 14 },
  sectionLabel: { fontSize: 12, marginBottom: 6 },
  label: { fontSize: 14 },
  sub: { fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gapTop: { marginTop: 10 },
  gapSmall: { marginTop: 6 },
  pickers: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  chipText: { fontSize: 12 },
  calAccount: { fontSize: 10 },
  dim: { opacity: 0.4 },
  repeatBox: { marginTop: 10, paddingLeft: 2 },
  weekdays: { flexDirection: 'row', gap: 4 },
  weekday: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  weekdayText: { fontSize: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: { width: 28, height: 28, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 16 },
  stepValue: { minWidth: 24, textAlign: 'center', fontSize: 14, fontVariant: ['tabular-nums'] },
  note: { fontSize: 12, marginTop: 8 },
  actions: { marginTop: 18, gap: 8 },
  spacer: { flex: 1 },
  btn: { height: 36, paddingHorizontal: 14, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 14, fontWeight: '600' },
  webDate: { width: 110, paddingVertical: 5, fontSize: 13 },
});
