// Key-value storage on the device (expo-sqlite). null where it isn't available; callers carry on without it.
type Store = {
  getItemSync(k: string): string | null;
  setItemSync(k: string, v: string): void;
  removeItemSync(k: string): boolean;
  getAllKeysSync(): string[];
};

let store: Store | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  store = require('expo-sqlite/kv-store').default;
} catch {
  store = null;
}

export const storage = store;
