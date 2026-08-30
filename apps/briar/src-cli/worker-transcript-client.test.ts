import {
  toBinary,
  toJson,
} from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { AgentTranscriptEventSchema } from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import {
  describe,
  expect,
  it,
} from "vitest";

import {
  normalizedTranscriptEventToProto,
  transcriptEventToProto,
} from "./worker-transcript-client";

describe("Worker transcript protobuf mapping", () => {
  it("keeps opaque JSON while projecting the typed normalized oneof and compaction", () => {
    const payload = {
      type: "event",
      raw: { method: "item/updated", providerSpecific: [1, true, null] },
      event: {
        type: "activityCompleted",
        id: "activity-1",
        kind: "command",
        title: "Tests",
        text: "all green",
        status: "completed",
      },
      archiveCompaction: {
        kind: "delta",
        firstSequence: 40,
        eventCount: 3,
      },
    };

    const mapped = transcriptEventToProto({
      sequence: 42,
      direction: "client",
      payload,
    });

    expect(mapped.sequence).toBe(42n);
    expect(mapped.direction).toBe(1);
    expect(mapped.normalized?.event.case).toBe("activityCompleted");
    expect(mapped.normalized?.event.value).toMatchObject({
      id: "activity-1",
      title: "Tests",
      text: "all green",
      kind: 2,
      status: 1,
    });
    expect(mapped.archiveCompaction).toMatchObject({
      firstSequence: 40n,
      representedEventCount: 3,
    });
    expect(toJson(ValueSchema, mapped.rawPayload!)).toEqual(payload.raw);
    expect(toBinary(AgentTranscriptEventSchema, mapped).byteLength).toBeGreaterThan(0);
  });

  it("maps synthesized session starts without inventing normalized data for opaque payloads", () => {
    expect(normalizedTranscriptEventToProto({
      type: "session",
      sessionId: "provider-session",
      event: {
        type: "conversationStarted",
        conversationId: "provider-session",
      },
    })?.event).toMatchObject({
      case: "conversationStarted",
      value: { conversationId: "provider-session" },
    });
    expect(normalizedTranscriptEventToProto({
      type: "provider.private.event",
      value: 1,
    })).toBeUndefined();
  });
});
