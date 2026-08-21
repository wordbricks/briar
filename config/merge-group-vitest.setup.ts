/**
 * Trusted Vitest setup for Node runtimes where experimental localStorage can
 * shadow jsdom's Storage implementation.
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
    getItem(key) {
      return values.has(key) ? values.get(key)! : null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
  };
}

function installStorage(target: object) {
  Object.defineProperty(target, "localStorage", {
    configurable: true,
    enumerable: true,
    value: createMemoryStorage(),
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
if (typeof window !== "undefined") installStorage(window);
