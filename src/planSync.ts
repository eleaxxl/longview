// Web only: backs up day plans to a hidden folder in the person's own Google Drive (appDataFolder),
// once they agree. Plans are still saved here first; the backup follows in the background, and
// when two devices changed the same day, the later change wins.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { localEntries, storeEntries, type PlanEntry } from './dayPlans';
import { googleFetch, grantDrive, hasDriveAccess } from './googleCalendar';
import { storage } from './storage';

const FILE = 'dayplans.json';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
/** 'on' or 'off' once the person has chosen; missing until then. */
const SETTING_KEY = 'dayplan-cloud';
/** Wait this long after typing stops before backing up. */
const SAVE_DELAY = 2000;
/** And look for changes from other devices this often. */
const PULL_EVERY = 60_000;

type Remote = { version: 1; days: Record<string, PlanEntry> };

export type CloudStatus = 'ask' | 'off' | 'regrant' | 'syncing' | 'synced' | 'error';

function readSetting(): 'on' | 'off' | null {
  try {
    const v = storage?.getItemSync(SETTING_KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

function writeSetting(v: 'on' | 'off') {
  try {
    storage?.setItemSync(SETTING_KEY, v);
  } catch {}
}

async function findFile(): Promise<string | null> {
  const q = encodeURIComponent(`name='${FILE}'`);
  const res = await googleFetch(`${DRIVE}?spaces=appDataFolder&q=${q}&fields=files(id)`);
  const j = (await res.json()) as { files?: { id: string }[] };
  return j.files?.[0]?.id ?? null;
}

async function upload(id: string | null, data: Remote): Promise<string> {
  const content = JSON.stringify(data);
  if (id) {
    await googleFetch(`${UPLOAD}/${id}?uploadType=media`, { method: 'PATCH', body: content, contentType: 'application/json' });
    return id;
  }
  const b = `longview-${Date.now()}`;
  const meta = JSON.stringify({ name: FILE, parents: ['appDataFolder'] });
  const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${b}--`;
  const res = await googleFetch(`${UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST',
    body,
    contentType: `multipart/related; boundary=${b}`,
  });
  return ((await res.json()) as { id: string }).id;
}

const same = (a: PlanEntry | undefined, b: PlanEntry | undefined) => JSON.stringify(a?.plan ?? null) === JSON.stringify(b?.plan ?? null);

/** Merges this device's plans with the backup, both ways. Returns true when plans here changed. */
async function syncOnce(fileId: { current: string | null }): Promise<boolean> {
  fileId.current ??= await findFile();
  const got = fileId.current ? ((await (await googleFetch(`${DRIVE}/${fileId.current}?alt=media`)).json()) as Partial<Remote>) : null;
  const remote: Remote = { version: 1, days: got?.days ?? {} };
  const local = localEntries();
  const fromRemote: Record<string, PlanEntry> = {};
  let push = false;
  const merged: Remote = { version: 1, days: { ...remote.days } };
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote.days)])) {
    const l = local[k];
    const r = remote.days[k];
    if (r && (!l || r.updated > l.updated)) {
      if (!same(l, r)) fromRemote[k] = r;
    } else if (l && (!r || l.updated > r.updated || !same(l, r))) {
      merged.days[k] = l;
      push = true;
    }
  }
  storeEntries(fromRemote);
  if (push || !fileId.current) fileId.current = await upload(fileId.current, merged);
  return Object.keys(fromRemote).length > 0;
}

/**
 * The backup's state and controls. active: signed in to Google on the web. onPulled runs when
 * plans arrived from another device.
 */
export function usePlanSync(active: boolean, onPulled: () => void) {
  const [chosen, setSetting] = useState(readSetting);
  const [state, setState] = useState<'idle' | 'syncing' | 'error'>('idle');
  const [confirmed, setConfirmed] = useState(false);
  const fileId = useRef<string | null>(null);
  const running = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Agreed already on another device: the sign-in carries the permission.
  const granted = active && hasDriveAccess();
  const setting = chosen ?? (granted ? 'on' : null);
  useEffect(() => {
    if (granted && chosen === null) writeSetting('on');
  }, [granted, chosen]);

  const on = active && setting === 'on' && granted;

  const sync = useCallback(async () => {
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    setState('syncing');
    try {
      do {
        again.current = false;
        if (await syncOnce(fileId)) onPulled();
      } while (again.current);
      setState('idle');
      setConfirmed(true);
    } catch {
      setState('error');
    } finally {
      running.current = false;
    }
  }, [onPulled]);

  useEffect(() => {
    if (!on) return;
    const first = setTimeout(sync, 0);
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') sync();
    });
    const iv = setInterval(() => {
      if (AppState.currentState === 'active') sync();
    }, PULL_EVERY);
    return () => {
      clearTimeout(first);
      sub.remove();
      clearInterval(iv);
    };
  }, [on, sync]);

  /** Call after every local save. */
  const changed = useCallback(() => {
    if (!on) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(sync, SAVE_DELAY);
  }, [on, sync]);

  /** Asks Google for the folder, then backs up what's here. Call it from a click. */
  const enable = useCallback(async () => {
    // A renewal already in flight can answer instead, without the folder.
    if (!(await grantDrive()) || !hasDriveAccess()) return;
    writeSetting('on');
    setSetting('on');
  }, []);

  const decline = useCallback(() => {
    writeSetting('off');
    setSetting('off');
  }, []);

  /** Turns the backup off, and deletes the copy in Drive when asked to. */
  const disable = useCallback(async (deleteBackup: boolean) => {
    if (deleteBackup) {
      const id = fileId.current ?? (await findFile());
      if (id) await googleFetch(`${DRIVE}/${id}`, { method: 'DELETE' });
      fileId.current = null;
    }
    writeSetting('off');
    setSetting('off');
    setConfirmed(false);
  }, []);

  const status: CloudStatus =
    setting === null
      ? 'ask'
      : setting === 'off'
        ? 'off'
        : !granted
          ? 'regrant'
          : state === 'error'
            ? 'error'
            : state === 'syncing' || !confirmed
              ? 'syncing'
              : 'synced';

  return { status: active ? status : null, changed, enable, decline, disable, retry: sync };
}

export type PlanSync = ReturnType<typeof usePlanSync>;
