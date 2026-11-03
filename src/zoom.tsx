// Whole-app zoom, like a browser's ⌘+ / ⌘−. Sizes in style sheets are multiplied by the zoom factor.
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { addZoomListener } from '../modules/key-commands';
import type { Density } from './layout';
import { storage } from './storage';

export const ZOOMS = [0.85, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.25, 2.5, 3];
const KEY = 'zoom';


function readZoom(): number {
  try {
    const z = Number(storage?.getItemSync(KEY));
    return ZOOMS.includes(z) ? z : 1;
  } catch {
    return 1;
  }
}

/** The zoom level, its setters, and the ⌘ shortcuts. */
export function useZoomState() {
  const [zoom, setZoomRaw] = useState(readZoom);
  const setZoom = useCallback((z: number) => {
    setZoomRaw(z);
    try {
      storage?.setItemSync(KEY, String(z));
    } catch {
      // Not remembered, but still applied.
    }
  }, []);
  const step = useCallback(
    (dir: number) => {
      if (dir === 0) return setZoom(1);
      const i = ZOOMS.indexOf(zoom);
      setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + dir))]);
    },
    [zoom, setZoom],
  );
  return { zoom, step };
}

export { addZoomListener };

export const ZoomContext = createContext(1);
export const useZoom = () => useContext(ZoomContext);

const SCALED = new Set([
  'fontSize',
  'lineHeight',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'gap',
  'rowGap',
  'columnGap',
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'top',
  'left',
  'right',
  'bottom',
  'letterSpacing',
  'translateX',
  'translateY',
]);
const isScaled = (k: string) => SCALED.has(k) || k.startsWith('padding') || k.startsWith('margin');

function scaleValue(k: string, v: unknown, z: number): unknown {
  if (typeof v === 'number') return isScaled(k) ? v * z : v;
  if (k === 'transform' && Array.isArray(v)) {
    return v.map(o => Object.fromEntries(Object.entries(o).map(([tk, tv]) => [tk, scaleValue(tk, tv, z)])));
  }
  return v;
}

/** A copy of a style sheet with every size multiplied by z. */
export function scaleStyles<T extends Record<string, object>>(styles: T, z: number): T {
  if (z === 1) return styles;
  const out: Record<string, object> = {};
  for (const [name, style] of Object.entries(styles)) {
    out[name] = Object.fromEntries(Object.entries(style).map(([k, v]) => [k, scaleValue(k, v, z)]));
  }
  return out as T;
}

/** The style sheet at the current zoom. */
export function useScaled<T extends Record<string, object>>(styles: T): T {
  const z = useZoom();
  return useMemo(() => scaleStyles(styles, z), [styles, z]);
}

/** Grid sizes for a row height at a zoom: picked as if the row were 1/z as tall, then enlarged. */
export function zoomDensity(d: Density, z: number): Density {
  return { ...d, hh: d.hh * z, lh: d.lh * z, fs: d.fs * z };
}
