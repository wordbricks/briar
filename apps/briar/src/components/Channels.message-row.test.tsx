/** @vitest-environment jsdom */

import { act, memo, useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n";
import { createReactTestRoot } from "../test/react";
import { createRenderCounter } from "../test/render-count";
import type { ChannelMessage, ChannelSummary } from "../lib/channels-contract";
import {
  MessageRow,
  type MessageRowHandlers,
} from "./Channels";

/*
  The memo boundary of a channel message.

  Every handler a row needs used to arrive as an inline arrow function closing
  over that row's own message, so each of a dozen props was a new value on every
  render of the list and `memo` compared nothing but identities that always
  differed. The row binds its own message now and the list hands it one stable
  bundle, which is what makes the comparison mean something: a new message
  renders one row, not all of them.
*/

const channel: ChannelSummary = {
  id: "channel-1",
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
};

const messageOf = (index: number): ChannelMessage => ({
  id: `message-${index}`,
  channelId: channel.id,
  parentMessageId: null,
  author: {
    type: "user",
    id: "user-1",
    name: "Sam",
    email: "sam@example.com",
    image: null,
  },
  body: `Message ${index}`,
  blocks: [],
  mentionedUserIds: [],
  mentionedAgentIds: [],
  attachments: [],
  reactions: [],
  replyCount: 0,
  lastReplyAt: null,
  replyAuthors: [],
  subscribers: [],
  document: null,
  proposal: null,
  executionProposal: null,
  skillExecutionProposal: null,
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

const noTyping: string[] = [];
const noActivity = {};
const noAgents: never[] = [];
const noMembers: never[] = [];
const noProjects: never[] = [];

const renderCounter = createRenderCounter();
/*
  A counter inside a memoised component cannot be read from outside it, so the
  boundary is measured by repeating it: this wrapper memoises the same props
  with the same shallow comparison `MessageRow` uses, and counts the renders
  that get through. A count of one is a row whose props actually changed.
*/
const TrackedRow = memo(renderCounter.track("row", MessageRow));

let append: ((message: ChannelMessage) => void) | null = null;

function MessageList({ initial }: { readonly initial: ChannelMessage[] }) {
  const [messages, setMessages] = useState(initial);
  append = (message) => setMessages((current) => [...current, message]);
  return (
    <>
      {messages.map((message) => (
        <TrackedRow
          acceptingProposal={false}
          agents={noAgents}
          busy={false}
          channel={channel}
          currentUserId="user-1"
          decliningProposal={false}
          handlers={handlers}
          key={message.id}
          loadCreateExecutionProposalContext={unusedHandler}
          localeTag="en-US"
          members={noMembers}
          message={message}
          projects={noProjects}
          selectedProjectId={null}
          token="token"
          typingActivityByAgentName={noActivity}
          typingAgentNames={noTyping}
        />
      ))}
    </>
  );
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("briar.locale.v1", "en");
  renderCounter.reset();
  append = null;
});

describe("MessageRow", () => {
  it("is memoised", () => {
    // The render counts below measure a wrapper that repeats this comparison,
    // so they only mean anything while the row itself is memoised.
    expect((MessageRow as { $$typeof?: symbol }).$$typeof).toBe(
      Symbol.for("react.memo"),
    );
  });

  it("renders only the new row when a message arrives", async () => {
    const view = createReactTestRoot();
    await view.render(
      <I18nProvider>
        <MessageList initial={[messageOf(1), messageOf(2), messageOf(3)]} />
      </I18nProvider>,
    );
    expect(renderCounter.count("row")).toBe(3);
    renderCounter.reset();

    await act(async () => {
      append?.(messageOf(4));
    });

    expect(view.container.textContent).toContain("Message 4");
    // The three rows that did not change kept their memoised output.
    expect(renderCounter.count("row")).toBe(1);
    await view.cleanup();
  });

  it("re-renders the one row whose message was edited", async () => {
    const view = createReactTestRoot();
    const messages = [messageOf(1), messageOf(2)];
    await view.render(
      <I18nProvider>
        <MessageList initial={messages} />
      </I18nProvider>,
    );
    renderCounter.reset();

    await act(async () => {
      append?.({ ...messageOf(2), id: "message-3", body: "Edited" });
    });

    expect(view.container.textContent).toContain("Edited");
    expect(renderCounter.count("row")).toBe(1);
    await view.cleanup();
  });
});
