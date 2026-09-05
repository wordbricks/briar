import { join } from "node:path";
import { expect, it } from "vitest";
import type {
  ComputerUseBrowserLoginStoreReport,
  ComputerUseLiveBrowserLoginCapture,
  ComputerUseLiveLoginCaptureOptions,
} from "./computer-use-browser-login-store";
import {
  ComputerUsePrimaryLoginWatcher,
  type ComputerUseLoginWatchListener,
} from "./computer-use-primary-login-watcher";

const emptyReport = (): ComputerUseBrowserLoginStoreReport => ({
  merged: [],
  replaced: [],
  copied: [],
  skipped: [],
});

class RecordingCapture implements ComputerUseLiveBrowserLoginCapture {
  readonly calls: { source: string; sqliteOnly: boolean }[] = [];
  async captureLive(
    sourceDirectory: string,
    options: ComputerUseLiveLoginCaptureOptions,
  ): Promise<ComputerUseBrowserLoginStoreReport> {
    this.calls.push({ source: sourceDirectory, sqliteOnly: options.sqliteOnly });
    return emptyReport();
  }
}

interface ScheduledCall {
  readonly delayMs: number;
  readonly callback: () => void;
  cancelled: boolean;
  fired: boolean;
}

class FakeClock {
  readonly scheduled: ScheduledCall[] = [];
  readonly schedule = (callback: () => void, delayMs: number) => {
    const entry: ScheduledCall = { delayMs, callback, cancelled: false, fired: false };
    this.scheduled.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };

  pending(delayMs: number): ScheduledCall[] {
    return this.scheduled.filter(
      (entry) => entry.delayMs === delayMs && !entry.cancelled && !entry.fired,
    );
  }

  fire(delayMs: number): boolean {
    const entry = this.pending(delayMs).at(-1);
    if (entry === undefined) return false;
    entry.fired = true;
    entry.callback();
    return true;
  }
}

class FakeWatchers {
  readonly missing = new Set<string>();
  readonly armed = new Map<string, ComputerUseLoginWatchListener>();
  readonly closed: string[] = [];
  readonly watch = (path: string, listener: ComputerUseLoginWatchListener) => {
    if (this.missing.has(path)) throw new Error(`ENOENT: ${path}`);
    this.armed.set(path, listener);
    return {
      close: () => {
        this.armed.delete(path);
        this.closed.push(path);
      },
    };
  };

  emit(path: string, filename: string | null): void {
    this.armed.get(path)?.(filename);
  }
}

const profiles = "/profiles";
const source = join(profiles, "display-1");
const networkDirectory = join(source, "Default/Network");
const defaultDirectory = join(source, "Default");

const makeWatcher = (missing: readonly string[] = []) => {
  const store = new RecordingCapture();
  const clock = new FakeClock();
  const watchers = new FakeWatchers();
  for (const path of missing) watchers.missing.add(path);
  const watcher = new ComputerUsePrimaryLoginWatcher({
    store,
    profilesDirectory: profiles,
    watch: watchers.watch,
    schedule: clock.schedule,
    log: () => {},
  });
  return { store, clock, watchers, watcher };
};

it("collapses a burst of cookie writes into one sqlite-only capture", async () => {
  const { store, clock, watchers, watcher } = makeWatcher();
  watcher.start();
  await watcher.idle();

  expect(store.calls).toEqual([{ source, sqliteOnly: false }]);
  expect([...watchers.armed.keys()]).toEqual([networkDirectory, defaultDirectory]);

  watchers.emit(networkDirectory, "Cookies");
  watchers.emit(networkDirectory, "Cookies-journal");
  watchers.emit(defaultDirectory, "Login Data");
  expect(clock.pending(5_000)).toHaveLength(1);

  expect(clock.fire(5_000)).toBe(true);
  await watcher.idle();

  expect(store.calls).toEqual([
    { source, sqliteOnly: false },
    { source, sqliteOnly: true },
  ]);
  watcher.stop();
});

it("ignores files that are not login state", async () => {
  const { store, clock, watchers, watcher } = makeWatcher();
  watcher.start();
  await watcher.idle();
  store.calls.length = 0;

  watchers.emit(networkDirectory, "History-journal");
  watchers.emit(defaultDirectory, "Preferences");
  watchers.emit(defaultDirectory, null);

  expect(clock.pending(5_000)).toHaveLength(0);
  await watcher.idle();
  expect(store.calls).toEqual([]);
  watcher.stop();
});

it("re-arms once Chrome creates the profile directories", async () => {
  const { clock, watchers, watcher } = makeWatcher([networkDirectory, defaultDirectory]);
  watcher.start();
  await watcher.idle();

  expect([...watchers.armed.keys()]).toEqual([]);
  expect(clock.pending(30_000)).toHaveLength(1);

  watchers.missing.clear();
  expect(clock.fire(30_000)).toBe(true);

  expect([...watchers.armed.keys()]).toEqual([networkDirectory, defaultDirectory]);
  expect(clock.pending(30_000)).toHaveLength(0);
  watcher.stop();
});

it("runs the periodic cycle with the directory entries and reschedules itself", async () => {
  const { store, clock, watcher } = makeWatcher();
  watcher.start();
  await watcher.idle();
  store.calls.length = 0;

  expect(clock.fire(600_000)).toBe(true);
  await watcher.idle();

  expect(store.calls).toEqual([{ source, sqliteOnly: false }]);
  expect(clock.pending(600_000)).toHaveLength(1);
  watcher.stop();
});

it("captures nothing once it is stopped", async () => {
  const { store, clock, watchers, watcher } = makeWatcher();
  watcher.start();
  await watcher.idle();
  watchers.emit(networkDirectory, "Cookies");
  store.calls.length = 0;

  watcher.stop();

  expect(watchers.closed).toEqual([networkDirectory, defaultDirectory]);
  expect(clock.scheduled.every((entry) => entry.cancelled || entry.fired)).toBe(true);
  expect(clock.fire(5_000)).toBe(false);
  expect(clock.fire(600_000)).toBe(false);
  watchers.emit(networkDirectory, "Cookies");
  await watcher.idle();

  expect(store.calls).toEqual([]);
});
