/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import type {
  ChannelAgentSummary,
  ChannelMember,
  ChannelMessage,
} from "../lib/channels-contract";
import { ChannelMessageText } from "./ChannelMessageText";
import { ProfileDialog } from "./ProfileDialog";

const member: ChannelMember = {
  userId: "member-1",
  name: "Member One",
  email: "member@example.com",
  image: null,
  role: "member",
  createdAt: "2026-08-01T00:00:00.000Z",
};

const agent: ChannelAgentSummary = {
  agentId: "agent-1",
  handle: "honey",
  name: "Honey",
  provider: "claude",
  model: "sonnet",
  effort: null,
  skills: [],
  projectId: null,
  responsibility: "Writing partner",
  createdAt: "2026-08-01T00:00:00.000Z",
};

const message: ChannelMessage = {
  id: "message-1",
  channelId: "channel-1",
  parentMessageId: null,
  author: {
    type: "user",
    id: "author-1",
    name: "Jay",
    email: "jay@example.com",
    image: null,
  },
  body: "@member please ask @honey; @typed is plain text.",
  mentionedUserIds: [member.userId],
  mentionedAgentIds: [agent.agentId],
  attachments: [],
  replyCount: 0,
  lastReplyAt: null,
  document: null,
  proposal: null,
  createdAt: "2026-08-01T01:00:00.000Z",
};

describe("ChannelMessageText", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("links structured channel mentions and opens their profiles", async () => {
    await act(async () => {
      root.render(
        <I18nProvider>
          <ChannelMessageText
            agents={[agent]}
            members={[member]}
            message={message}
          />
        </I18nProvider>,
      );
    });

    const links = container.querySelectorAll<HTMLAnchorElement>(
      "a.channel-mention-link",
    );
    expect([...links].map((link) => link.textContent)).toEqual([
      "@member",
      "@honey",
    ]);
    expect(container.textContent).toContain("@typed is plain text");

    await act(async () => links[0].click());
    const profile = document.body.querySelector<HTMLElement>(
      ".profile-dialog[role='dialog']",
    );
    expect(profile?.textContent).toContain("Member One");
    expect(profile?.textContent).toContain("member@example.com");
    expect(profile?.textContent).toContain("Channel member");

    expect(links[1].getAttribute("href")).toBe("briar-mention://honey");
  });

  it("shows the Agent's runtime and responsibility on its profile", async () => {
    await act(async () => {
      root.render(
        <I18nProvider>
          <ProfileDialog
            onOpenChange={() => undefined}
            profile={{
              type: "agent",
              id: agent.agentId,
              name: agent.name,
              handle: agent.handle,
              provider: agent.provider,
              model: agent.model,
              responsibility: agent.responsibility,
              skills: [
                {
                  id: "skill-1",
                  agentId: agent.agentId,
                  name: "Issue processing",
                  instructions: "Process queued issues.",
                  provider: "codex",
                  model: "gpt-5.6-sol",
                  effort: "high",
                  kind: "issue_processing",
                  isDefault: true,
                  position: 0,
                  createdAt: agent.createdAt,
                  updatedAt: agent.createdAt,
                },
              ],
              projectId: agent.projectId,
              createdAt: agent.createdAt,
            }}
          />
        </I18nProvider>,
      );
    });

    const profile = document.body.querySelector<HTMLElement>(
      ".profile-dialog[role='dialog']",
    );
    expect(profile?.textContent).toContain("Honey");
    expect(profile?.textContent).toContain("Writing partner");
    expect(profile?.textContent).toContain("codex · gpt-5.6-sol");
    expect(profile?.textContent).not.toContain("claude · sonnet");
  });
});
