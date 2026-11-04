import { Platform } from 'react-native';
import { NativeModule, requireOptionalNativeModule } from 'expo';

type Events = {
  /** step: 1 = zoom in, -1 = zoom out, 0 = actual size. */
  onZoom: (e: { step: number }) => void;
};

declare class KeyCommandsModule extends NativeModule<Events> {
  enable(): Promise<void>;
}

const native = Platform.OS === 'ios' ? requireOptionalNativeModule<KeyCommandsModule>('KeyCommands') : null;

/** Wheel distance per zoom step, as on the Mac. */
const WHEEL_STEP = 40;

/** In the browser: ⌘/Ctrl with + − 0 or the wheel (a trackpad pinch arrives as one too) zooms the calendar, not the page. */
function addWebZoomListener(listener: (step: number) => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const step = e.key === '=' || e.key === '+' ? 1 : e.key === '-' ? -1 : e.key === '0' ? 0 : null;
    if (step === null) return;
    e.preventDefault();
    listener(step);
  };
  let wheel = 0;
  const onWheel = (e: WheelEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    // Wheel up or pinch out zooms in.
    wheel -= e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    // One step per event: steps taken together would all start from the same zoom.
    if (Math.abs(wheel) < WHEEL_STEP) return;
    listener(wheel > 0 ? 1 : -1);
    wheel = 0;
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('wheel', onWheel);
  };
}

/** Listens for ⌘+ / ⌘− / ⌘0. Does nothing where the native module isn't available. */
export function addZoomListener(listener: (step: number) => void): () => void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return addWebZoomListener(listener);
  if (!native) return () => {};
  native.enable().catch(() => {});
  const sub = native.addListener('onZoom', e => listener(e.step));
  return () => sub.remove();
}
