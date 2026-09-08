import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { CodexOwnedProcesses } from "./codex-owned-processes";

describe("Codex owned tool processes", () => {
  it.skipIf(process.platform !== "darwin" && process.platform !== "linux")(
    "stops a tool in its own process group while leaving an unrelated process alive", async () => {
      const directory = await mkdtemp(join(tmpdir(), "briar-codex-owned-test-"));
      const delayedWrite = "setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'late'), 1500)";
      const parent = spawn(process.execPath, ["-e", `
        const child = require('node:child_process').spawn(process.execPath,
          ['-e', ${JSON.stringify(delayedWrite)}, process.argv[1]], {detached:true, stdio:'ignore'});
        child.on('spawn', () => process.stdout.write('ready'));
        setInterval(() => {}, 1000);
      `, join(directory, "owned-late")], { stdio: ["ignore", "pipe", "ignore"] });
      const unrelated = spawn(process.execPath, ["-e", delayedWrite, join(directory, "unrelated-late")], { stdio: "ignore" });
      const unrelatedExit = once(unrelated, "exit");
      try {
        await once(parent.stdout!, "data");
        const owned = new CodexOwnedProcesses(parent.pid!);
        await owned.capture();
        await owned.stopAndVerify();
        expect(() => process.kill(parent.pid!, 0)).not.toThrow();
        await unrelatedExit;
        expect(await readFile(join(directory, "unrelated-late"), "utf8")).toBe("late");
        await expect(readFile(join(directory, "owned-late"))).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        parent.kill("SIGTERM");
        unrelated.kill("SIGTERM");
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
