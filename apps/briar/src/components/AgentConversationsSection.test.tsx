/** @vitest-environment jsdom */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import * as api from "../lib/api";
import type { ChannelSummary } from "../lib/channels-contract";
import { createReactTestRoot } from "../test/react";
import { AgentConversationsSection } from "./AgentConversationsSection";

/*
  The Agent detail entry point. An Agent-to-Agent conversation is not in
  anybody's sidebar, so this list and the relay rows are the only two ways to
  reach one; the list is fetched when the section is opened rather than with
  the page around it.
*/

const conversation: ChannelSummary = {
  id: "agent-dm-1",
  organizationId: "org-1",
  slug: "agent-dm-1",
  name: "Ava, Bay",
  topic: null,
  visibility: "private",
  defaultProjectId: null,
  archivedAt: null,
  memberCount: 0,
  agentCount: 2,
  kind: "dm",
  createdByUserId: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  lastMessageAt: "2026-09-02T09:30:00.000Z",
  lastMessagePreview: "Checked. Nothing new.",
  lastReadAt: null,
  hasUnread: false,
  dmParticipants: [
    { type: "agent", id: "agent-a", name: "Ava", image: null },
    { type: "agent", id: "agent-b", name: "Bay", image: null },
  ],
  pinnedAt: null,
  sidebarSectionId: null,
  hiddenAt: null,
  readOnly: true,
};

async function renderSection(channels: ChannelSummary[]) {
  const list = vi
    .spyOn(api, "listAgentDirectMessages")
    .mockResolvedValue({ channels });
  const opened: string[] = [];
  const view = createReactTestRoot();
  await view.render(
    <I18nProvider>
      <AgentConversationsSection
        agentId="agent-a"
        onOpenConversation={(channelId) => opened.push(channelId)}
        organizationId="org-1"
        token="token"
      />
    </I18nProvider>,
  );
  return { list, opened, view };
}

const toggle = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>('button[aria-expanded]');

/** Settles the fetch and every state update it schedules. */
const flush = async () => {
  for (let step = 0; step < 5; step += 1) {
    await act(async () => Promise.resolve());
  }
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("briar.locale.v1", "en");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AgentConversationsSection", () => {
  it("waits for the section to be opened before asking for the list", async () => {
    const { list, view } = await renderSection([conversation]);

    expect(list).not.toHaveBeenCalled();
    expect(toggle(view.container)?.getAttribute("aria-expanded")).toBe("false");

    await view.cleanup();
  });

  it("lists the conversations of one Agent and opens the one clicked", async () => {
    const { list, opened, view } = await renderSection([conversation]);

    await act(async () => toggle(view.container)?.click());
    await flush();

    expect(list).toHaveBeenCalledWith("token", "org-1", "agent-a");
    const row = view.container.querySelector<HTMLButtonElement>(
      ".agent-conversations-body li button",
    );
    // The counterpart, not the Agent whose page this is.
    expect(row?.textContent).toContain("Bay");
    expect(row?.textContent).not.toContain("Ava");
    expect(row?.textContent).toContain("Checked. Nothing new.");

    await act(async () => row?.click());
    expect(opened).toEqual(["agent-dm-1"]);

    await view.cleanup();
  });

  it("says so when the Agent has spoken to no other Agent", async () => {
    const { view } = await renderSection([]);

    await act(async () => toggle(view.container)?.click());
    await flush();

    expect(
      view.container.querySelector(".agent-conversations-empty")?.textContent,
    ).toBe("No conversations with other agents yet.");

    await view.cleanup();
  });
});
