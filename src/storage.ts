// Key-value storage on the device: expo-sqlite in the apps, the browser's localStorage on the web.
// null where it isn't available; callers carry on without it.
import { Platform } from 'react-native';

type Store = {
  getItemSync(k: string): string | null;
  setItemSync(k: string, v: string): void;
  removeItemSync(k: string): boolean;
  getAllKeysSync(): string[];
};

function webStore(): Store | null {
  if (typeof localStorage === 'undefined') return null;
  return {
    getItemSync: k => localStorage.getItem(k),
    setItemSync: (k, v) => localStorage.setItem(k, v),
    removeItemSync: k => {
      localStorage.removeItem(k);
      return true;
    },
    getAllKeysSync: () => Object.keys(localStorage),
  };
}

let store: Store | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  store = Platform.OS === 'web' ? webStore() : require('expo-sqlite/kv-store').default;
} catch {
  store = null;
}

export const storage = store;
