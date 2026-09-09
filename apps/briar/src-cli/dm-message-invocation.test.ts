import { Buffer } from "node:buffer";
import { createConnection } from "node:net";
import { create } from "@bufbuild/protobuf";
import { sizeDelimitedDecodeStream, sizeDelimitedEncode } from "@bufbuild/protobuf/wire";
import { Code, ConnectError } from "@connectrpc/connect";
import { DmMessagePurpose } from "@briar/contracts/gen/briar/app/v1/channel_pb";
import {
  DmMessagePublicationPartSchema,
  DmMessagePublicationRequestSchema,
  DmMessagePublicationResponseSchema,
} from "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";
import {
  DmMessagePublicationKind,
  PublishDmMessageBatchResponseSchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { describe, expect, it, vi } from "vitest";
import type { ClaimedChannelReply } from "./worker-queue-contract";
import { DmMessageInvocation } from "./dm-message-invocation";

const exchange = async (
  invocation: DmMessageInvocation,
  operationKey: string,
) => {
  const binding = invocation.binding();
  const socket = createConnection(binding.socketPath);
  socket.end(sizeDelimitedEncode(DmMessagePublicationRequestSchema, create(
    DmMessagePublicationRequestSchema,
    {
      invocationId: binding.invocationId,
      capability: binding.capability,
      operationKey,
      parts: [create(DmMessagePublicationPartSchema, {
        clientId: "observation-1",
        body: "The build passed.",
        purpose: DmMessagePurpose.PROGRESS,
      })],
    },
  )));
  const source = (async function*() {
    for await (const chunk of socket) yield chunk as Buffer;
  })();
  const iterator = sizeDelimitedDecodeStream(
    DmMessagePublicationResponseSchema,
    source,
  )[Symbol.asyncIterator]();
  const first = await iterator.next();
  expect(first.done).toBe(false);
  expect((await iterator.next()).done).toBe(true);
  return first.value!;
};

const claim = (): ClaimedChannelReply => ({
  workType: "channelReply",
  workId: `reply-${crypto.randomUUID()}`,
  runId: "run-1",
  claimToken: "claim-token",
  workspaceId: "workspace-1",
  inputRevision: 0,
  publishedMessageBatches: [],
} as unknown as ClaimedChannelReply);

describe("DmMessageInvocation", () => {
  it("retries one prepared request, replays its receipt and publishes one final", async () => {
    const requests: Array<{
      requestId: string;
      kind: DmMessagePublicationKind;
    }> = [];
    let call = 0;
    const publishDmMessageBatch = vi.fn(async (request) => {
      requests.push({
        requestId: request.requestId,
        kind: request.publicationKind,
      });
      call += 1;
      if (call === 1) throw new ConnectError("offline", Code.Unavailable);
      const final = request.publicationKind === DmMessagePublicationKind.FINAL;
      return create(PublishDmMessageBatchResponseSchema, {
        batchId: final ? "batch-final" : "batch-progress",
        messageIds: [final ? "message-final" : "message-progress"],
        firstSequence: final ? 2n : 1n,
        lastSequence: final ? 2n : 1n,
        replayed: false,
      });
    });
    const invocation = await DmMessageInvocation.create({
      queue: { publishDmMessageBatch } as never,
      projectId: "project-1",
      workerId: "worker-1",
      work: claim(),
    });

    try {
      const first = await exchange(invocation, "build-result");
      const replay = await exchange(invocation, "build-result");
      expect(first.result.case).toBe("receipt");
      expect(replay.result.case).toBe("receipt");
      if (replay.result.case === "receipt") {
        expect(replay.result.value).toMatchObject({
          batchId: "batch-progress",
          messageIds: ["message-progress"],
          replayed: true,
        });
      }

      const final = await invocation.publishFinal(
        "Everything is ready.",
        AbortSignal.timeout(5_000),
      );
      expect(final).toMatchObject({
        batchId: "batch-final",
        messageIds: ["message-final"],
      });
      expect(requests).toHaveLength(3);
      expect(requests[0]?.requestId).toBe(requests[1]?.requestId);
      expect(requests.map(({ kind }) => kind)).toEqual([
        DmMessagePublicationKind.INTERMEDIATE,
        DmMessagePublicationKind.INTERMEDIATE,
        DmMessagePublicationKind.FINAL,
      ]);
      expect(invocation.publishedBatchIds()).toEqual([
        "batch-progress",
        "batch-final",
      ]);
    } finally {
      await invocation.cleanup({ terminal: true });
    }
  });
});
