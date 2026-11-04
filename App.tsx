import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  KeyboardAvoidingView,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { addDays, dayOnly, diff, fmtDay, fmtShort, hm, key, startOfWeek } from './src/dates';
import {
  calendarSupported,
  connect,
  createEvent,
  deleteEvent,
  disconnect,
  isSignInNeeded,
  loadCalendars,
  loadEvents,
  needsSignIn,
  requestAccess,
  updateEvent,
} from './src/calendar';
import { DayPlanner } from './src/DayPlanner';
import { useDayPlans } from './src/dayPlans';
import { EventEditor } from './src/EventEditor';
import { SAMPLE_CALS, applySampleEdit, removeSample, sampleEvents } from './src/sampleData';
import { useTheme, type Theme } from './src/theme';
import { noRepeat, type CalEvent, type CalInfo, type EventDraft } from './src/types';
import { WeekGrid } from './src/WeekGrid';
import { WeekSlider } from './src/WeekSlider';
import { ZoomContext, addZoomListener, useScaled, useZoom, useZoomState } from './src/zoom';

type Editing = { draft: EventDraft; ev?: CalEvent };

const MAX_WEEKS = 26;
/** Calendar chips per row, by the width of the chip area. */
const chipColumns = (w: number) => (w >= 1000 ? 10 : w >= 700 ? 6 : w >= 480 ? 4 : 3);
const CHIP_GAP = 6;
const clampWeeks = (n: number) => Math.max(1, Math.min(MAX_WEEKS, n));

type Source = 'device' | 'sample';

export default function App() {
  const { zoom, step } = useZoomState();
  useEffect(() => addZoomListener(step), [step]);
  return (
    <SafeAreaProvider>
      <ZoomContext.Provider value={zoom}>
        <Planner onZoom={step} />
      </ZoomContext.Provider>
    </SafeAreaProvider>
  );
}

