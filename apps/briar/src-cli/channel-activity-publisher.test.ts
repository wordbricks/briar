import { describe, expect, it, vi } from "vitest";
import { AgentActivityKind } from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import {
  normalizedActivityStarted,
  normalizedMessageCompleted,
  normalizedMessageStarted,
  normalizedTurnCompleted,
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
  it("publishes commentary, ignores tool noise, and clears when the turn ends", async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(send).toHaveBeenCalledTimes(1);

    publisher.observePayload(sidecarProviderEvent({
      raw: {},
      event: normalizedTurnCompleted("completed"),
    }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]?.[1]).toMatchObject({ activity: null });
    publisher.stop();
  });

  it("does not turn provider tool events into user-visible progress", async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(send).not.toHaveBeenCalled();
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

  it("does not expose a structured reply envelope as progress", async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(send).not.toHaveBeenCalled();

    publisher.observePayload(sidecarProviderEvent({
      raw: {},
      event: normalizedMessageCompleted({
        id: "commentary-fenced-json",
        phase: "commentary",
        text: '```json\n{"reply":"final","attachments":[]}',
      }),
    }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(send).not.toHaveBeenCalled();
    publisher.stop();
  });

  it("does not republish an unchanged commentary headline", async () => {
    const send = vi.fn(async () => undefined);
    const publisher = new ChannelActivityPublisher({
      credential,
      send,
      minIntervalMs: 1,
    });
    const commentary = {
      id: "commentary-1",
      phase: "commentary",
      text: "관련 파일과 테스트 범위를 확인하겠습니다.",
    };

    publisher.observePayload(sidecarProviderEvent({
      raw: {},
      event: normalizedMessageStarted(commentary),
    }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    publisher.observePayload(sidecarProviderEvent({
      raw: {},
      event: normalizedMessageCompleted(commentary),
    }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(send).toHaveBeenCalledTimes(1);
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
      event: normalizedMessageCompleted({
        id: "one",
        phase: "commentary",
        text: "First step",
      }),
    }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    publisher.observePayload(sidecarProviderEvent({
      raw: {},
      event: normalizedMessageCompleted({
        id: "two",
        phase: "commentary",
        text: "Latest step",
      }),
    }));
    expect(send).toHaveBeenCalledTimes(1);
    resolveFirst?.();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]?.[1]).toMatchObject({
      activity: { id: "two", headline: "Latest step" },
    });
    publisher.stop();
  });
});
