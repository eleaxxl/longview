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

/** Listens for ⌘+ / ⌘− / ⌘0. Does nothing where the native module isn't available. */
export function addZoomListener(listener: (step: number) => void): () => void {
  if (!native) return () => {};
  native.enable().catch(() => {});
  const sub = native.addListener('onZoom', e => listener(e.step));
  return () => sub.remove();
}
