import { readDmMessageMcpConfig } from "../src-agent/dm-message-mcp-config";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { ExecuteDmScheduleToolResponseSchema, PublishDmMessageBatchResponseSchema } from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { expect, it, vi } from "vitest";
import { invokeDmMessageCommand } from "../src-agent/dm-message-mcp-server";
import { DmMessageInvocation } from "./dm-message-invocation";
import { prepareDmMessageCommand } from "./dm-message-command";
import type { DetachedProviderTurnInput } from "./detached-provider-turn";
import type { ClaimedChannelReply } from "./worker-queue-contract";

it("uses the same authenticated command for a provider whose ACP adapter ignores MCP", async () => {
  const executeDmScheduleTool = vi.fn(async () => create(ExecuteDmScheduleToolResponseSchema, { notice: "saved", schedules: [] }));
  const invocation = await DmMessageInvocation.create({ projectId: "project", workerId: "worker",
    work: { workType: "channelReply", workId: crypto.randomUUID(), runId: "run", claimToken: "token",
      workspaceId: "org", inputRevision: 0, publishedMessageBatches: [], provider: "pi", routing: { action: "new" } } as unknown as ClaimedChannelReply,
    queue: { executeDmScheduleTool, publishDmMessageBatch: vi.fn(async () => create(PublishDmMessageBatchResponseSchema)) } as never });
  const binding = invocation.binding();
  const workspacePath = await mkdtemp(join(tmpdir(), "dm-command-test-"));
  const prepared = await prepareDmMessageCommand({ agent: { provider: "pi" }, prompt: "Set a timer", workspacePath, dmMessagePublicationBinding: binding,
    dmMessageMcpServerPath: "/tmp/a path with ' quotes/dm-tool.js" } as DetachedProviderTurnInput);
  try {
    expect(prepared.input.dmMessagePublicationBinding).toBeUndefined();
    expect(prepared.input.dmMessageMcpServerPath).toBeUndefined();
    expect(prepared.input.prompt).toContain("--invoke");
    const directory = (await readdir(workspacePath))[0]!;
    const config = await readDmMessageMcpConfig(join(workspacePath, directory, "command-config.json"));
    expect(config.relayDirectory).toBe(join(workspacePath, directory));
    expect(await invokeDmMessageCommand(config, { tool: "create_dm_schedule", requestKey: "timer1", instruction: "check", delaySeconds: 300 })).toMatchObject({ notice: "saved" });
    expect(executeDmScheduleTool).toHaveBeenCalledTimes(1);
    await expect(invokeDmMessageCommand({ ...config, capability: "wrong" }, { tool: "list_dm_schedules" })).rejects.toThrow();
    expect(executeDmScheduleTool).toHaveBeenCalledTimes(1);
  } finally { await prepared.cleanup(); await invocation.cleanup({ terminal: true }); await rm(workspacePath, { recursive: true, force: true }); }
});
