/** @vitest-environment jsdom */

import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n";
import { createReactTestRoot } from "../test/react";
import { createRenderCounter } from "../test/render-count";
import {
  testChannelAgent,
  testChannelAgentReply,
  testChannelMessage,
} from "../test/channel-conversation";
import { createTestRegistry, type AtomRegistry } from "../state/registry";
import { channelRootMessageSummariesAtom } from "../state/channel-conversation/atoms";
import { channelAgentActivityAtom } from "../state/channel-conversation/activity";
import { applySyncEvent } from "../state/sync/apply";
import {
  writeChannelParticipants,
  writeChannelTimeline,
} from "../state/channel-conversation/write";
import { ChannelMessageTypingPlaceholder } from "./ChannelTypingPlaceholder";
import { ChannelMessageTypingStrip } from "./ChannelTypingStrip";

/*
  The subscription boundary of the typing strip, and the two surfaces' split.

  An agent that is "typing" is a queued or running reply, and a reply ticks
  every few seconds while it works. The conversation derived the strip from a
  `replies` prop, so each of those ticks re-rendered the timeline and its
  chrome to move a three-word line. The strip subscribes now: a tick reaches it
  and nothing else.

  What each surface draws from that differs. A channel names the pending reply
  whether or not the activity socket has said anything — a runner may publish
  no commentary at all, and on a channel that reads as the mention having gone
  nowhere. A DM's placeholder row is commentary-only: no frame, no row.
*/

const channelId = "channel-1";
const renderCounter = createRenderCounter();

/** The list around the strip: a summaries subscription and a message body. */
function Conversation() {
  const summaries = useAtomValue(channelRootMessageSummariesAtom(channelId));
  renderCounter.record("list", null);
  return (
    <>
      {summaries.map((summary) => (
        <div key={summary.id}>
          {renderCounter.profile(
            `body:${summary.id}`,
            <p>{summary.id}</p>,
          )}
          {renderCounter.profile(
            `typing:${summary.id}`,
            <ChannelMessageTypingStrip
              channelId={channelId}
              messageId={summary.id}
            />,
          )}
        </div>
      ))}
    </>
  );
}

async function renderConversation(registry: AtomRegistry) {
  const view = createReactTestRoot();
  await view.render(
    <RegistryContext.Provider value={registry}>
      <I18nProvider>
        <Conversation />
      </I18nProvider>
    </RegistryContext.Provider>,
  );
  return view;
}

function seededRegistry() {
  const registry = createTestRegistry();
  writeChannelTimeline(registry, channelId, [
    testChannelMessage("message-1"),
    testChannelMessage("message-2", {
      createdAt: "2026-08-01T02:00:00.000Z",
    }),
  ]);
  writeChannelParticipants(registry, channelId, {
    agents: [testChannelAgent("agent-1", { name: "Scout" })],
  });
  return registry;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("briar.locale.v1", "en");
  renderCounter.reset();
});

