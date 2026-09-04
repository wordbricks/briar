/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import * as React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  channelReplyProviderUsageExhaustedError,
  type ChannelAgentReply,
  type ChannelDelta,
} from "../../lib/channels-contract";
import type {
  RealtimeNotification,
  RealtimeTransport,
} from "../../lib/realtime-transport";
import { ToastProvider } from "../../components/ui/toast";
import { I18nProvider } from "../../i18n";
import {
  testChannelAgentReply,
  testChannelMessage,
  testChannelSummary,
} from "../../test/channel-conversation";
import { createReactTestRoot, renderReactTestRoot } from "../../test/react";
import { channelApiAtom } from "../channels/api";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import {
  channelAgentRepliesAtom,
  channelRootMessagesAtom,
} from "./atoms";
import { applyIncomingChannelAgentReplies } from "./incoming";
import { useChannelConversationSync } from "./useChannelConversationSync";
import { writeChannelAgentReplies, writeChannelTimeline } from "./write";

/*
  The realtime delta loop, exercised where it now lives.

  Everything these cases assert came from `use-channel-conversation.test.tsx`:
  a cursor notification drains one page, a reset replaces the timeline and the
  replies, a terminal reply survives an older answer arriving after it, and a
  reply that *became* failed raises a toast while one that was already failed
  does not. The pages land in the store rather than in a component's setters,
  so the assertions read the store.
*/

const channelId = "channel-1";

class FakeRealtimeTransport implements RealtimeTransport {
  listener: ((notification: RealtimeNotification) => void) | null = null;
  start = vi.fn();
  stop = vi.fn();

  subscribe(listener: (notification: RealtimeNotification) => void) {
    this.listener = listener;
    return vi.fn();
  }

  emit(notification: RealtimeNotification) {
    this.listener?.(notification);
  }
}

const transport = new FakeRealtimeTransport();
const loadChannelDelta = vi.fn();

const delta = (overrides: Partial<ChannelDelta> = {}): ChannelDelta => ({
  cursor: 1,
  hasMore: false,
  reset: false,
  channels: [],
  removedChannelIds: [],
  messages: [],
  removedMessageIds: [],
  agentReplies: [],
  ...overrides,
});

function Harness({ channel = channelId }: { channel?: string | null }) {
  const cursor = React.useRef(0);
  useChannelConversationSync({
    enabled: true,
    channelId: channel,
    catalogCursor: cursor,
    catalogReady: true,
    onCatalogDelta: () => undefined,
    onSelectedChannelRemoved: () => undefined,
    warningLabel: "test delta failed",
  });
  return null;
}

async function renderHarness(seed?: (registry: AtomRegistry) => void) {
  const { cleanup, root } = createReactTestRoot({ attachToDocument: true });
  const registry = createTestRegistry([
    [tokenAtom, "token"],
    [activeOrganizationIdAtom, "org-1"],
    [
      channelApiAtom,
      {
        loadChannelDelta,
        createChannelRealtimeTransport: () => transport,
      },
    ],
  ]);
  seed?.(registry);
  await renderReactTestRoot(
    root,
    <RegistryContext.Provider value={registry}>
      <I18nProvider>
        <ToastProvider>
          <Harness />
        </ToastProvider>
      </I18nProvider>
    </RegistryContext.Provider>,
  );
  return { cleanup, registry };
}

