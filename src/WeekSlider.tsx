import { useEffect, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Theme } from './theme';
import { useScaled, useZoom } from './zoom';

type Props = {
  t: Theme;
  value: number;
  min: number;
  max: number;
  onChange: (weeks: number) => void;
};

/** Tick marks under the track; tapping one jumps to it. */
const TICKS: [number, string][] = [
  [1, '1週'],
  [5, '1個月'],
  [9, '2個月'],
  [13, '3個月'],
  [26, '半年'],
];

const THUMB = 18;

type SliderRefs = {
  track: ComponentRef<typeof View> | null;
  geo: { pageX: number; width: number };
  last: number;
  onChange: (weeks: number) => void;
};

/** Maps a touch's x position on the track to a week count. */
function createSliderResponder(refs: RefObject<SliderRefs>, min: number, max: number) {
  const at = (pageX: number) => {
    const r = refs.current;
    const f = Math.min(1, Math.max(0, (pageX - r.geo.pageX) / r.geo.width));
    const v = Math.round(min + f * (max - min));
    if (v !== r.last) {
      r.last = v;
      r.onChange(v);
    }
  };
  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: e => {
      const pageX = e.nativeEvent.pageX;
      // Measure at touch time so the slider stays right after the window is resized.
      refs.current.track?.measure((_x: number, _y: number, w: number, _h: number, px: number) => {
        refs.current.geo = { pageX: px, width: Math.max(1, w) };
        at(pageX);
      });
    },
    onPanResponderMove: e => at(e.nativeEvent.pageX),
  });
}

/** Drag a slider, or type an exact number of weeks. */
export function WeekSlider({ t, value, min, max, onChange }: Props) {
  const styles = useScaled(baseStyles);
  const refs = useRef<SliderRefs>({ track: null, geo: { pageX: 0, width: 1 }, last: value, onChange });
  // The responder is created once, so it reads the latest value and callback through refs.
  useEffect(() => {
    refs.current.last = value;
    refs.current.onChange = onChange;
  });
  // The responder only reads the refs inside touch handlers, never while rendering.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() => createSliderResponder(refs, min, max));
  const [width, setWidth] = useState(0);

  const frac = (v: number) => (Math.min(max, Math.max(min, v)) - min) / (max - min);
  const z = useZoom();
  const thumbLeft = (v: number) => frac(v) * Math.max(0, width - THUMB * z);

  // Keep the field in sync when the slider moves, without an effect.
  const [draft, setDraft] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(String(value));
  }
  const commit = () => {
    const n = parseInt(draft, 10);
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
    else setDraft(String(value));
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.sliderCol}>
        <View
          ref={el => {
            refs.current.track = el;
          }}
          style={styles.hit}
          onLayout={e => setWidth(e.nativeEvent.layout.width)}
          {...pan.panHandlers}
        >
          <View style={[styles.rail, { backgroundColor: t.line }]} />
          <View style={[styles.fill, { backgroundColor: t.accent, width: thumbLeft(value) }]} />
          <View style={[styles.thumb, { backgroundColor: t.surface, borderColor: t.accent, left: thumbLeft(value) }]} />
        </View>
        <View style={styles.ticks}>
          {TICKS.map(([w, label]) => (
            <Pressable key={w} onPress={() => onChange(w)} hitSlop={6} style={[styles.tick, { left: thumbLeft(w) + (THUMB * z) / 2 }]}>
              <Text style={[styles.tickText, { color: w === value ? t.accent : t.muted }, w === value && styles.bold]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.custom}>
        <Text style={[styles.customLabel, { color: t.muted }]}>自訂</Text>
        <TextInput
          value={draft}
          onChangeText={s => setDraft(s.replace(/[^0-9]/g, ''))}
          onBlur={commit}
          onSubmitEditing={commit}
          keyboardType="number-pad"
          returnKeyType="done"
          maxLength={2}
          selectTextOnFocus
          style={[styles.input, { color: t.ink, borderColor: t.line, backgroundColor: t.surface }]}
        />
        <Text style={[styles.customLabel, { color: t.muted }]}>週</Text>
      </View>
    </View>
  );
}

const baseStyles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingBottom: 6 },
  sliderCol: { flex: 1, minWidth: 180, maxWidth: 520 },
  hit: { height: 28, justifyContent: 'center' },
  rail: { position: 'absolute', left: THUMB / 2, right: THUMB / 2, height: 4, borderRadius: 2 },
  fill: { position: 'absolute', left: THUMB / 2, height: 4, borderRadius: 2 },
  thumb: { position: 'absolute', width: THUMB, height: THUMB, borderRadius: THUMB / 2, borderWidth: 2 },
  ticks: { height: 16 },
  tick: { position: 'absolute', transform: [{ translateX: -18 }], width: 36, alignItems: 'center' },
  tickText: { fontSize: 11 },
  bold: { fontWeight: '600' },
  custom: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  customLabel: { fontSize: 13 },
  input: {
    width: 48,
    height: 32,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    textAlign: 'center',
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    paddingVertical: 0,
  },
});
