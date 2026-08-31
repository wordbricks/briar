import { toJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import {
  AgentActivityKind,
  AgentActivityStatus,
  AgentEventDirection,
} from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import {
  describe,
  expect,
  it,
} from "vitest";
import {
  sidecarProviderEvent,
  sidecarSessionStarted,
} from "../src-agent/sidecar-protocol";
import { normalizedActivityCompleted } from "../src-agent/normalized-agent-event";
import { transcriptEventFromSidecar } from "./worker-transcript-client";

describe("Worker transcript protobuf projection", () => {
  it("bounds untrusted raw output while retaining the typed normalized event", () => {
    const mapped = transcriptEventFromSidecar(
      sidecarProviderEvent({
        direction: AgentEventDirection.CLIENT,
        raw: { output: "원격 명령 출력".repeat(20_000) },
        event: normalizedActivityCompleted({
          id: "activity-1",
          kind: AgentActivityKind.COMMAND,
          title: "아주 긴 명령 ".repeat(4_000),
          text: "아주 긴 실행 결과 ".repeat(20_000),
          status: AgentActivityStatus.COMPLETED,
        }),
      }),
      42,
    );

    expect(mapped.sequence).toBe(42n);
    expect(mapped.direction).toBe(AgentEventDirection.CLIENT);
    expect(mapped.normalized?.event).toMatchObject({
      case: "activityCompleted",
      value: {
        id: "activity-1",
        kind: AgentActivityKind.COMMAND,
        status: AgentActivityStatus.COMPLETED,
      },
    });
    expect(toJson(ValueSchema, mapped.rawPayload!)).toMatchObject({
      type: "truncated",
      originalBytes: expect.any(Number),
    });
    if (mapped.normalized?.event.case !== "activityCompleted") {
      throw new Error("missing normalized activity");
    }
    expect(Buffer.byteLength(mapped.normalized.event.value.text, "utf8"))
      .toBeLessThanOrEqual(16_000);
  });

  it("projects a generated session frame into the shared conversation event", () => {
    const mapped = transcriptEventFromSidecar(
      sidecarSessionStarted("provider-session"),
      1,
    );
    expect(mapped.normalized?.event).toMatchObject({
      case: "conversationStarted",
      value: { conversationId: "provider-session" },
    });
  });
});