/** Emits a cursor notification and lets the loop drain one page. */
async function emitCursor(cursor: number) {
  await act(async () => {
    transport.emit({ topic: "channels", cursor });
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("channel conversation realtime sync", () => {
  let cleanup: (() => Promise<void>) | null = null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    cleanup = null;
    transport.listener = null;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (cleanup) await cleanup();
    cleanup = null;
    vi.restoreAllMocks();
  });

  it("drains a realtime cursor notification through the shared delta loop", async () => {
    loadChannelDelta.mockResolvedValueOnce(
      delta({ messages: [testChannelMessage("realtime")] }),
    );
    let registry!: AtomRegistry;
    ({ cleanup, registry } = await renderHarness((target) =>
      writeChannelTimeline(target, channelId, []),
    ));

    await emitCursor(1);

    expect(loadChannelDelta).toHaveBeenCalledWith(
      "token",
      "org-1",
      0,
      expect.any(AbortSignal),
    );
    expect(
      registry.get(channelRootMessagesAtom(channelId)).map((item) => item.id),
    ).toEqual(["realtime"]);
  });

  it("replaces stale messages and replies on a reset delta", async () => {
    const fresh = testChannelAgentReply("reply-fresh", { status: "running" });
    loadChannelDelta.mockResolvedValueOnce(
      delta({
        cursor: 8,
        reset: true,
        channels: [testChannelSummary(channelId)],
        messages: [testChannelMessage("fresh")],
        agentReplies: [fresh],
      }),
    );
    let registry!: AtomRegistry;
    ({ cleanup, registry } = await renderHarness((target) => {
      writeChannelTimeline(target, channelId, [testChannelMessage("stale")]);
      writeChannelAgentReplies(target, channelId, [
        testChannelAgentReply("reply-stale"),
      ]);
    }));

    await emitCursor(8);

    expect(
      registry.get(channelRootMessagesAtom(channelId)).map((item) => item.id),
    ).toEqual(["fresh"]);
    expect(registry.get(channelAgentRepliesAtom(channelId))).toEqual([fresh]);
  });

  it("keeps a terminal delta when an older answer arrives later", async () => {
    const completed = testChannelAgentReply("reply-a", {
      status: "completed",
      updatedAt: "2026-08-01T02:00:00.000Z",
    });
    loadChannelDelta.mockResolvedValueOnce(
      delta({ agentReplies: [completed] }),
    );
    let registry!: AtomRegistry;
    ({ cleanup, registry } = await renderHarness((target) =>
      writeChannelTimeline(target, channelId, []),
    ));

    await emitCursor(1);
    expect(registry.get(channelAgentRepliesAtom(channelId))).toEqual([
      completed,
    ]);

    // The send response that started before the delta lands afterwards.
    act(() => {
      applyIncomingChannelAgentReplies(
        registry,
        channelId,
        [
          testChannelAgentReply("reply-a", {
            status: "queued",
            updatedAt: "2026-08-01T03:00:00.000Z",
          }),
        ],
        false,
      );
    });
    expect(registry.get(channelAgentRepliesAtom(channelId))).toEqual([
      completed,
    ]);
  });

  it("keeps only the other Agent active after one of concurrent replies completes", async () => {
    const first = testChannelAgentReply("reply-a", {
      agentId: "agent-a",
      status: "running",
    });
    const second = testChannelAgentReply("reply-b", {
      agentId: "agent-b",
      status: "running",
      updatedAt: "2026-08-01T02:00:00.000Z",
    });
    let registry!: AtomRegistry;
    ({ cleanup, registry } = await renderHarness((target) =>
      writeChannelAgentReplies(target, channelId, [first, second]),
    ));

    act(() => {
      applyIncomingChannelAgentReplies(
        registry,
        channelId,
        [
          { ...first, status: "completed", updatedAt: "2026-08-01T02:00:00.000Z" },
          { ...second, status: "queued", updatedAt: "2026-08-01T01:00:00.000Z" },
        ],
        false,
      );
    });

    const replies = registry.get(channelAgentRepliesAtom(channelId));
    expect(
      replies
        .filter(
          (reply: ChannelAgentReply) =>
            reply.status === "queued" || reply.status === "running",
        )
        .map((reply: ChannelAgentReply) => reply.id),
    ).toEqual(["reply-b"]);
    expect(replies.find((reply) => reply.id === "reply-b")?.status).toBe(
      "running",
    );
  });

  it("toasts a newly failed Agent reply instead of setting a banner error", async () => {
    loadChannelDelta.mockResolvedValueOnce(
      delta({
        agentReplies: [
          testChannelAgentReply("reply-a", {
            status: "failed",
            error: channelReplyProviderUsageExhaustedError,
            updatedAt: "2026-08-01T02:00:00.000Z",
          }),
        ],
      }),
    );
    ({ cleanup } = await renderHarness((target) =>
      writeChannelAgentReplies(target, channelId, [
        testChannelAgentReply("reply-a", { status: "running" }),
      ]),
    ));

    await emitCursor(1);

    const toast = document.body.querySelector('[data-testid="app-toast"]');
    expect(toast?.className).toContain("error");
    expect(toast?.textContent).toContain("Briar could not reply");
    expect(toast?.textContent).toContain("usage limit");
  });

  it("does not toast an Agent reply that was already failed", async () => {
    const failed = testChannelAgentReply("reply-a", {
      status: "failed",
      error: channelReplyProviderUsageExhaustedError,
    });
    loadChannelDelta.mockResolvedValueOnce(delta({ agentReplies: [failed] }));
    ({ cleanup } = await renderHarness((target) =>
      writeChannelAgentReplies(target, channelId, [failed]),
    ));

    await emitCursor(1);

    expect(document.body.querySelector('[data-testid="app-toast"]')).toBeNull();
  });
});
