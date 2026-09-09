/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n";
import { createReactTestRoot } from "../test/react";
import { testChannelMessage } from "../test/channel-conversation";
import type {
  ChannelMessage,
  ChannelMessageRelay,
  ChannelSummary,
} from "../lib/channels-contract";
import { createTestRegistry } from "../state/registry";
import { MessageRow, type MessageRowHandlers } from "./Channels";

/*
  The one row an Agent-to-Agent round trip leaves in the person's own
  conversation: the notice saying the request went out. The other Agent's
  answer never reaches the timeline — it is read by the Agent that asked, which
  then speaks for itself — so the notice is also the only way from here into
  the read-only Agent-to-Agent conversation.
*/

const channel: ChannelSummary = {
  id: "channel-1",
  organizationId: "org-1",
  slug: "dm",
  name: "Direct message",
  topic: null,
  visibility: "private",
  defaultProjectId: null,
  archivedAt: null,
  memberCount: 1,
  agentCount: 1,
  kind: "dm",
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
  readOnly: false,
};

const relay = (
  overrides: Partial<ChannelMessageRelay> = {},
): ChannelMessageRelay => ({
  direction: "outbound",
  peerChannelId: "agent-dm-1",
  peerMessageId: "peer-message-1",
  peerAgentId: "agent-b",
  peerAgentName: "Bay",
  peerAgentImage: null,
  status: "completed",
  ...overrides,
});

const unusedHandler = (() => {
  throw new Error("not called");
}) as never;

const createHandlers = (
  opened: ChannelMessageRelay[],
): MessageRowHandlers => ({
  acceptExecutionProposal: unusedHandler,
  acceptProposal: unusedHandler,
  acceptSkillExecutionProposal: unusedHandler,
  applyAcceptedExecutionProposal: unusedHandler,
  applyAcceptedSkillExecutionProposal: unusedHandler,
  declineProposal: unusedHandler,
  loadExecutionProposalContext: unusedHandler,
  loadSkillExecutionProposalContext: unusedHandler,
  openThread: () => undefined,
  openRelay: (value) => opened.push(value),
  removeMessage: unusedHandler,
  selectProposalProject: () => undefined,
  toggleReaction: unusedHandler,
});

async function renderRow(
  message: ChannelMessage,
  { canOpenRelay = true }: { canOpenRelay?: boolean } = {},
) {
  const opened: ChannelMessageRelay[] = [];
  const view = createReactTestRoot();
  await view.render(
    <RegistryContext.Provider value={createTestRegistry()}>
      <I18nProvider>
        <MessageRow
          acceptingProposal={false}
          agents={[]}
          busy={false}
          canOpenRelay={canOpenRelay}
          channel={channel}
          currentUserId="user-1"
          decliningProposal={false}
          handlers={createHandlers(opened)}
          loadCreateExecutionProposalContext={unusedHandler}
          localeTag="en-US"
          members={[]}
          message={message}
          projects={[]}
          selectedProjectId={null}
          showTypingState={false}
          token="token"
        />
      </I18nProvider>
    </RegistryContext.Provider>,
  );
  return { opened, view };
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("briar.locale.v1", "en");
});

describe("MessageRow relay rows", () => {
  it("renders an outbound relay as a notice naming the other Agent", async () => {
    const { opened, view } = await renderRow(
      testChannelMessage("message-1", {
        body: "Check the ticker now",
        relay: relay(),
      }),
    );

    const notice = view.container.querySelector(".channel-relay-notice");
    expect(notice).not.toBeNull();
    expect(notice?.getAttribute("data-relay-direction")).toBe("outbound");
    expect(notice?.textContent).toContain("Message sent → Bay");
    // The notice replaces the bubble: the text it stands for lives in the
    // Agent conversation, and hangs off the row for a reader who hovers it.
    expect(view.container.querySelector(".channel-message")).toBeNull();
    const open = view.container.querySelector<HTMLButtonElement>(
      ".channel-relay-open",
    );
    expect(open?.title).toBe("Check the ticker now");

    await act(async () => open?.click());
    expect(opened.map((value) => value.peerChannelId)).toEqual(["agent-dm-1"]);
    expect(opened[0]?.peerMessageId).toBe("peer-message-1");

    await view.cleanup();
  });

  it("shows the other Agent working while the round trip is pending", async () => {
    const { view } = await renderRow(
      testChannelMessage("message-1", { relay: relay({ status: "pending" }) }),
    );

    const notice = view.container.querySelector(".channel-relay-notice");
    expect(notice?.getAttribute("data-relay-status")).toBe("pending");
    expect(notice?.textContent).toContain("Bay is checking");
    expect(notice?.querySelector(".animate-spin")).not.toBeNull();

    await view.cleanup();
  });

  it("warns when the message never reached the other Agent", async () => {
    const { view } = await renderRow(
      testChannelMessage("message-1", { relay: relay({ status: "failed" }) }),
    );

    const notice = view.container.querySelector(".channel-relay-notice");
    expect(notice?.getAttribute("data-relay-status")).toBe("failed");
    expect(notice?.textContent).toContain(
      "The message to Bay could not be delivered.",
    );

    await view.cleanup();
  });

  it("leaves the rows inert where the view cannot navigate", async () => {
    const { opened, view } = await renderRow(
      testChannelMessage("message-1", { relay: relay() }),
      { canOpenRelay: false },
    );

    const open = view.container.querySelector<HTMLButtonElement>(
      ".channel-relay-open",
    );
    expect(open?.disabled).toBe(true);
    await act(async () => open?.click());
    expect(opened).toEqual([]);

    await view.cleanup();
  });
});
