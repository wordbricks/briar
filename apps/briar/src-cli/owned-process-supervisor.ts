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

export const supportsOwnedProcessSupervisor = () => process.platform === "darwin" || process.platform === "linux";

async function processTable() {
  if (!supportsOwnedProcessSupervisor()) throw new Error("process_cleanup_unsupported");
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
  b !== undefined && a.pid === b.pid && a.started === b.started;

/** Owns one runner and its descendants, regardless of the provider or its tool process groups. */
export class OwnedProcessSupervisor {
  private root: ProcessIdentity | null = null;
  private owned = new Map<number, ProcessIdentity>();
  constructor(private readonly rootPid: number) {}

  async capture() {
    const table = await processTable();
    const root = table.get(this.rootPid);
    if (!root || (this.root && !sameProcess(this.root, root))) throw new Error("process_owner_lost");
    this.root = root;
    this.owned.set(root.pid, root);
    const descendants = new Set(this.liveOwned(table).map((row) => row.pid));
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of table.values()) {
        if (!descendants.has(row.pid) && descendants.has(row.ppid)) {
          descendants.add(row.pid);
          this.owned.set(row.pid, row);
          changed = true;
        }
      }
    }
  }

  private liveOwned(table: Map<number, ProcessIdentity>) {
    return [...this.owned.values()].flatMap((row) => {
      const current = table.get(row.pid);
      return current && sameProcess(row, current) ? [current] : [];
    });
  }

  private async signalOwned(signal: NodeJS.Signals, rootOnly = false) {
    const table = await processTable();
    const ownGroup = table.get(process.pid)?.pgid;
    const rows = this.liveOwned(table).filter((row) => !rootOnly || row.pid === this.rootPid);
    // Descendants first when killing, so the runner cannot disappear before its tools are addressed.
    rows.sort((a, b) => Number(a.pid === this.rootPid) - Number(b.pid === this.rootPid));
    for (const row of rows) {
      if (row.pid === process.pid) throw new Error("process_owner_invalid");
      const target = row.pid === row.pgid && row.pgid !== ownGroup ? -row.pgid : row.pid;
      try { process.kill(target, signal); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
      }
    }
  }

  async stopAndVerify() {
    await this.capture();
    try {
      // Freeze the runner first. Then freeze discovered child groups until no new descendants appear.
      await this.signalOwned("SIGSTOP", true);
      let stable = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        const size = this.owned.size;
        await this.capture();
        await this.signalOwned("SIGSTOP");
        await this.capture();
        if (this.owned.size === size) { stable = true; break; }
      }
      if (!stable) throw new Error("process_tree_changed_during_stop");
    } finally {
      // SIGKILL also works on frozen processes. No provider signal handler can launch more work.
      await this.signalOwned("SIGKILL");
    }
    for (let attempt = 0; attempt < 20; attempt++) {
      if (this.liveOwned(await processTable()).length === 0) return;
      await delay(100);
    }
    throw new Error("owned_processes_still_running");
  }
}
