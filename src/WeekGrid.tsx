import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { DOW, addDays, diff, hm, isoWeek, key, pad } from './dates';
import { density, layoutWeek, type Density } from './layout';
import type { Theme } from './theme';
import type { CalEvent } from './types';
import { SCROLLBAR_W, WeekScrollbar } from './WeekScrollbar';
import { useScaled, useZoom, zoomDensity } from './zoom';

type Props = {
  start: Date;
  weeks: number;
  wso: number;
  today: Date;
  events: CalEvent[];
  colors: Record<string, string>;
  theme: Theme;
  onEvent: (e: CalEvent) => void;
  onDay: (d: Date) => void;
  /** Scrolling brought a different week to the top. */
  onStart: (start: Date) => void;
  /** Days with a day plan, as date keys, and opening one. */
  planned: Set<string>;
  onPlan: (d: Date) => void;
};

const GUT = 32;
const pct = (n: number) => `${(n * 100) / 7}%` as const;

/** Weeks reachable by scrolling: two years back, three ahead. Moving past either end re-centres the span. */
const BEFORE = 104;
const TOTAL = 260;

type RowProps = {
  /** The week's first day, as a timestamp so memo can compare it. */
  wsTime: number;
  events: CalEvent[];
  colors: Record<string, string>;
  t: Theme;
  dens: Density;
  rowH: number;
  today: Date;
  onEvent: (e: CalEvent) => void;
  onDay: (d: Date) => void;
  planned: Set<string>;
  onPlan: (d: Date) => void;
};

