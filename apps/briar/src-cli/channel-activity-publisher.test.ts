import { describe, expect, it, vi } from "vitest";
import {
  AgentActivityKind,
  AgentActivityStatus,
} from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import {
  normalizedActivityCompleted,
  normalizedActivityDelta,
  normalizedActivityStarted,
  normalizedMessageCompleted,
} from "../src-agent/normalized-agent-event";
import { sidecarProviderEvent } from "../src-agent/sidecar-protocol";
import {
  ChannelActivityPublisher,
  safeChannelActivityHeadline,
} from "./channel-activity-publisher";
import type { ChannelAgentActivityPublishInput } from "../src/lib/channel-agent-activity";

const credential = {
  token: "activity-token",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

describe("ChannelActivityPublisher", () => {
  it("publishes commentary and restores it after a tool completes", async () => {
    const send = vi.fn(async (
      _credential: typeof credential,
      _input: ChannelAgentActivityPublishInput,
    ) => undefined);
    const publisher = new ChannelActivityPublisher({
      credential,
      send,
      minIntervalMs: 1,
    });

    publisher.observePayload(sidecarProviderEvent({
      raw: {},
      event: normalizedMessageCompleted({
        id: "commentary-1",
        phase: "commentary",
        text: "저장소 구조를 확인하고 있습니다.",
      }),
    }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      activity: {
        id: "commentary-1",
        kind: "message",
        headline: "저장소 구조를 확인하고 있습니다.",
      },
    });

    publisher.observePayload(sidecarProviderEvent({
      raw: {},
      event: normalizedActivityStarted({
        id: "command-1",
        kind: AgentActivityKind.COMMAND,
        title: "Running tests",
        text: "",
      }),
    }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    publisher.observePayload(sidecarProviderEvent({
      raw: {},
      event: normalizedActivityCompleted({
        id: "command-1",
        kind: AgentActivityKind.COMMAND,
        title: "Running tests",
        text: "",
        status: AgentActivityStatus.COMPLETED,
      }),
    }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    expect(send.mock.calls[2]?.[1]).toMatchObject({
      activity: { id: "commentary-1", kind: "message" },
    });
    publisher.stop();
  });

  it("publishes only normalized semantic activity without blocking observation", async () => {
    const send = vi.fn(async () => undefined);
    const publisher = new ChannelActivityPublisher({
      credential,
      send,
      minIntervalMs: 1,
    });

    publisher.observePayload(sidecarProviderEvent({
      raw: {},
      event: normalizedActivityStarted({
        id: "command-1",
        kind: AgentActivityKind.COMMAND,
        title: "Running tests",
        text: "private output",
      }),
    }));
    publisher.observePayload(sidecarProviderEvent({
      raw: {},
      event: normalizedActivityDelta({
        id: "command-1",
        delta: "secret stdout",
      }),
    }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(credential, {
      sequence: 1,
      activity: {
        id: "command-1",
        kind: "command",
        headline: "Running tests",
      },
    });
    expect(JSON.stringify(send.mock.calls)).not.toContain("private output");
    expect(JSON.stringify(send.mock.calls)).not.toContain("secret stdout");
    publisher.stop();
  });

  it("redacts common credentials from provider titles", () => {
    expect(
      safeChannelActivityHeadline(
        "command",
        "TOKEN=super-secret ghp_abcdefghijklmnopqrstuvwxyz123456",
      ),
    ).toBe("TOKEN=[redacted] [redacted]");
  });

  it("publishes only the reply body when commentary is a JSON envelope", async () => {
    const send = vi.fn(async (
      _credential: typeof credential,
      _input: ChannelAgentActivityPublishInput,
    ) => undefined);
    const publisher = new ChannelActivityPublisher({
      credential,
      send,
      minIntervalMs: 1,
    });

    publisher.observePayload(sidecarProviderEvent({
      raw: {},
      event: normalizedMessageCompleted({
        id: "commentary-json",
        phase: "commentary",
        text: '{"body":"Approve 동시성 처리와 staging 배포 흐름을 코드 기준으로 확인하겠습니다.","attachments":[],"document":null,"issueProposal"',
      }),
    }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      activity: {
        id: "commentary-json",
        kind: "message",
        headline:
          "Approve 동시성 처리와 staging 배포 흐름을 코드 기준으로 확인하겠습니다.",
      },
    });
    publisher.stop();
  });

  it("keeps only the newest state while a publish is in flight", async () => {
    let resolveFirst: (() => void) | undefined;
    const send = vi.fn((
      _credential: typeof credential,
      _input: ChannelAgentActivityPublishInput,
    ) =>
      new Promise<void>((resolve) => {
        resolveFirst ??= resolve;
      })
    );
    const publisher = new ChannelActivityPublisher({
      credential,
      send,
      minIntervalMs: 1,
    });
    publisher.observePayload(sidecarProviderEvent({
      raw: {},
      event: normalizedActivityStarted({
        id: "one",
        kind: AgentActivityKind.TOOL,
        title: "First tool",
        text: "",
      }),
    }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    publisher.observePayload(sidecarProviderEvent({
      raw: {},
      event: normalizedActivityStarted({
        id: "two",
        kind: AgentActivityKind.WEB_SEARCH,
        title: "Latest search",
        text: "",
      }),
    }));
    expect(send).toHaveBeenCalledTimes(1);
    resolveFirst?.();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]?.[1]).toMatchObject({
      activity: { id: "two", headline: "Latest search" },
    });
    publisher.stop();
  });
});
