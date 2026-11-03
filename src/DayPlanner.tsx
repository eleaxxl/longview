import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { addDays, dayOnly, fmtDay, hm, pad } from './dates';
import { readPlan, type DayPlan } from './dayPlans';
import type { Theme } from './theme';
import type { CalEvent } from './types';
import { useScaled, useZoom } from './zoom';

type Props = {
  t: Theme;
  day: Date;
  today: Date;
  /** The calendar's events, shown beside the hours for reference. */
  events: CalEvent[];
  colors: Record<string, string>;
  onSave: (day: Date, plan: DayPlan) => void;
  onDay: (day: Date) => void;
  onClose: () => void;
};

/** The planner's hours, widened to take in any event outside them. */
const FIRST_HOUR = 6;
const LAST_HOUR = 23;
const MARKS = ['①', '②', '③'];

/** A whole-day page: the three main things, an hour-by-hour schedule, a to-do list and notes. Kept on this device only. */
export function DayPlanner({ t, day, today, events, colors, onSave, onDay, onClose }: Props) {
  const styles = useScaled(baseStyles);
  const z = useZoom();
  const { width } = useWindowDimensions();
  const wide = width / z >= 760;
  // The page for another day starts from that day's saved plan.
  const [shown, setShown] = useState({ day, plan: readPlan(day) });
  if (+shown.day !== +day) setShown({ day, plan: readPlan(day) });
  const plan = shown.plan;

  const update = (change: (p: DayPlan) => DayPlan) => {
    const next = change(plan);
    setShown({ day, plan: next });
    onSave(day, next);
  };

  const dayEvents = events.filter(e => e.sDay <= day && e.eDay >= day).sort((a, b) => +a.st - +b.st);
  const allDay = dayEvents.filter(e => e.span);
  const timed = dayEvents.filter(e => !e.span);
  const first = Math.min(FIRST_HOUR, ...timed.map(e => e.st.getHours()));
  const last = Math.max(LAST_HOUR, ...timed.map(e => e.st.getHours()));
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const now = new Date();
  const nowHour = +dayOnly(now) === +day ? now.getHours() : -1;

  const input = [styles.input, { color: t.ink }];
  const placeholder = t.muted;

  const top = (
    <Section t={t} title="今日三件要事">
      {MARKS.map((m, i) => (
        <View key={m} style={[styles.line, { borderColor: t.line }]}>
          <Text style={[styles.mark, { color: t.accent }]}>{m}</Text>
          <TextInput
            value={plan.top[i] ?? ''}
            onChangeText={v => update(p => ({ ...p, top: p.top.map((s, j) => (j === i ? v : s)) }))}
            placeholder="最重要的事"
            placeholderTextColor={placeholder}
            style={input}
          />
        </View>
      ))}
    </Section>
  );

  const schedule = (
    <Section t={t} title="時間表">
      {allDay.length > 0 && (
        <View style={[styles.hourRow, { borderColor: t.line }]}>
          <Text style={[styles.hourLabel, { color: t.muted }]}>全天</Text>
          <View style={styles.hourBody}>
            {allDay.map(e => (
              <EventTag key={e.id} t={t} e={e} color={colors[e.cal]} />
            ))}
          </View>
        </View>
      )}
      {hours.map(h => {
        const inHour = timed.filter(e => e.st.getHours() === h);
        return (
          <View key={h} style={[styles.hourRow, { borderColor: t.line }, h === nowHour && { backgroundColor: t.shade }]}>
            <Text style={[styles.hourLabel, { color: h === nowHour ? t.accent : t.muted }]}>{pad(h)}:00</Text>
            <View style={styles.hourBody}>
              {inHour.map(e => (
                <EventTag key={e.id} t={t} e={e} color={colors[e.cal]} />
              ))}
              <TextInput
                value={plan.hours[h] ?? ''}
                onChangeText={v => update(p => ({ ...p, hours: { ...p.hours, [h]: v } }))}
                multiline
                scrollEnabled={false}
                style={[input, styles.hourInput]}
              />
            </View>
          </View>
        );
      })}
    </Section>
  );

  const todos = (
    <Section t={t} title="待辦清單">
      {plan.todos.map(todo => (
        <View key={todo.id} style={[styles.line, { borderColor: t.line }]}>
          <Pressable
            onPress={() => update(p => ({ ...p, todos: p.todos.map(x => (x.id === todo.id ? { ...x, done: !x.done } : x)) }))}
            hitSlop={6}
            style={[styles.check, { borderColor: todo.done ? t.accent : t.lineStrong }, todo.done && { backgroundColor: t.accent }]}
          >
            {todo.done && <Text style={[styles.checkMark, { color: t.onAccent }]}>✓</Text>}
          </Pressable>
          <TextInput
            value={todo.text}
            onChangeText={v => update(p => ({ ...p, todos: p.todos.map(x => (x.id === todo.id ? { ...x, text: v } : x)) }))}
            style={[input, todo.done && { color: t.muted, textDecorationLine: 'line-through' }]}
          />
          <Pressable onPress={() => update(p => ({ ...p, todos: p.todos.filter(x => x.id !== todo.id) }))} hitSlop={6}>
            <Text style={[styles.remove, { color: t.muted }]}>×</Text>
          </Pressable>
        </View>
      ))}
      <NewTodo t={t} onAdd={text => update(p => ({ ...p, todos: [...p.todos, { id: String(Date.now()), text, done: false }] }))} />
    </Section>
  );

  const notes = (
    <Section t={t} title="筆記">
      <TextInput
        value={plan.notes}
        onChangeText={v => update(p => ({ ...p, notes: v }))}
        multiline
        placeholder="想到什麼都可以寫下來"
        placeholderTextColor={placeholder}
        style={[input, styles.notes, { borderColor: t.line }]}
      />
    </Section>
  );

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      {/* A modal is its own window, so it needs its own safe-area measurements. */}
      <SafeAreaProvider>
        <SafeAreaView style={[styles.screen, { backgroundColor: t.bg }]}>
          <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.header}>
              <Text style={[styles.title, styles.flex, { color: +day === +today ? t.accent : t.ink }]} numberOfLines={1}>
                {fmtDay(day)}
              </Text>
              <HeadBtn t={t} label="完成" onPress={onClose} primary />
            </View>
            <View style={styles.header}>
              <HeadBtn t={t} label="‹ 前一天" onPress={() => onDay(addDays(day, -1))} />
              <HeadBtn t={t} label="後一天 ›" onPress={() => onDay(addDays(day, 1))} />
              {+day !== +today && <HeadBtn t={t} label="今天" onPress={() => onDay(today)} />}
            </View>
            <Text style={[styles.hint, { color: t.muted }]}>單日規劃只存在這台裝置上，不會同步到 Google。</Text>

            {wide ? (
              <View style={styles.columns}>
                <ScrollView style={styles.colLeft} contentContainerStyle={styles.colContent} keyboardShouldPersistTaps="handled">
                  {schedule}
                </ScrollView>
                <ScrollView style={styles.colRight} contentContainerStyle={styles.colContent} keyboardShouldPersistTaps="handled">
                  {top}
                  {todos}
                  {notes}
                </ScrollView>
              </View>
            ) : (
              <ScrollView contentContainerStyle={styles.colContent} keyboardShouldPersistTaps="handled">
                {top}
                {schedule}
                {todos}
                {notes}
              </ScrollView>
            )}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

