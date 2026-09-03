import { loadLocaleMessages } from "../i18n/messages";

/**
 * Vitest setup for Node 25+ environments where experimental localStorage can
 * shadow jsdom's Storage implementation (clear/setItem become non-functions).
 */
function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.has(key) ? values.get(key)! : null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(String(key), String(value));
    },
  };
}

interface StorageOwner {
  localStorage: Storage;
  sessionStorage: Storage;
}

function installStorage(target: StorageOwner) {
  const storage = createMemoryStorage();
  Object.defineProperty(target, "localStorage", {
    configurable: true,
    enumerable: true,
    value: storage,
    writable: true,
  });
  Object.defineProperty(target, "sessionStorage", {
    configurable: true,
    enumerable: true,
    value: createMemoryStorage(),
    writable: true,
  });
}

installStorage(globalThis);
if (typeof window !== "undefined") {
  installStorage(window);
}

// Locale bundles ship as their own chunks and load on demand at runtime. Warm
// every locale here so a component test that picks `en`/`zh` renders in that
// language on its first pass instead of the Korean fallback.
await Promise.all(
  (["en", "zh"] as const).map((locale) => loadLocaleMessages(locale)),
);