/** onZoom: 1 = bigger, -1 = smaller, 0 = actual size. */
function Planner({ onZoom }: { onZoom: (step: number) => void }) {
  const styles = useScaled(baseStyles);
  const zoom = useZoom();
  const t = useTheme();
  const today = useMemo(() => dayOnly(new Date()), []);
  const [wso, setWso] = useState(1);
  const [weeks, setWeeksRaw] = useState(13);
  const [start, setStart] = useState(() => startOfWeek(today, 1));
  const [source, setSource] = useState<Source>(calendarSupported ? 'device' : 'sample');
  const [access, setAccess] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  /** Web: the Google sign-in ran out while the page was open. */
  const [expired, setExpired] = useState(false);
  const [cals, setCals] = useState<CalInfo[]>(SAMPLE_CALS);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [openEvent, setOpenEvent] = useState<CalEvent | null>(null);
  const [openDay, setOpenDay] = useState<Date | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [planDay, setPlanDay] = useState<Date | null>(null);
  const { planned, save: savePlan } = useDayPlans();
  const loaded = useRef<{ from: Date; to: Date; source: Source } | null>(null);

  const setWeeks = useCallback((n: number | ((w: number) => number)) => {
    setWeeksRaw(w => clampWeeks(typeof n === 'function' ? n(w) : n));
  }, []);
  const shift = useCallback((n: number) => setStart(s => addDays(s, n * 7)), []);

  // Ask for calendar access once; fall back to sample data when refused.
  useEffect(() => {
    if (source !== 'device' || access !== 'unknown') return;
    requestAccess()
      .then(ok => setAccess(ok ? 'granted' : 'denied'))
      .catch(() => setAccess('denied'));
  }, [source, access]);

  const fetchRange = useCallback(
    async (force = false) => {
      const viewEnd = addDays(start, weeks * 7);
      const l = loaded.current;
      // Without access, show the examples; after a lapsed web sign-in, keep the events already shown.
      if (expired) return;
      const src: Source = access === 'denied' ? 'sample' : source;
      if (!force && l && l.source === src && l.from <= start && l.to >= viewEnd) return;
      if (src === 'sample') {
        // Keep in-memory edits when the app comes back to the foreground.
        if (l?.source === 'sample') return;
        setCals(SAMPLE_CALS);
        setEvents(sampleEvents());
        loaded.current = { from: new Date(-8.64e15), to: new Date(8.64e15), source: src };
        return;
      }
      if (access !== 'granted') return;
      // Load a margin around the view so small moves don't refetch.
      const from = addDays(start, -8 * 7);
      const to = addDays(viewEnd, 8 * 7);
      try {
        const list = await loadCalendars();
        setCals(list);
        setEvents(await loadEvents(list.map(c => c.id), from, to));
        loaded.current = { from, to, source };
      } catch (e) {
        if (!isSignInNeeded(e)) throw e;
        loaded.current = null;
        setExpired(true);
        setAccess('denied');
      }
    },
    [start, weeks, source, access, expired],
  );

  useEffect(() => {
    fetchRange().catch(() => {});
  }, [fetchRange]);

  // Pick up edits made elsewhere (e.g. Google Calendar, once the device has synced them):
  // on returning to the app, and every 30 seconds while it's open.
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(() => {
    setRefreshing(true);
    fetchRange(true)
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [fetchRange]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') fetchRange(true).catch(() => {});
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') fetchRange(true).catch(() => {});
    }, 30_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [fetchRange]);

  const colors = useMemo(() => Object.fromEntries(cals.map(c => [c.id, c.color])), [cals]);
  const visible = useMemo(() => events.filter(e => !hidden.has(e.cal)), [events, hidden]);
  const writableCals = useMemo(() => cals.filter(c => c.writable), [cals]);
  const usingDevice = source === 'device' && access === 'granted';

  const closeSheet = () => {
    setOpenEvent(null);
    setOpenDay(null);
    setEditing(null);
  };

  const startNew = (day: Date) => {
    const shown = writableCals.filter(c => !hidden.has(c.id));
    const cal = shown.find(c => c.isGoogle) ?? writableCals.find(c => c.isGoogle) ?? shown[0] ?? writableCals[0];
    if (!cal) return;
    const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0);
    setEditing({
      draft: {
        cal: cal.id,
        title: '',
        location: '',
        notes: '',
        allDay: false,
        start: s,
        end: new Date(+s + 3600e3),
        repeat: noRepeat(s),
        alarm: null,
      },
    });
  };

  const startEdit = (e: CalEvent) =>
    setEditing({
      ev: e,
      draft: {
        cal: e.cal,
        title: e.title,
        location: e.location ?? '',
        notes: e.notes,
        allDay: e.allDay,
        start: e.allDay ? e.sDay : e.st,
        end: e.allDay ? e.eDay : e.en,
        repeat: e.repeat ?? noRepeat(e.st),
        alarm: e.alarm,
      },
    });

  const expiredError = () => new Error('Google 連線已過期，請重新連接 Google 日曆後再試一次。');
  /** Web: a save or delete found the Google sign-in expired. */
  const signInLost = (e: unknown) => {
    if (!isSignInNeeded(e)) return e;
    setExpired(true);
    setAccess('denied');
    return expiredError();
  };

  const signIn = () =>
    connect().then(ok => {
      if (!ok) return;
      loaded.current = null;
      setExpired(false);
      setSource('device');
      setAccess('granted');
    });

  const signOut = () => {
    disconnect();
    loaded.current = null;
    setExpired(false);
    setHidden(new Set());
    setAccess('denied');
  };

  const saveDraft = async (d: EventDraft, future: boolean) => {
    const ev = editing?.ev;
    if (expired) throw expiredError();
    if (usingDevice) {
      await (ev ? updateEvent(ev, d, future) : createEvent(d)).catch(e => {
        throw signInLost(e);
      });
      await fetchRange(true);
    } else {
      setEvents(list => applySampleEdit(list, ev, d, future));
    }
    closeSheet();
  };

  const removeEvent = async (ev: CalEvent, future: boolean) => {
    if (expired) throw expiredError();
    if (usingDevice) {
      await deleteEvent(ev, future).catch(e => {
        throw signInLost(e);
      });
      await fetchRange(true);
    } else {
      setEvents(list => removeSample(list, ev, future));
    }
    closeSheet();
  };

  // Scrolling (wheel, trackpad, one finger) is handled by the grid; two fingers pinch to change how many weeks show.
  const weeksRef = useRef(weeks);
  weeksRef.current = weeks;
  const pinch = useRef({ d: 0, w: 0 });
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: e => e.nativeEvent.touches.length >= 2,
        onPanResponderGrant: () => {
          pinch.current = { d: 0, w: weeksRef.current };
        },
        onPanResponderMove: e => {
          const touches = e.nativeEvent.touches;
          if (touches.length < 2) return;
          const d = Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY) || 1;
          if (!pinch.current.d) pinch.current = { d, w: weeksRef.current };
          setWeeks(Math.round((pinch.current.w * pinch.current.d) / d));
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [setWeeks],
  );

  const toggleCal = (id: string) =>
    setHidden(h => {
      const n = new Set(h);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const switchWso = () => {
    const next = wso === 1 ? 0 : 1;
    setWso(next);
    setStart(s => startOfWeek(addDays(s, 3), next));
  };

  const [chipsWidth, setChipsWidth] = useState(0);
  // Bigger text fits fewer chips per row.
  const cols = chipColumns(chipsWidth / zoom);
  const chipWidth = chipsWidth ? Math.floor((chipsWidth - CHIP_GAP * zoom * (cols - 1)) / cols) : undefined;

  const end = addDays(start, weeks * 7 - 1);
  const showingSample = source === 'sample' || access === 'denied';

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.bg }]} edges={['top', 'left', 'right']}>
      <StatusBar style="auto" />

      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: t.ink }]}>遠景行事曆</Text>
        <Text style={[styles.range, { color: t.muted }]}>
          {fmtShort(start)} – {fmtShort(end)}・{weeks} 週
        </Text>
      </View>

      <WeekSlider t={t} value={weeks} min={1} max={MAX_WEEKS} onChange={setWeeks} />

      <View style={[styles.toolRow, styles.wrapRow]}>
        <Btn t={t} label="今天" onPress={() => setStart(startOfWeek(today, wso))} />
        <Btn t={t} label="‹" onPress={() => shift(-Math.max(1, Math.ceil(weeks / 2)))} square />
        <Btn t={t} label="›" onPress={() => shift(Math.max(1, Math.ceil(weeks / 2)))} square />
        <Btn t={t} label={wso === 1 ? '週一起始' : '週日起始'} onPress={switchWso} />
        {writableCals.length > 0 && <Btn t={t} label="＋ 新增" onPress={() => startNew(today)} primary />}
        {usingDevice && <Btn t={t} label={refreshing ? '更新中…' : '↻ 重新整理'} onPress={refresh} />}
        <View style={styles.zoomGroup}>
          <Btn t={t} label="A−" onPress={() => onZoom(-1)} square />
          <Pressable onPress={() => onZoom(0)} hitSlop={4}>
            <Text style={[styles.zoomText, { color: zoom === 1 ? t.muted : t.accent }]}>{Math.round(zoom * 100)}%</Text>
          </Pressable>
          <Btn t={t} label="A+" onPress={() => onZoom(1)} square />
        </View>
        {calendarSupported && access === 'granted' && (
          <Btn
            t={t}
            label={source === 'device' ? '我的日曆' : '範例資料'}
            onPress={() => {
              setHidden(new Set());
              setSource(s => (s === 'device' ? 'sample' : 'device'));
            }}
          />
        )}
        {needsSignIn && usingDevice && <Btn t={t} label="登出 Google" onPress={signOut} />}
      </View>

      {showingSample && (
        <View style={[styles.notice, { backgroundColor: t.shade }]}>
          <Text style={[styles.noticeText, { color: t.muted }]}>
            {!calendarSupported
              ? needsSignIn
                ? '範例資料・網頁版尚未設定 Google 連線'
                : '範例資料・這個裝置無法讀取日曆'
              : access === 'denied'
                ? needsSignIn
                  ? expired
                    ? 'Google 連線已過期・顯示的是上次載入的行程'
                    : '範例資料・尚未連接 Google 日曆'
                  : '範例資料・尚未允許讀取日曆'
                : '範例資料'}
          </Text>
          {calendarSupported && access === 'denied' && (
            <Pressable onPress={needsSignIn ? signIn : () => Linking.openSettings()}>
              <Text style={[styles.noticeLink, { color: t.accent }]}>
                {needsSignIn ? (expired ? '重新連接' : '連接 Google 日曆') : '到設定開啟'}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.chips} onLayout={e => setChipsWidth(e.nativeEvent.layout.width)}>
        {cals.map(c => {
          const on = !hidden.has(c.id);
          return (
            <Pressable
              key={c.id}
              onPress={() => toggleCal(c.id)}
              style={[styles.chip, { width: chipWidth, borderColor: t.line, backgroundColor: on ? t.surface : 'transparent' }]}
            >
              <View style={[styles.swatch, on ? { backgroundColor: c.color } : { borderWidth: 1.5, borderColor: c.color }]} />
              <Text numberOfLines={1} style={[styles.chipText, { color: on ? t.ink : t.muted }]}>
                {c.name}
              </Text>
              {source === 'device' && !!c.account && <Text style={[styles.chipAccount, { color: t.muted }]}>{c.account}</Text>}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.gridWrap} {...pan.panHandlers}>
        <WeekGrid
          start={start}
          weeks={weeks}
          wso={wso}
          today={today}
          events={visible}
          colors={colors}
          theme={t}
          onEvent={setOpenEvent}
          onDay={setOpenDay}
          onStart={setStart}
          planned={planned}
          onPlan={setPlanDay}
        />
      </View>

      <Sheet t={t} visible={!!openEvent || !!openDay || !!editing} onClose={closeSheet} hideClose={!!editing}>
        {editing ? (
          <EventEditor
            key={editing.ev?.id ?? 'new'}
            t={t}
            initial={editing.draft}
            isNew={!editing.ev}
            recurring={!!editing.ev?.recurring}
            cals={writableCals}
            onSave={saveDraft}
            onDelete={editing.ev ? future => removeEvent(editing.ev!, future) : undefined}
            onCancel={() => setEditing(null)}
          />
        ) : openEvent ? (
          <EventDetail
            t={t}
            e={openEvent}
            cal={cals.find(c => c.id === openEvent.cal)}
            onEdit={() => startEdit(openEvent)}
          />
        ) : openDay ? (
          <DayList
            t={t}
            day={openDay}
            events={visible}
            colors={colors}
            onPick={e => setOpenEvent(e)}
            onAdd={writableCals.length ? () => startNew(openDay) : undefined}
            hasPlan={planned.has(key(openDay))}
            onPlan={() => {
              setPlanDay(openDay);
              closeSheet();
            }}
          />
        ) : null}
      </Sheet>

      {planDay && (
        <DayPlanner
          t={t}
          day={planDay}
          today={today}
          events={visible}
          colors={colors}
          onSave={savePlan}
          onDay={setPlanDay}
          onClose={() => setPlanDay(null)}
        />
      )}
    </SafeAreaView>
  );
}

function Btn({ t, label, onPress, square, primary }: { t: Theme; label: string; onPress: () => void; square?: boolean; primary?: boolean }) {
  const styles = useScaled(baseStyles);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        square && styles.btnSquare,
        { borderColor: t.line, backgroundColor: pressed ? t.shade : t.surface },
        primary && { borderColor: t.accent, backgroundColor: t.accent, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Text style={[styles.btnText, { color: primary ? t.onAccent : t.ink }, square && styles.btnSquareText, primary && styles.bold]}>{label}</Text>
    </Pressable>
  );
}

function Sheet({ t, visible, onClose, hideClose, children }: { t: Theme; visible: boolean; onClose: () => void; hideClose?: boolean; children: React.ReactNode }) {
  const styles = useScaled(baseStyles);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* The tap-to-close layer sits behind the sheet, so drags inside the sheet can still scroll. */}
        <View style={[styles.backdrop, { backgroundColor: t.backdrop }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
          <View style={[styles.sheet, { backgroundColor: t.surface, borderColor: t.line }]}>
            {children}
            {!hideClose && (
              <Pressable onPress={onClose} style={styles.close} hitSlop={8}>
                <Text style={[styles.closeText, { color: t.muted }]}>×</Text>
              </Pressable>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function whenText(e: CalEvent) {
  if (e.allDay) {
    return +e.sDay === +e.eDay ? `${fmtDay(e.sDay)}・全天` : `${fmtDay(e.sDay)} – ${fmtDay(e.eDay)}・${diff(e.sDay, e.eDay) + 1} 天`;
  }
  if (e.span) return `${fmtDay(e.sDay)} ${hm(e.st)} – ${fmtDay(e.eDay)} ${hm(e.en)}`;
  return `${fmtDay(e.sDay)} ${hm(e.st)}–${hm(e.en)}`;
}

function EventDetail({ t, e, cal, onEdit }: { t: Theme; e: CalEvent; cal?: CalInfo; onEdit: () => void }) {
  const styles = useScaled(baseStyles);
  return (
    <View style={styles.detail}>
      <View style={styles.detailHead}>
        <View style={[styles.swatch, { backgroundColor: cal?.color ?? t.muted }]} />
        <Text style={[styles.detailTitle, { color: t.ink }]}>{e.title}</Text>
      </View>
      <Text style={[styles.detailWhen, { color: t.ink }]}>{whenText(e)}</Text>
      {e.recurring && <Text style={[styles.detailMeta, { color: t.muted }]}>重複行程</Text>}
      {!!e.location && <Text style={[styles.detailMeta, { color: t.muted }]}>地點：{e.location}</Text>}
      {cal && <Text style={[styles.detailMeta, { color: t.muted }]}>日曆：{cal.name}{cal.account ? `（${cal.account}）` : ''}</Text>}
      {!!e.notes && (
        // Long descriptions scroll inside the sheet; the title and the edit button stay in view.
        <ScrollView style={styles.notesScroll}>
          <Text selectable style={[styles.detailMeta, styles.notesText, { color: t.ink }]}>
            {e.notes}
          </Text>
        </ScrollView>
      )}
      {cal?.writable ? (
        <View style={styles.sheetActions}>
          <Btn t={t} label="編輯" onPress={onEdit} primary />
        </View>
      ) : (
        <Text style={[styles.detailMeta, { color: t.muted }]}>這個日曆是唯讀的，無法編輯。</Text>
      )}
    </View>
  );
}

function DayList({
  t,
  day,
  events,
  colors,
  onPick,
  onAdd,
  hasPlan,
  onPlan,
}: {
  t: Theme;
  day: Date;
  events: CalEvent[];
  colors: Record<string, string>;
  onPick: (e: CalEvent) => void;
  onAdd?: () => void;
  hasPlan: boolean;
  onPlan: () => void;
}) {
  const styles = useScaled(baseStyles);
  const list = events
    .filter(e => e.sDay <= day && e.eDay >= day)
    .sort((a, b) => Number(b.span) - Number(a.span) || +a.st - +b.st);
  return (
    <View style={styles.detail}>
      <Text style={[styles.detailTitle, { color: t.ink }]}>{fmtDay(day)}</Text>
      {list.length === 0 && <Text style={[styles.detailMeta, { color: t.muted }]}>這天沒有行程</Text>}
      <ScrollView style={styles.dayScroll}>
        {list.map(e => (
          <Pressable key={e.id} onPress={() => onPick(e)} style={({ pressed }) => [styles.dayItem, pressed && { backgroundColor: t.shade }]}>
            <View style={[styles.dayDot, { backgroundColor: colors[e.cal] ?? t.muted }]} />
            <Text style={[styles.dayTime, { color: t.muted }]}>{e.span ? '全天' : hm(e.st)}</Text>
            <Text numberOfLines={1} style={[styles.dayTitle, { color: t.ink }]}>
              {e.title}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.sheetActions}>
        <Btn t={t} label={hasPlan ? '📝 打開單日規劃' : '📝 單日規劃'} onPress={onPlan} />
        {onAdd && <Btn t={t} label="＋ 在這天新增" onPress={onAdd} primary />}
      </View>
    </View>
  );
}

const baseStyles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: 6, paddingBottom: 8 },
  title: { fontSize: 18, fontWeight: '700', letterSpacing: 0.5 },
  range: { fontSize: 12, fontVariant: ['tabular-nums'] },
  toolRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 8 },
  segment: { flexDirection: 'row', borderRadius: 9, padding: 2 },
  segBtn: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7 },
  segText: { fontSize: 13 },
  bold: { fontWeight: '600' },
  btn: { height: 32, paddingHorizontal: 11, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  btnSquare: { width: 32, paddingHorizontal: 0 },
  btnText: { fontSize: 13 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8 },
  noticeText: { fontSize: 12 },
  noticeLink: { fontSize: 12, fontWeight: '600' },
  noGrow: { flexGrow: 0, flexShrink: 0 },
  wrapRow: { flexWrap: 'wrap' },
  btnSquareText: { fontSize: 17 },
  zoomGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  zoomText: { fontSize: 13, minWidth: 40, textAlign: 'center', fontVariant: ['tabular-nums'] },
  closeText: { fontSize: 20 },
  dayScroll: { maxHeight: 360 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: CHIP_GAP, paddingBottom: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingVertical: 4, paddingLeft: 8, paddingRight: 10 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  chipText: { fontSize: 12, flexShrink: 1 },
  chipAccount: { fontSize: 10, marginLeft: 'auto' },
  gridWrap: { flex: 1, paddingBottom: 8 },
  flex: { flex: 1 },
  sheetActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 10 },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 420, maxHeight: '90%', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 18 },
  close: { position: 'absolute', top: 8, right: 12 },
  detail: { gap: 6, paddingRight: 20, flexShrink: 1 },
  notesScroll: { flexGrow: 0, flexShrink: 1, marginRight: -20 },
  notesText: { paddingRight: 20, lineHeight: 20 },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailTitle: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  detailWhen: { fontSize: 13, fontVariant: ['tabular-nums'] },
  detailMeta: { fontSize: 13 },
  dayItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 6, borderRadius: 6 },
  dayDot: { width: 8, height: 8, borderRadius: 4 },
  dayTime: { fontSize: 12, width: 40, fontVariant: ['tabular-nums'] },
  dayTitle: { fontSize: 14, flexShrink: 1 },
});