function Section({ t, title, children }: { t: Theme; title: string; children: React.ReactNode }) {
  const styles = useScaled(baseStyles);
  return (
    <View style={[styles.section, { backgroundColor: t.surface, borderColor: t.line }]}>
      <Text style={[styles.sectionTitle, { color: t.ink }]}>{title}</Text>
      {children}
    </View>
  );
}

function EventTag({ t, e, color }: { t: Theme; e: CalEvent; color?: string }) {
  const styles = useScaled(baseStyles);
  return (
    <View style={styles.tag}>
      <View style={[styles.tagDot, { backgroundColor: color ?? t.muted }]} />
      <Text style={[styles.tagText, { color: t.ink }]}>
        {!e.span && (
          <Text style={{ color: t.muted }}>
            {hm(e.st)}–{hm(e.en)}{' '}
          </Text>
        )}
        {e.title}
      </Text>
    </View>
  );
}

function NewTodo({ t, onAdd }: { t: Theme; onAdd: (text: string) => void }) {
  const styles = useScaled(baseStyles);
  const [text, setText] = useState('');
  const add = () => {
    if (!text.trim()) return;
    onAdd(text.trim());
    setText('');
  };
  return (
    <View style={[styles.line, { borderColor: t.line }]}>
      <Text style={[styles.mark, { color: t.accent }]}>＋</Text>
      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={add}
        submitBehavior="submit"
        returnKeyType="done"
        placeholder="新增待辦，按 Enter 加入"
        placeholderTextColor={t.muted}
        style={[styles.input, { color: t.ink }]}
      />
      {!!text.trim() && (
        <Pressable onPress={add} hitSlop={6}>
          <Text style={[styles.addText, { color: t.accent }]}>加入</Text>
        </Pressable>
      )}
    </View>
  );
}

function HeadBtn({ t, label, onPress, primary }: { t: Theme; label: string; onPress: () => void; primary?: boolean }) {
  const styles = useScaled(baseStyles);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        { borderColor: primary ? t.accent : t.line, backgroundColor: primary ? t.accent : pressed ? t.shade : t.surface },
      ]}
    >
      <Text style={[styles.btnText, { color: primary ? t.onAccent : t.ink }]}>{label}</Text>
    </Pressable>
  );
}

const baseStyles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 10 },
  title: { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  hint: { fontSize: 12, paddingHorizontal: 14, paddingTop: 4, paddingBottom: 8 },
  btn: {
    minWidth: 40,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { fontSize: 15, fontWeight: '600' },
  columns: { flex: 1, flexDirection: 'row' },
  colLeft: { flex: 1.15 },
  colRight: { flex: 1 },
  colContent: { padding: 14, paddingTop: 4, gap: 14 },
  section: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 44 },
  mark: { fontSize: 18, width: 22, textAlign: 'center' },
  input: { flex: 1, fontSize: 16, paddingVertical: 8 },
  hourRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 48, borderRadius: 4 },
  hourLabel: { width: 54, fontSize: 14, paddingTop: 12, paddingLeft: 4, fontVariant: ['tabular-nums'] },
  hourBody: { flex: 1, paddingVertical: 4 },
  hourInput: { minHeight: 38, paddingTop: 8 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 6 },
  tagDot: { width: 8, height: 8, borderRadius: 4 },
  tagText: { flexShrink: 1, fontSize: 14 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  checkMark: { fontSize: 14, fontWeight: '700' },
  remove: { fontSize: 22, paddingHorizontal: 4 },
  addText: { fontSize: 15, fontWeight: '600' },
  notes: { minHeight: 180, textAlignVertical: 'top', borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, padding: 10 },
});
