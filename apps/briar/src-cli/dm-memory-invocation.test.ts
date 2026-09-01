import { create, fromJson, type JsonValue } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import {
  DmMemoryBriefState,
  DmMemoryDescriptorSchema,
} from "@briar/contracts/gen/briar/app/v1/dm_memory_pb";
import {
  CheckDmMemoryClaimResponseSchema,
  GetDmMemoryBriefResponseSchema,
  LookupDmMemoryResponseSchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { stat } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  DmMemoryInvocation,
  dmMemoryExecutionError,
} from "./dm-memory-invocation";
import type { ClaimedChannelReply } from "./worker-queue-contract";

const memorySpaceId = crypto.randomUUID();
const descriptor = {
  protocol: 1 as const,
  memorySpaceId,
  memoryRevision: 1,
  revocationEpoch: 0,
  searchEnabled: true,
  briefState: "available" as const,
};
const wireDescriptor = (revocationEpoch = 0) => create(DmMemoryDescriptorSchema, {
  protocol: 1,
  memorySpaceId,
  memoryRevision: 1n,
  revocationEpoch: BigInt(revocationEpoch),
  searchEnabled: true,
  briefState: DmMemoryBriefState.AVAILABLE,
});
const jsonValue = (value: unknown) => fromJson(
  ValueSchema,
  JSON.parse(JSON.stringify(value)) as JsonValue,
);
const work = {
  workType: "channelReply",
  workId: crypto.randomUUID(),
  runId: crypto.randomUUID(),
  claimToken: `briar_channel_claim_${"a".repeat(64)}`,
  organizationId: crypto.randomUUID(),
} as ClaimedChannelReply;

const queue = (epoch = 0) => ({
  checkDmMemoryClaim: vi.fn(async () => create(
    CheckDmMemoryClaimResponseSchema,
    { memory: wireDescriptor(epoch) },
  )),
  getDmMemoryBrief: vi.fn(async () => create(
    GetDmMemoryBriefResponseSchema,
    {
      memory: wireDescriptor(epoch),
      brief: jsonValue({
        memorySpaceId,
        memoryRevision: 1,
        revocationEpoch: epoch,
        policyVersion: "test-v1",
        validThrough: null,
        profile: [],
        progress: [],
        omitted: true,
        notice: "Search when needed.",
      }),
    },
  )),
  lookupDmMemory: vi.fn(async () => create(LookupDmMemoryResponseSchema, {
    response: jsonValue({
      operation: "search",
      status: "ok",
      memoryRevision: 1,
      revocationEpoch: epoch,
      indexState: "ready",
      truncated: false,
      results: [],
    }),
  })),
});

describe("DM memory Connect invocation", () => {
  it("uses generated Worker Queue RPCs and removes private files", async () => {
    const client = queue();
    const invocation = await DmMemoryInvocation.create({
      queue: client,
      projectId: crypto.randomUUID(),
      workerId: "worker-1",
      work,
      memory: descriptor,
    });
    const directory = invocation.directory;
    expect(invocation.prompt()).toContain("Private profile file:");
    await invocation.lookup({ operation: "search", queries: ["metric units"] });
    expect(client.lookupDmMemory).toHaveBeenCalledOnce();
    await invocation.cleanup();
    await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed when the server revokes the claim", async () => {
    await expect(DmMemoryInvocation.create({
      queue: queue(1),
      projectId: crypto.randomUUID(),
      workerId: "worker-1",
      work,
      memory: descriptor,
    })).rejects.toThrow("memory_scope_revoked");
  });

  it("redacts unknown provider and transport errors", () => {
    expect(dmMemoryExecutionError(new Error("private recalled text")))
      .toMatchObject({ message: "memory_reply_failed" });
    expect(dmMemoryExecutionError(new Error("memory_scope_revoked")))
      .toMatchObject({ message: "memory_scope_revoked" });
  });
});
