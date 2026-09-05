import { watch } from "node:fs";
import { basename, join } from "node:path";
import {
  type ComputerUseLiveBrowserLoginCapture,
  computerUsePrimaryBrowserProfileDirectory,
  computerUseSharedLoginSqliteEntries,
} from "./computer-use-browser-login-store";

/** Cancels a pending callback; scheduling is injected so tests can drive it. */
export type ComputerUseLoginWatchCancel = () => void;

export interface ComputerUseLoginWatchHandle {
  close(): void;
}

export type ComputerUseLoginWatchListener = (filename: string | null) => void;

export interface ComputerUsePrimaryLoginWatcherOptions {
  readonly store: ComputerUseLiveBrowserLoginCapture;
  readonly profilesDirectory?: string;
  /** Collapse a burst of Chrome writes into one capture. */
  readonly debounceMs?: number;
  /** Retry arming while Chrome has not created the profile yet. */
  readonly rearmIntervalMs?: number;
  /** Backstop cycle that also takes the directory entries. */
  readonly periodicIntervalMs?: number;
  readonly watch?: (
    path: string,
    listener: ComputerUseLoginWatchListener,
  ) => ComputerUseLoginWatchHandle;
  readonly schedule?: (
    callback: () => void,
    delayMs: number,
  ) => ComputerUseLoginWatchCancel;
  readonly log?: (message: string) => void;
}

/** Chrome writes `Cookies-journal`, `Cookies-wal`, and friends beside the DB. */
const watchedBasenames = [
  ...new Set(computerUseSharedLoginSqliteEntries.map((entry) => basename(entry))),
];

const defaultWatch = (
  path: string,
  listener: ComputerUseLoginWatchListener,
): ComputerUseLoginWatchHandle => {
  const watcher = watch(path, { persistent: false }, (_event, filename) => {
    listener(typeof filename === "string" ? filename : null);
  });
  // A watcher on a directory Chrome later replaces must not take the service
  // down; the periodic cycle is the backstop.
  watcher.on("error", () => watcher.close());
  return watcher;
};

const defaultSchedule = (
  callback: () => void,
  delayMs: number,
): ComputerUseLoginWatchCancel => {
  const timer = setTimeout(callback, delayMs);
  timer.unref();
  return () => clearTimeout(timer);
};

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Watch the owner's display `:1` profile and fold its sign-ins into the shared
 * login store. The owner's Chrome is never stopped, so there is no capture
 * hook the way a released Agent display has one: file events drive a debounced
 * SQLite-only capture, and a slower cycle takes everything as a backstop.
 */
export class ComputerUsePrimaryLoginWatcher {
  private readonly store: ComputerUseLiveBrowserLoginCapture;
  private readonly sourceDirectory: string;
  private readonly watchedDirectories: readonly string[];
  private readonly debounceMs: number;
  private readonly rearmIntervalMs: number;
  private readonly periodicIntervalMs: number;
  private readonly watch: (
    path: string,
    listener: ComputerUseLoginWatchListener,
  ) => ComputerUseLoginWatchHandle;
  private readonly schedule: (
    callback: () => void,
    delayMs: number,
  ) => ComputerUseLoginWatchCancel;
  private readonly log: (message: string) => void;
  private readonly handles = new Map<string, ComputerUseLoginWatchHandle>();
  private running = false;
  private cancelDebounce: ComputerUseLoginWatchCancel | undefined;
  private cancelRearm: ComputerUseLoginWatchCancel | undefined;
  private cancelPeriodic: ComputerUseLoginWatchCancel | undefined;
  private work: Promise<unknown> = Promise.resolve();

  constructor(options: ComputerUsePrimaryLoginWatcherOptions) {
    this.store = options.store;
    this.sourceDirectory = computerUsePrimaryBrowserProfileDirectory(
      options.profilesDirectory,
    );
    this.watchedDirectories = [
      join(this.sourceDirectory, "Default/Network"),
      join(this.sourceDirectory, "Default"),
    ];
    this.debounceMs = options.debounceMs ?? 5_000;
    this.rearmIntervalMs = options.rearmIntervalMs ?? 30_000;
    this.periodicIntervalMs = options.periodicIntervalMs ?? 600_000;
    this.watch = options.watch ?? defaultWatch;
    this.schedule = options.schedule ?? defaultSchedule;
    this.log = options.log
      ?? ((message) => console.warn(`[computer-use-primary-login] ${message}`));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.arm();
    this.capture(false);
    this.schedulePeriodic();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.cancelDebounce?.();
    this.cancelDebounce = undefined;
    this.cancelRearm?.();
    this.cancelRearm = undefined;
    this.cancelPeriodic?.();
    this.cancelPeriodic = undefined;
    for (const handle of this.handles.values()) {
      try {
        handle.close();
      } catch {
        // The watcher may already be gone with the directory it watched.
      }
    }
    this.handles.clear();
  }

  /** Resolves once every capture this watcher started has settled. */
  idle(): Promise<void> {
    return this.work.then(() => undefined, () => undefined);
  }

  private arm(): void {
    if (!this.running) return;
    let missing = false;
    for (const directory of this.watchedDirectories) {
      if (this.handles.has(directory)) continue;
      try {
        this.handles.set(
          directory,
          this.watch(directory, (filename) => this.onFileEvent(filename)),
        );
      } catch {
        // Chrome has not created the profile yet; retry on the rearm timer.
        missing = true;
      }
    }
    if (!missing) return;
    this.cancelRearm?.();
    this.cancelRearm = this.schedule(() => {
      this.cancelRearm = undefined;
      this.arm();
    }, this.rearmIntervalMs);
  }

  private onFileEvent(filename: string | null): void {
    if (!this.running || filename === null) return;
    if (!watchedBasenames.some((name) => filename.startsWith(name))) return;
    this.cancelDebounce?.();
    this.cancelDebounce = this.schedule(() => {
      this.cancelDebounce = undefined;
      this.capture(true);
    }, this.debounceMs);
  }

  private schedulePeriodic(): void {
    if (!this.running) return;
    this.cancelPeriodic?.();
    this.cancelPeriodic = this.schedule(() => {
      this.cancelPeriodic = undefined;
      this.capture(false);
      this.schedulePeriodic();
    }, this.periodicIntervalMs);
  }

  private capture(sqliteOnly: boolean): void {
    if (!this.running) return;
    this.work = this.work.then(async () => {
      if (!this.running) return;
      try {
        const report = await this.store.captureLive(this.sourceDirectory, { sqliteOnly });
        if (report.skipped.length > 0) {
          this.log(
            `capture skipped ${
              report.skipped.map(({ entry, reason }) => `${entry} (${reason})`).join(", ")
            }`,
          );
        }
      } catch (error) {
        this.log(`capture failed: ${describe(error)}`);
      }
    });
  }
}
