/**
 * Vitest setup for Node 25+ environments where experimental localStorage can
 * shadow jsdom's Storage implementation (clear/setItem become non-functions).
 */
import { vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class<Environment> {
    protected env: Environment;
    protected ctx: unknown;

    constructor(ctx: unknown, env: Environment) {
      this.ctx = ctx;
      this.env = env;
    }
  },
  WorkflowEntrypoint: class<Environment> {
    protected env: Environment;
    protected ctx: unknown;

    constructor(ctx: unknown, env: Environment) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

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

function installStorage(target: object) {
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
