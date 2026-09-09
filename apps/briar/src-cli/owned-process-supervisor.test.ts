import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { OwnedProcessSupervisor, supportsOwnedProcessSupervisor } from "./owned-process-supervisor";

describe("provider-neutral process supervision", () => {
  it.skipIf(!supportsOwnedProcessSupervisor())(
    "stops the runner and its detached tool without stopping another invocation", async () => {
      const directory = await mkdtemp(join(tmpdir(), "briar-owned-process-test-"));
      const delayedWrite = "setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'late'), 1500)";
      const runner = spawn(process.execPath, ["-e", `
        const child = require('node:child_process').spawn(process.execPath,
          ['-e', ${JSON.stringify(delayedWrite)}, process.argv[1]], {detached:true, stdio:'ignore'});
        child.on('spawn', () => process.stdout.write('ready'));
        setInterval(() => {}, 1000);
      `, join(directory, "cancelled-late")], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
      const other = spawn(process.execPath, ["-e", delayedWrite, join(directory, "other-late")], {
        detached: true, stdio: "ignore",
      });
      const runnerExit = once(runner, "exit"), otherExit = once(other, "exit");
      try {
        await once(runner.stdout!, "data");
        const supervisor = new OwnedProcessSupervisor(runner.pid!);
        await supervisor.capture();
        await supervisor.stopAndVerify();
        await runnerExit;
        await otherExit;
        expect(await readFile(join(directory, "other-late"), "utf8")).toBe("late");
        await expect(readFile(join(directory, "cancelled-late"))).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        runner.kill("SIGKILL");
        other.kill("SIGKILL");
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
