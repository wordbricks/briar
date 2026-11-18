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

  it("publishes a typed progress message whatever phase the provider tags", async () => {
    const send = vi.fn(async (
      _credential: typeof credential,
      _input: ChannelAgentActivityPublishInput,
    ) => undefined);
    const publisher = new ChannelActivityPublisher({
      credential,
      send,
      minIntervalMs: 1,
    });

    // Codex passes its own phases through and never tags "commentary".
    publisher.observePayload(sidecarProviderEvent({
      raw: {},
      event: normalizedMessageCompleted({
        id: "codex-progress",
        phase: "task_summary",
        text:
          '{"progress":"현재 랜딩 구조와 카피 위치를 확인하겠습니다"}',
      }),
    }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      activity: {
        id: "codex-progress",
        kind: "message",
        headline: "현재 랜딩 구조와 카피 위치를 확인하겠습니다",
      },
    });

    // agy tags every assistant message "final".
    publisher.observePayload(sidecarProviderEvent({
      raw: {},
      event: normalizedMessageCompleted({
        id: "agy-progress",
        phase: "final",
        text: '```json\n{"progress":"Running the reply tests"}\n```',
      }),
    }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]?.[1]).toMatchObject({
      activity: { id: "agy-progress", headline: "Running the reply tests" },
    });

    // claude and ACP do tag commentary; that path must keep working.
    publisher.observePayload(sidecarProviderEvent({
      raw: {},
      event: normalizedMessageCompleted({
        id: "acp-progress",
        phase: "commentary",
        text: '{"progress":"Reading the activity publisher"}',
      }),
    }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    expect(send.mock.calls[2]?.[1]).toMatchObject({
      activity: { id: "acp-progress", headline: "Reading the activity publisher" },
    });
    publisher.stop();
  });

  it("redacts and truncates a typed progress headline", async () => {
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
        id: "progress-secret",
        phase: "commentary",
        text: JSON.stringify({
          progress: "Exporting API_KEY=super-secret before the deploy check",
        }),
      }),
    }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      activity: {
        headline: "Exporting API_KEY=[redacted] before the deploy check",
      },
    });
    publisher.stop();
  });

  it("keeps a reply envelope out of the strip whatever phase it carries", async () => {
    const send = vi.fn(async () => undefined);
    const publisher = new ChannelActivityPublisher({
      credential,
      send,
      minIntervalMs: 1,
    });
    const envelope = JSON.stringify({
      acknowledgementReaction: null,
      body: "확인했습니다. 랜딩 카피는 hero 섹션에 있습니다.",
      attachments: [],
      document: null,
      issueProposal: null,
    });

    // OpenCode tags even its final reply envelope "commentary".
    publisher.observePayload(sidecarProviderEvent({
      raw: {},
      event: normalizedMessageCompleted({
        id: "opencode-final",
        phase: "commentary",
        text: envelope,
      }),
    }));
    publisher.observePayload(sidecarProviderEvent({
      raw: {},
      event: normalizedMessageCompleted({
        id: "codex-final",
        phase: "final_answer",
        text: envelope,
      }),
    }));
    // A progress member smuggled into an envelope is still an envelope.
    publisher.observePayload(sidecarProviderEvent({
      raw: {},
      event: normalizedMessageCompleted({
        id: "mixed",
        phase: "commentary",
        text: '{"progress":"working","body":"the answer"}',
      }),
    }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(send).not.toHaveBeenCalled();
    publisher.stop();
  });

  it("ignores malformed progress JSON without throwing", async () => {
    const send = vi.fn(async () => undefined);
    const publisher = new ChannelActivityPublisher({
      credential,
      send,
      minIntervalMs: 1,
    });

    for (const [id, text] of [
      ["partial", '{"progress":"현재 랜딩 구조를 확'],
      ["fragment", "{"],
      ["array", '["progress"]'],
      ["wrong-type", '{"progress":42}'],
      ["empty-progress", '{"progress":"   "}'],
    ] as const) {
      expect(() =>
        publisher.observePayload(sidecarProviderEvent({
          raw: {},
          event: normalizedMessageCompleted({ id, phase: "final", text }),
        }))
      ).not.toThrow();
    }
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
