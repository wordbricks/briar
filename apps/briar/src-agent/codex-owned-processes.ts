import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import * as Schema from "effect/Schema";

const execFileAsync = promisify(execFile);
const decodeProcess = Schema.decodeUnknownSync(Schema.Struct({
  pid: Schema.FiniteFromString, ppid: Schema.FiniteFromString, pgid: Schema.FiniteFromString,
  started: Schema.String,
}));
type ProcessIdentity = ReturnType<typeof decodeProcess>;

async function processTable() {
  if (process.platform !== "darwin" && process.platform !== "linux") throw new Error("codex_process_cleanup_unsupported");
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,pgid=,lstart="], {
    timeout: 2_000, maxBuffer: 4 * 1024 * 1024,
  });
  return new Map(stdout.trim().split(/\r?\n/u).filter(Boolean).map((line) => {
    const [pid, ppid, pgid, ...started] = line.trim().split(/\s+/u);
    const row = decodeProcess({ pid, ppid, pgid, started: started.join(" ") });
    return [row.pid, row];
  }));
}
const sameProcess = (a: ProcessIdentity, b: ProcessIdentity | undefined) =>
  b !== undefined && a.pid === b.pid && a.started === b.started && a.pgid === b.pgid;

/** Track only this App Server's descendants, including tools that later become orphans. */
export class CodexOwnedProcesses {
  private root: ProcessIdentity | null = null;
  private owned = new Map<number, ProcessIdentity>();
  constructor(private readonly rootPid: number) {}

  async capture() {
    const table = await processTable();
    const root = table.get(this.rootPid);
    if (!root || (this.root && !sameProcess(this.root, root))) throw new Error("codex_process_owner_lost");
    this.root = root;
    const descendants = new Set([this.rootPid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of table.values()) {
        if (row.pid !== this.rootPid && !descendants.has(row.pid) && descendants.has(row.ppid)) {
          descendants.add(row.pid);
          this.owned.set(row.pid, row);
          changed = true;
        }
      }
    }
  }

  private liveOwned(table: Map<number, ProcessIdentity>) {
    return [...this.owned.values()].filter((row) => sameProcess(row, table.get(row.pid)));
  }

  private async signalOwned(signal: NodeJS.Signals) {
    const table = await processTable();
    const ownGroup = table.get(process.pid)?.pgid;
    for (const row of this.liveOwned(table)) {
      // Only captured descendant group leaders may be addressed as a group.
      // Never signal the Worker/runner group, even when an owned child inherited it.
      const target = row.pid === row.pgid && row.pgid !== ownGroup && row.pgid !== this.root?.pgid
        ? -row.pgid : row.pid;
      try { process.kill(target, signal); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
      }
    }
  }

  async stopAndVerify() {
    // Capture again after interrupt: an in-flight tool may have started since the first snapshot.
    await this.capture();
    await this.signalOwned("SIGTERM");
    for (let attempt = 0; attempt < 20; attempt++) {
      if (this.liveOwned(await processTable()).length === 0) return;
      if (attempt === 5) await this.signalOwned("SIGKILL");
      await delay(100);
    }
    throw new Error("codex_owned_processes_still_running");
  }
}
