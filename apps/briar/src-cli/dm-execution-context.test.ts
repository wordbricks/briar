import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { RunnerToParentSchema } from "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";
import { describe, expect, it } from "vitest";
import { DmExecutionContext } from "./dm-execution-context";

describe("provider-neutral DM continuation", () => {
  it("restores execution evidence and retained files without a provider conversation", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "dm-context-test-"));
    try {
      const context = await DmExecutionContext.open(workspace);
      expect(context.prompt()).toContain(JSON.stringify(workspace));
      expect(context.prompt()).toContain("use absolute paths");
      expect(context.prompt()).not.toContain("historical data");
      await writeFile(join(workspace, "message.txt"), "C");
      await context.observe(create(RunnerToParentSchema, { payload: { case: "event", value: { normalized: { event: {
        case: "activityCompleted", value: { id: "tool1", kind: 3, status: 1, title: "Updated message.txt", text: "Changed structure to C" },
      } } } } }));
      const restarted = await DmExecutionContext.open(workspace);
      expect(restarted.prompt()).toContain("Changed structure to C");
      expect(restarted.prompt()).toContain("Do not repeat completed external actions");
      expect(await readFile(join(workspace, "message.txt"), "utf8")).toBe("C");
      for (let n = 0; n < 10; n++) await restarted.append("x".repeat(12000));
      expect((await stat(join(workspace, ".briar-dm-context.json"))).size).toBeLessThan(50000);
      expect((await stat(join(workspace, ".briar-dm-context.json"))).mode & 0o777).toBe(0o600);
    } finally { await rm(workspace, { recursive: true, force: true }); }
  });
});
