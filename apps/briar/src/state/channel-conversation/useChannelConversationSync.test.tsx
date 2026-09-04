/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  channelReplyProviderUsageExhaustedError,
  type ChannelAgentReply,
  type ChannelDelta,
} from "../../lib/channels-contract";
import { ToastProvider } from "../../components/ui/toast";
import { I18nProvider } from "../../i18n";
import {
  testChannelAgentReply,
  testChannelMessage,
  testChannelSummary,
} from "../../test/channel-conversation";
import { createReactTestRoot, renderReactTestRoot } from "../../test/react";
import { publishChannelDelta } from "../channels/delta";
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
  What the open conversation does with a page the catalog loop pulled.

  Everything these cases assert came from `use-channel-conversation.test.tsx`:
  a page reaches the timeline, a reset replaces the timeline and the replies, a
  terminal reply survives an older answer arriving after it, and a reply that
  *became* failed raises a toast while one that was already failed does not.
  The pages land in the store rather than in a component's setters, so the
  assertions read the store — and they arrive through `publishChannelDelta`,
  because the loop that calls it belongs to `state/channels` now
  (`useChannelCatalogSync.test.tsx` covers the loop itself).
*/

const channelId = "channel-1";

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
  useChannelConversationSync({
    enabled: true,
    channelId: channel,
    onSelectedChannelRemoved: () => undefined,
  });
  return null;
}

async function renderHarness(seed?: (registry: AtomRegistry) => void) {
  const { cleanup, root } = createReactTestRoot({ attachToDocument: true });
  const registry = createTestRegistry([
    [tokenAtom, "token"],
    [activeOrganizationIdAtom, "org-1"],
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

/** Hands one page to the subscribers, the way the catalog loop does. */
async function publish(registry: AtomRegistry, page: ChannelDelta) {
  await act(async () => {
    publishChannelDelta(registry, page);
  });
}

describe("channel conversation realtime sync", () => {
  let cleanup: (() => Promise<void>) | null = null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    cleanup = null;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (cleanup) await cleanup();
    cleanup = null;
    vi.restoreAllMocks();
  });

  it("applies a page of the shared delta loop to the open channel", async () => {
    let registry!: AtomRegistry;
    ({ cleanup, registry } = await renderHarness((target) =>
      writeChannelTimeline(target, channelId, []),
    ));

    await publish(registry, delta({ messages: [testChannelMessage("realtime")] }));

    expect(
      registry.get(channelRootMessagesAtom(channelId)).map((item) => item.id),
    ).toEqual(["realtime"]);
  });

  it("replaces stale messages and replies on a reset delta", async () => {
    const fresh = testChannelAgentReply("reply-fresh", { status: "running" });
    let registry!: AtomRegistry;
    ({ cleanup, registry } = await renderHarness((target) => {
      writeChannelTimeline(target, channelId, [testChannelMessage("stale")]);
      writeChannelAgentReplies(target, channelId, [
        testChannelAgentReply("reply-stale"),
      ]);
    }));

    await publish(
      registry,
      delta({
        cursor: 8,
        reset: true,
        channels: [testChannelSummary(channelId)],
        messages: [testChannelMessage("fresh")],
        agentReplies: [fresh],
      }),
    );

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
    let registry!: AtomRegistry;
    ({ cleanup, registry } = await renderHarness((target) =>
      writeChannelTimeline(target, channelId, []),
    ));

    await publish(registry, delta({ agentReplies: [completed] }));
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
    let registry!: AtomRegistry;
    ({ cleanup, registry } = await renderHarness((target) =>
      writeChannelAgentReplies(target, channelId, [
        testChannelAgentReply("reply-a", { status: "running" }),
      ]),
    ));

    await publish(
      registry,
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
    let registry!: AtomRegistry;
    ({ cleanup, registry } = await renderHarness((target) =>
      writeChannelAgentReplies(target, channelId, [failed]),
    ));

    await publish(registry, delta({ agentReplies: [failed] }));

    expect(document.body.querySelector('[data-testid="app-toast"]')).toBeNull();
  });
});
