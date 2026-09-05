/** @vitest-environment jsdom */

import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n";
import { createReactTestRoot } from "../test/react";
import { createRenderCounter } from "../test/render-count";
import { testChannelMessage } from "../test/channel-conversation";
import type { ChannelMessage, ChannelSummary } from "../lib/channels-contract";
import { createTestRegistry, type AtomRegistry } from "../state/registry";
import { channelRootMessageSummariesAtom } from "../state/channel-conversation/atoms";
import { applySyncEvent } from "../state/sync/apply";
import { writeChannelTimeline } from "../state/channel-conversation/write";
import {
  ChannelMessageRow,
  MessageRow,
  type ChannelMessageRowContext,
  type MessageRowHandlers,
} from "./Channels";

/*
  The subscription boundary of a channel message.

  Every handler a row needs used to arrive as an inline arrow function closing
  over that row's own message, so each of a dozen props was a new value on every
  render and `memo` compared nothing but identities that always differed. Then
  the row bound its own message and the list handed it one stable bundle. Now
  the row does not receive the message at all: it reads it from the store by id,
  and the list reads summaries, so a change to one message reaches one row and
  the list itself is not woken.
*/

const channelId = "channel-1";

const channel: ChannelSummary = {
  id: channelId,
  organizationId: "org-1",
  slug: "general",
  name: "General",
  topic: null,
  visibility: "public",
  defaultProjectId: null,
  archivedAt: null,
  memberCount: 1,
  agentCount: 0,
  kind: "channel",
  createdByUserId: "user-1",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  lastMessageAt: null,
  lastMessagePreview: null,
  lastReadAt: null,
  hasUnread: false,
  dmParticipants: [],
  pinnedAt: null,
  sidebarSectionId: null,
  hiddenAt: null,
};

const messageOf = (index: number): ChannelMessage =>
  testChannelMessage(`message-${index}`, {
    channelId,
    body: `Message ${index}`,
    createdAt: `2026-08-01T00:0${index}:00.000Z`,
  });

const unusedHandler = (() => {
  throw new Error("not called");
}) as never;

/** The stable bundle the list hands every row. */
const handlers: MessageRowHandlers = {
  acceptExecutionProposal: unusedHandler,
  acceptProposal: unusedHandler,
  acceptSkillExecutionProposal: unusedHandler,
  applyAcceptedExecutionProposal: unusedHandler,
  applyAcceptedSkillExecutionProposal: unusedHandler,
  declineProposal: unusedHandler,
  loadExecutionProposalContext: unusedHandler,
  loadSkillExecutionProposalContext: unusedHandler,
  openThread: () => undefined,
  removeMessage: unusedHandler,
  selectProposalProject: () => undefined,
  toggleReaction: unusedHandler,
};

const rowContext: ChannelMessageRowContext = {
  acceptingProposalId: null,
  agents: [],
  busy: false,
  canOpenThread: false,
  channel,
  currentUserId: "user-1",
  decliningProposalId: null,
  handlers,
  highlightedMessageId: null,
  loadCreateExecutionProposalContext: unusedHandler,
  localeTag: "en-US",
  members: [],
  projects: [],
  proposalProjects: {},
  threadParentId: null,
  token: "token",
};

const renderCounter = createRenderCounter();

/**
 * The list as `Channels` renders it: a subscription to the summaries and one
 * row per id. Each row sits under its own `Profiler`, so a count of zero means
 * nothing in that row re-rendered; the list counts its own body.
 */
function MessageList() {
  const summaries = useAtomValue(channelRootMessageSummariesAtom(channelId));
  renderCounter.record("list", null);
  return (
    <>
      {summaries.map((summary) =>
        renderCounter.profile(
          `row:${summary.id}`,
          <ChannelMessageRow
            channelId={channelId}
            context={rowContext}
            key={summary.id}
            messageId={summary.id}
          />,
        ),
      )}
    </>
  );
}

async function renderList(registry: AtomRegistry) {
  const view = createReactTestRoot();
  await view.render(
    <RegistryContext.Provider value={registry}>
      <I18nProvider>
        <MessageList />
      </I18nProvider>
    </RegistryContext.Provider>,
  );
  return view;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("briar.locale.v1", "en");
  renderCounter.reset();
});

describe("ChannelMessageRow", () => {
  it("is memoised", () => {
    // The counts below only mean something while the row is memoised: without
    // it every row would re-render whenever the list did.
    expect((ChannelMessageRow as { $$typeof?: symbol }).$$typeof).toBe(
      Symbol.for("react.memo"),
    );
    expect((MessageRow as { $$typeof?: symbol }).$$typeof).toBe(
      Symbol.for("react.memo"),
    );
  });

  it("renders the message the store holds for its id", async () => {
    const registry = createTestRegistry();
    writeChannelTimeline(registry, channelId, [messageOf(1), messageOf(2)]);

    const view = await renderList(registry);

    expect(view.container.textContent).toContain("Message 1");
    expect(view.container.textContent).toContain("Message 2");
    await view.cleanup();
  });

  it("re-renders one row when one message changes, and not the list", async () => {
    const registry = createTestRegistry();
    writeChannelTimeline(registry, channelId, [
      messageOf(1),
      messageOf(2),
      messageOf(3),
    ]);
    const view = await renderList(registry);
    renderCounter.reset();

    await act(async () => {
      applySyncEvent(registry, {
        kind: "channel-message-changed",
        channelId,
        message: { ...messageOf(2), body: "Edited" },
        includeRepliesInRoot: false,
      });
    });

    expect(view.container.textContent).toContain("Edited");
    /*
      The claim is which boundaries woke, not how many commits each took: a row
      whose message changed commits once for the new value and once more for
      the effects inside it. Nothing else is in the map — not the list, not the
      other two rows.
    */
    expect(Object.keys(renderCounter.counts())).toEqual(["row:message-2"]);
    expect(renderCounter.count("row:message-2")).toBeGreaterThan(0);
    await view.cleanup();
  });

  it("wakes nothing when a page re-sends the same messages", async () => {
    const registry = createTestRegistry();
    writeChannelTimeline(registry, channelId, [messageOf(1), messageOf(2)]);
    const view = await renderList(registry);
    renderCounter.reset();

    await act(async () => {
      applySyncEvent(registry, {
        kind: "channel-messages-page",
        channelId,
        messages: [messageOf(1), messageOf(2)],
        removedMessageIds: [],
        reset: false,
        includeRepliesInRoot: false,
      });
    });

    renderCounter.expectRenderCounts({});
    await view.cleanup();
  });
});