const WeekRow = memo(function WeekRow({ wsTime, events, colors, t, dens, rowH, today, onEvent, onDay, planned, onPlan }: RowProps) {
  const styles = useScaled(baseStyles);
  const z = useZoom();
  const ws = new Date(wsTime);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const firstIdx = days.findIndex(d => d.getDate() === 1);
  const mDay = firstIdx >= 0 ? days[firstIdx] : null;
  const lay = layoutWeek(ws, events, dens, rowH);

  return (
    <View style={[styles.week, { height: rowH, borderColor: firstIdx === 0 ? t.lineStrong : t.line }]}>
      <View style={[styles.gut, { borderColor: t.line }]}>
        {mDay && <Text style={[styles.gutMonth, { color: t.ink }]}>{mDay.getMonth() + 1}月</Text>}
        {mDay && mDay.getMonth() === 0 && rowH >= 30 && <Text style={[styles.gutSmall, { color: t.muted }]}>{mDay.getFullYear()}</Text>}
        {(rowH >= 46 || !mDay) && <Text style={[styles.gutSmall, { color: t.muted }]}>W{pad(isoWeek(days[3]))}</Text>}
      </View>

      <View style={styles.days}>
        <View style={[StyleSheet.absoluteFill, styles.row]}>
          {days.map((d, i) => {
            const isToday = +d === +today;
            const bg = d.getMonth() % 2 === 1 ? t.shade : d.getDay() === 0 || d.getDay() === 6 ? t.weekend : t.surface;
            const showCnt = !dens.timed && lay.timedCount[i] > 0 && dens.name !== 'micro';
            return (
              <Pressable
                key={i}
                onPress={() => onDay(d)}
                style={[
                  styles.day,
                  { backgroundColor: bg, borderColor: t.line },
                  i === 6 && { borderRightWidth: 0 },
                  d.getDate() === 1 && {
                    borderLeftWidth: 2,
                    borderLeftColor: t.lineStrong,
                  },
                ]}
              >
                <View style={[styles.dh, { height: dens.hh }]}>
                  <View style={[styles.dn, isToday && { backgroundColor: t.accent }]}>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.dnText,
                        {
                          color: isToday ? t.onAccent : d < today ? t.muted : t.ink,
                        },
                        dens.name === 'micro' && styles.dnMicro,
                      ]}
                    >
                      {d.getDate() === 1 && dens.name !== 'micro' ? `${d.getMonth() + 1}/1` : d.getDate()}
                    </Text>
                  </View>
                  {planned.has(key(d)) &&
                    (dens.name === 'micro' ? (
                      <View style={[styles.planDot, { backgroundColor: t.accent }]} />
                    ) : (
                      <Pressable onPress={() => onPlan(d)} hitSlop={4} style={[styles.plan, { borderColor: t.accent }]}>
                        <Text numberOfLines={1} style={[styles.planText, { color: t.accent }]}>
                          單日規劃
                        </Text>
                      </Pressable>
                    ))}
                  {showCnt && <Text style={[styles.cnt, { color: t.muted }]}>·{lay.timedCount[i]}</Text>}
                </View>
              </Pressable>
            );
          })}
        </View>

        {lay.pieces.map(p => {
          const e = p.e;
          const color = colors[e.cal] ?? t.muted;
          const cl = e.span && e.sDay < addDays(ws, p.a);
          const cr = e.span && e.eDay > addDays(ws, p.b);
          return (
            <Pressable
              key={`${e.id}-${p.a}`}
              onPress={() => onEvent(e)}
              style={[
                styles.piece,
                {
                  left: pct(p.a),
                  width: pct(p.b - p.a + 1),
                  top: dens.hh + p.lane * dens.lh,
                  height: dens.lh * p.h,
                },
              ]}
            >
              <View
                style={[
                  styles.pieceInner,
                  p.h > 1 && styles.pieceWrap,
                  e.span && { backgroundColor: color, borderRadius: 3 },
                  cl && { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
                  cr && { borderTopRightRadius: 0, borderBottomRightRadius: 0 },
                ]}
              >
                {!e.span && <View style={[styles.dot, { backgroundColor: color }, p.h > 1 && { marginTop: (dens.fs + 3 - 5 * z) / 2 }]} />}
                {dens.fs > 0 && (
                  <Text
                    numberOfLines={p.h}
                    style={[
                      styles.evText,
                      {
                        fontSize: dens.fs,
                        lineHeight: dens.fs + 3,
                        color: e.span ? '#ffffff' : t.ink,
                      },
                      e.span && styles.evSpanText,
                    ]}
                  >
                    {!e.span && dens.timed === 'time' && <Text style={{ color: t.muted }}>{hm(e.st)} </Text>}
                    {e.title}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        })}

        {dens.fs > 0 &&
          lay.hiddenCount.map((n, i) =>
            n > 0 && lay.maxLanes > 0 ? (
              <Pressable
                key={`more-${i}`}
                onPress={() => onDay(days[i])}
                style={[
                  styles.piece,
                  {
                    left: pct(i),
                    width: pct(1),
                    top: dens.hh + lay.limit[i] * dens.lh,
                    height: dens.lh,
                  },
                ]}
              >
                <Text numberOfLines={1} style={[styles.more, { fontSize: dens.fs, color: t.muted }]}>
                  +{n}
                </Text>
              </Pressable>
            ) : null,
          )}
      </View>
    </View>
  );
});

/**
 * The weeks scroll freely (mouse wheel, trackpad, touch, or the scrollbar on the right) over a fixed span.
 * The week at the top is reported back as `start`; a `start` changed elsewhere scrolls the list to it.
 */
export function WeekGrid({ start, weeks, wso, today, events, colors, theme: t, onEvent, onDay, onStart, planned, onPlan }: Props) {
  const styles = useScaled(baseStyles);
  const [height, setHeight] = useState(0);
  const rowH = height / weeks;
  const z = useZoom();
  const dens = useMemo(() => zoomDensity(density(rowH / z), z), [rowH, z]);
  const dowCols = Array.from({ length: 7 }, (_, i) => (i + wso) % 7);

  const [anchor, setAnchor] = useState(() => addDays(start, -BEFORE * 7));
  const gap = diff(anchor, start);
  const idx = gap / 7;
  // Re-centre when start leaves the span or no longer lines up with it (the week start day changed).
  if (gap % 7 !== 0 || idx < 0 || idx > TOTAL - weeks) setAnchor(addDays(start, -BEFORE * 7));

  const list = useRef<FlatList<number>>(null);
  const [scrollY] = useState(() => new Animated.Value(0));
  const offset = useRef(0);
  const shown = useRef({ idx: -1, rowH: 0, anchor });
  // While the list jumps to a new place, scroll events from before the jump are stale.
  const jumping = useRef<number | null>(null);

  // Follow start when it changed outside the list (今天, ‹ ›, a new view length or window size).
  useLayoutEffect(() => {
    const s = shown.current;
    if (!rowH || (s.idx === idx && s.rowH === rowH && s.anchor === anchor)) return;
    shown.current = { idx, rowH, anchor };
    const target = idx * rowH;
    jumping.current = target;
    offset.current = target;
    scrollY.setValue(target);
    list.current?.scrollToOffset({ offset: target, animated: false });
    // Stop waiting in case the jump fires no scroll event of its own.
    const done = setTimeout(() => {
      jumping.current = null;
    }, 150);
    return () => clearTimeout(done);
  }, [idx, rowH, anchor, scrollY]);

  // Track the offset and report the top week.
  const report = (y: number) => {
    if (!rowH) return;
    if (jumping.current !== null) {
      if (Math.abs(y - jumping.current) > 1) return;
      jumping.current = null;
    }
    scrollY.setValue(y);
    offset.current = y;
    const top = Math.min(TOTAL - weeks, Math.max(0, Math.round(y / rowH)));
    if (top !== shown.current.idx) {
      shown.current = { idx: top, rowH, anchor };
      onStart(addDays(anchor, top * 7));
    }
  };
  const lastSeek = useRef(0);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // While the scrollbar is dragged it reports positions itself; the list's own events lag behind.
    if (Date.now() - lastSeek.current < 250) return;
    report(e.nativeEvent.contentOffset.y);
  };
  // Jumps from the scrollbar don't always fire onScroll, so they report themselves.
  const seek = (y: number) => {
    lastSeek.current = Date.now();
    jumping.current = null;
    list.current?.scrollToOffset({ offset: y, animated: false });
    report(y);
  };

  const rows = Array.from({ length: TOTAL }, (_, i) => i);

  return (
    <View style={[styles.board, { backgroundColor: t.surface, borderColor: t.line }]}>
      <View style={[styles.dow, { borderColor: t.line }]}>
        <View style={{ width: GUT * z }} />
        {dowCols.map(d => (
          <Text key={d} style={[styles.dowText, { color: d === 0 || d === 6 ? t.holiday : t.muted }]}>
            {DOW[d]}
          </Text>
        ))}
        <View style={{ width: SCROLLBAR_W * z }} />
      </View>

      <View style={styles.body}>
        <View style={styles.weeks} onLayout={e => setHeight(e.nativeEvent.layout.height)}>
          {height > 0 && (
            <FlatList
              ref={list}
              data={rows}
              keyExtractor={i => String(+addDays(anchor, i * 7))}
              extraData={[events, colors, t, rowH, planned]}
              getItemLayout={(_, i) => ({
                length: rowH,
                offset: rowH * i,
                index: i,
              })}
              initialScrollIndex={Math.max(0, idx)}
              initialNumToRender={weeks + 2}
              windowSize={5}
              maxToRenderPerBatch={weeks + 2}
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={onScroll}
              onScrollEndDrag={onScroll}
              onMomentumScrollEnd={onScroll}
              renderItem={({ item }) => (
                <WeekRow
                  wsTime={+addDays(anchor, item * 7)}
                  events={events}
                  colors={colors}
                  t={t}
                  dens={dens}
                  rowH={rowH}
                  today={today}
                  onEvent={onEvent}
                  onDay={onDay}
                  planned={planned}
                  onPlan={onPlan}
                />
              )}
            />
          )}
        </View>
        {height > 0 && (
          <WeekScrollbar
            t={t}
            anchor={anchor}
            total={TOTAL}
            weeks={weeks}
            rowH={rowH}
            today={today}
            scrollY={scrollY}
            offset={offset}
            onSeek={seek}
          />
        )}
      </View>
    </View>
  );
}

const baseStyles = StyleSheet.create({
  board: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: 'hidden',
  },
  dow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 5,
  },
  dowText: { flex: 1, fontSize: 11, paddingLeft: 6, letterSpacing: 1 },
  body: { flex: 1, flexDirection: 'row' },
  weeks: { flex: 1, overflow: 'hidden' },
  week: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  gut: {
    width: GUT,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingTop: 3,
    paddingLeft: 4,
    overflow: 'hidden',
  },
  gutMonth: { fontSize: 11, fontWeight: '700' },
  gutSmall: { fontSize: 9, fontVariant: ['tabular-nums'] },
  days: { flex: 1, overflow: 'hidden' },
  row: { flexDirection: 'row' },
  day: { flex: 1, borderRightWidth: StyleSheet.hairlineWidth },
  dh: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
    paddingTop: 1,
  },
  dn: { borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1 },
  dnText: { fontSize: 11, fontVariant: ['tabular-nums'] },
  dnMicro: { fontSize: 8, lineHeight: 10 },
  plan: { flexShrink: 1, marginLeft: 3, borderWidth: 1, borderRadius: 4, paddingHorizontal: 3 },
  planText: { fontSize: 9, fontWeight: '600' },
  planDot: { width: 4, height: 4, borderRadius: 2, marginLeft: 2 },
  cnt: { fontSize: 9, marginLeft: 'auto', fontVariant: ['tabular-nums'] },
  piece: { position: 'absolute', paddingHorizontal: 1.5, paddingBottom: 1.5 },
  pieceInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 3,
    overflow: 'hidden',
  },
  pieceWrap: { alignItems: 'flex-start', paddingTop: 1 },
  dot: { width: 5, height: 5, borderRadius: 3, marginRight: 3 },
  evText: { flexShrink: 1 },
  evSpanText: { fontWeight: '600' },
  more: { paddingHorizontal: 3 },
});
