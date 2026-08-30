import {
  describe,
  expect,
  it,
} from "vitest";
import {
  sidecarProviderEvent,
  sidecarSessionStarted,
} from "../src-agent/sidecar-protocol";

import { transcriptEventToProto } from "./worker-transcript-client";

describe("Worker transcript protobuf mapping", () => {
  it("forwards the generated sidecar payload without rebuilding its wire fields", () => {
    const payload = sidecarProviderEvent({
      raw: { method: "item/updated", providerSpecific: [1, true, null] },
      direction: "client",
      event: {
        type: "activityCompleted",
        id: "activity-1",
        kind: "command",
        title: "Tests",
        text: "all green",
        status: "completed",
      },
    });
    if (payload.payload.case !== "event") throw new Error("missing event");

    const mapped = transcriptEventToProto({
      sequence: 42,
      direction: "client",
      payload,
    });

    expect(mapped.sequence).toBe(42n);
    expect(mapped.direction).toBe(1);
    expect(mapped.rawPayload).toBe(payload.payload.value.raw);
    expect(mapped.normalized).toBe(payload.payload.value.normalized);
  });

  it("projects a generated session frame into the shared conversation event", () => {
    const mapped = transcriptEventToProto({
      sequence: 1,
      direction: "server",
      payload: sidecarSessionStarted("provider-session"),
    });
    expect(mapped.normalized?.event).toMatchObject({
      case: "conversationStarted",
      value: { conversationId: "provider-session" },
    });
  });
});
