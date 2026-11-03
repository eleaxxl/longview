import { useRef, useState, type ComponentRef, type RefObject } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';

import { addDays, diff } from './dates';
import type { Theme } from './theme';
import { useScaled, useZoom } from './zoom';

type Props = {
  t: Theme;
  /** First week of the scrollable span, and how many weeks it holds. */
  anchor: Date;
  total: number;
  weeks: number;
  rowH: number;
  today: Date;
  /** The list's scroll offset, for moving the thumb without re-rendering. */
  scrollY: Animated.Value;
  /** The same offset, readable from touch handlers. */
  offset: RefObject<number>;
  onSeek: (offset: number) => void;
};

export const SCROLLBAR_W = 34;
const MIN_THUMB = 28;

type BarRefs = {
  track: ComponentRef<typeof View> | null;
  geo: { pageY: number; height: number };
  grab: number;
  /** Track geometry from the latest render. */
  thumbH: number;
  maxTop: number;
  maxOffset: number;
  offset: RefObject<number>;
  onSeek: (offset: number) => void;
};

/** Drag the thumb, or press anywhere on the track to jump there. */
function createBarResponder(refs: RefObject<BarRefs>) {
  const seek = (pageY: number) => {
    const r = refs.current;
    const top = Math.min(r.maxTop, Math.max(0, pageY - r.geo.pageY - r.grab));
    r.onSeek(r.maxTop ? (top / r.maxTop) * r.maxOffset : 0);
  };
  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: e => {
      const pageY = e.nativeEvent.pageY;
      // Measure at touch time so it stays right after the window is resized.
      refs.current.track?.measure((_x: number, _y: number, _w: number, h: number, _px: number, py: number) => {
        const r = refs.current;
        r.geo = { pageY: py, height: h };
        const thumbTop = r.maxOffset ? (r.offset.current / r.maxOffset) * r.maxTop : 0;
        const rel = pageY - py;
        // Holding the thumb keeps it under the pointer; elsewhere on the track centres it there.
        r.grab = rel >= thumbTop && rel <= thumbTop + r.thumbH ? rel - thumbTop : r.thumbH / 2;
        seek(pageY);
      });
    },
    onPanResponderMove: e => seek(e.nativeEvent.pageY),
  });
}

/** A scrollbar for the week list, marked with months and years so it's easy to find a place. */
export function WeekScrollbar({ t, anchor, total, weeks, rowH, today, scrollY, offset, onSeek }: Props) {
  const styles = useScaled(baseStyles);
  const z = useZoom();
  const [trackH, setTrackH] = useState(0);
  const span = Math.max(1, total - weeks);
  const thumbH = Math.min(trackH, Math.max(MIN_THUMB * z, (weeks / total) * trackH));
  const maxTop = Math.max(0, trackH - thumbH);
  const maxOffset = span * rowH;

  const refs = useRef<BarRefs>({
    track: null,
    geo: { pageY: 0, height: 1 },
    grab: 0,
    thumbH,
    maxTop,
    maxOffset,
    offset,
    onSeek,
  });
  // eslint-disable-next-line react-hooks/refs -- the handlers read these only during touches
  Object.assign(refs.current, { thumbH, maxTop, maxOffset, offset, onSeek });
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() => createBarResponder(refs));

  // Where the thumb's top sits when week i is at the top of the view.
  const at = (i: number) => (Math.min(span, Math.max(0, i)) / span) * maxTop;

  const marks: { y: number; month: number; year: number }[] = [];
  const end = addDays(anchor, total * 7);
  for (let d = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1); d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    marks.push({
      y: at(diff(anchor, d) / 7),
      month: d.getMonth(),
      year: d.getFullYear(),
    });
  }
  const todayY = at(diff(anchor, today) / 7);

  const thumbTop = maxOffset
    ? scrollY.interpolate({
        inputRange: [0, maxOffset],
        outputRange: [0, maxTop],
        extrapolate: 'clamp',
      })
    : 0;

  return (
    <View
      ref={el => {
        refs.current.track = el;
      }}
      style={[styles.track, { borderColor: t.line }]}
      onLayout={e => setTrackH(e.nativeEvent.layout.height)}
      {...pan.panHandlers}
    >
      {trackH > 0 && (
        <>
          {marks.map(m => (
            <View key={`${m.year}-${m.month}`} pointerEvents="none" style={[styles.mark, { top: m.y }]}>
              <View style={[m.month === 0 ? styles.tickYear : styles.tick, { backgroundColor: m.month === 0 ? t.lineStrong : t.line }]} />
              {m.month === 0 && <Text style={[styles.year, { color: t.muted }]}>{m.year}</Text>}
            </View>
          ))}
          <View pointerEvents="none" style={[styles.today, { top: todayY - 1, backgroundColor: t.accent }]} />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.thumb,
              {
                height: thumbH,
                borderColor: t.accent,
                transform: [{ translateY: thumbTop }],
              },
            ]}
          >
            <View style={[StyleSheet.absoluteFill, styles.thumbFill, { backgroundColor: t.accent }]} />
          </Animated.View>
        </>
      )}
    </View>
  );
}

const baseStyles = StyleSheet.create({
  track: { width: SCROLLBAR_W, borderLeftWidth: StyleSheet.hairlineWidth },
  mark: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    height: 1,
  },
  tick: { width: 6, height: StyleSheet.hairlineWidth, marginLeft: 3 },
  tickYear: { width: 10, height: 1.5, marginLeft: 1 },
  year: {
    position: 'absolute',
    left: 3,
    top: 2,
    fontSize: 8,
    fontVariant: ['tabular-nums'],
  },
  today: {
    position: 'absolute',
    left: 0,
    width: 8,
    height: 2,
    borderRadius: 1,
  },
  thumb: {
    position: 'absolute',
    left: 3,
    right: 3,
    borderWidth: 1.5,
    borderRadius: 5,
    overflow: 'hidden',
  },
  thumbFill: { opacity: 0.18 },
});
