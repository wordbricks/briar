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
import { applySyncEvent } from "../state/sync/apply";
import {
  writeChannelParticipants,
  writeChannelTimeline,
} from "../state/channel-conversation/write";
import { ChannelMessageTypingStrip } from "./ChannelTypingStrip";

/*
  The subscription boundary of the typing strip.

  An agent that is "typing" is a queued or running reply, and a reply ticks
  every few seconds while it works. The conversation derived the strip from a
  `replies` prop, so each of those ticks re-rendered the timeline and its
  chrome to move a three-word line. The strip subscribes now: a tick reaches it
  and nothing else.
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
  it("re-renders only the strip of the message being answered", async () => {
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

    expect(view.container.textContent).toContain("Scout");
    /*
      The claim is which boundaries woke. Neither message body, neither other
      strip, and not the list around them — only the strip under the message an
      agent is answering.
    */
    expect(Object.keys(renderCounter.counts())).toEqual(["typing:message-1"]);
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