describe("ChannelMessageTypingStrip", () => {
  it("names a pending reply, upgrades it with activity, re-renders only that strip", async () => {
    const registry = seededRegistry();
    const view = await renderConversation(registry);
    renderCounter.reset();

    await act(async () => {
      applySyncEvent(registry, {
        kind: "channel-agent-replies-changed",
        channelId,
        replies: [
          testChannelAgentReply("reply-1", {
            parentMessageId: "message-1",
            status: "running",
          }),
        ],
        reset: false,
      });
    });

    expect(view.container.textContent).toContain("Scout is writing a reply");
    expect(view.container.textContent).not.toContain("·");

    renderCounter.reset();
    await act(async () => {
      registry.set(channelAgentActivityAtom(channelId), new Map([
        ["reply-1", {
          replyJobId: "reply-1",
          attempt: 1,
          sequence: 1,
          organizationId: "organization-1",
          channelId,
          agentId: "agent-1",
          triggerMessageId: "message-1",
          parentMessageId: "message-1",
          activity: {
            id: "commentary-1",
            kind: "message",
            headline: "Checking the repository tests",
          },
          sentAt: "2026-08-01T01:00:00.000Z",
          expiresAt: "2099-08-01T01:00:00.000Z",
        }],
      ]));
    });

    expect(view.container.textContent).toContain(
      "Scout · Checking the repository tests",
    );
    /*
      The claim is which boundaries woke. Neither message body, neither other
      strip, and not the list around them — only the strip under the message an
      agent is answering.
    */
    expect(Object.keys(renderCounter.counts())).toEqual(["typing:message-1"]);

    await act(async () => {
      registry.set(channelAgentActivityAtom(channelId), new Map([
        ["reply-1", {
          replyJobId: "reply-1",
          attempt: 1,
          sequence: 2,
          organizationId: "organization-1",
          channelId,
          agentId: "agent-1",
          triggerMessageId: "message-1",
          parentMessageId: "message-1",
          activity: null,
          sentAt: "2026-08-01T01:00:01.000Z",
          expiresAt: "2099-08-01T01:00:01.000Z",
        }],
      ]));
    });
    /*
      The tombstone takes the headline back, not the agent. The reply is still
      running, so the channel says so in the words it had before one arrived.
    */
    expect(view.container.textContent).toContain("Scout is writing a reply");
    expect(view.container.textContent).not.toContain(
      "Checking the repository tests",
    );
    await view.cleanup();
  });

  /*
    An expired frame leaves the socket map upstream (`use-agent-activity.ts`
    drops it), and a frame from an earlier attempt is dropped here. Either way
    the line must go back to the generic one rather than keep describing work
    that is no longer running.
  */
  it("falls back to the generic line for a frame from an earlier attempt", async () => {
    const registry = seededRegistry();
    const view = await renderConversation(registry);

    await act(async () => {
      applySyncEvent(registry, {
        kind: "channel-agent-replies-changed",
        channelId,
        replies: [
          testChannelAgentReply("reply-1", {
            parentMessageId: "message-1",
            status: "running",
            attempts: 2,
          }),
        ],
        reset: false,
      });
      registry.set(channelAgentActivityAtom(channelId), new Map([
        ["reply-1", {
          replyJobId: "reply-1",
          attempt: 1,
          sequence: 1,
          organizationId: "organization-1",
          channelId,
          agentId: "agent-1",
          triggerMessageId: "message-1",
          parentMessageId: "message-1",
          activity: {
            id: "commentary-1",
            kind: "message",
            headline: "Work from the attempt that failed",
          },
          sentAt: "2026-08-01T01:00:00.000Z",
          expiresAt: "2099-08-01T01:00:00.000Z",
        }],
      ]));
    });

    expect(view.container.textContent).toContain("Scout is writing a reply");
    expect(view.container.textContent).not.toContain(
      "Work from the attempt that failed",
    );
    await view.cleanup();
  });

  it("wakes nothing when a reply that changed nothing is re-sent", async () => {
    const registry = seededRegistry();
    const reply = testChannelAgentReply("reply-1", {
      parentMessageId: "message-1",
      status: "running",
    });
    applySyncEvent(registry, {
      kind: "channel-agent-replies-changed",
      channelId,
      replies: [reply],
      reset: false,
    });
    const view = await renderConversation(registry);
    renderCounter.reset();

    await act(async () => {
      applySyncEvent(registry, {
        kind: "channel-agent-replies-changed",
        channelId,
        replies: [reply],
        reset: false,
      });
    });

    renderCounter.expectRenderCounts({});
    await view.cleanup();
  });
});

describe("ChannelMessageTypingPlaceholder", () => {
  async function renderPlaceholder(registry: AtomRegistry) {
    const view = createReactTestRoot();
    await view.render(
      <RegistryContext.Provider value={registry}>
        <I18nProvider>
          <ChannelMessageTypingPlaceholder
            channelId={channelId}
            localeTag="en-US"
            messageId="message-1"
          />
        </I18nProvider>
      </RegistryContext.Provider>,
    );
    return view;
  }

  /*
    The DM half of the split. A placeholder row is message-shaped — avatar,
    name, time — so an empty one promises a message that is not being written
    yet. The channel strip's generic line has no such shape and stays.
  */
  it("renders nothing for a pending reply that has published no activity", async () => {
    const registry = seededRegistry();
    applySyncEvent(registry, {
      kind: "channel-agent-replies-changed",
      channelId,
      replies: [
        testChannelAgentReply("reply-1", {
          parentMessageId: "message-1",
          status: "running",
        }),
      ],
      reset: false,
    });
    const view = await renderPlaceholder(registry);

    expect(view.container.textContent).toBe("");

    await act(async () => {
      registry.set(channelAgentActivityAtom(channelId), new Map([
        ["reply-1", {
          replyJobId: "reply-1",
          attempt: 1,
          sequence: 1,
          organizationId: "organization-1",
          channelId,
          agentId: "agent-1",
          triggerMessageId: "message-1",
          parentMessageId: "message-1",
          activity: {
            id: "commentary-1",
            kind: "message",
            headline: "Checking the repository tests",
          },
          sentAt: "2026-08-01T01:00:00.000Z",
          expiresAt: "2099-08-01T01:00:00.000Z",
        }],
      ]));
    });

    expect(view.container.textContent).toContain(
      "Scout · Checking the repository tests",
    );
    await view.cleanup();
  });
});
