/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import * as api from "../lib/api";
import type { ChannelSummary } from "../lib/channels-contract";
import { demoDashboard } from "../lib/demo-data";
import { demoTeamAgents } from "../lib/demo-team-agents";
import { activeChannelIdAtom } from "../state/channels/atoms";
import {
  activePageAtom,
  companionPageAtom,
  navigationChannelIdAtom,
} from "../state/navigation/atoms";
import { activeWorkspaceIdAtom } from "../state/workspace/atoms";
import { createTestRegistry, type AtomRegistry } from "../state/registry";
import { createReactTestRoot, flush } from "../test/react";
import type { TeamAgentBoard } from "../types";
import { TeamAgentDetail } from "./TeamAgentDetail";

/*
  The Agent's own page, as the phone draws it.

  Its "conversations" section is one of the two ways into an Agent-to-Agent
  conversation, so the phone gets it too — and lands on the same read-only view
  the desktop does, by the route its shell understands: the companion page atom
  plus the selected channel, where the desktop records a visit instead.
*/

const board: TeamAgentBoard = {
  team: demoDashboard.team,
  runs: [],
  workers: demoDashboard.workers,
  executionPolicy: demoDashboard.executionPolicy,
};

const agent = demoTeamAgents(board.team.id, "en")[0]!;

const conversation: ChannelSummary = {
  id: "agent-dm-1",
  workspaceId: board.team.workspaceId,
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
    { type: "agent", id: agent.id, name: agent.name, image: null },
    { type: "agent", id: "agent-b", name: "Bay", image: null },
  ],
  pinnedAt: null,
  sidebarSectionId: null,
  hiddenAt: null,
  readOnly: true,
};

const renderDetail = async (
  registry: AtomRegistry,
  { companionMode }: { companionMode: boolean },
) => {
  const view = createReactTestRoot();
  await view.render(
    <RegistryContext.Provider value={registry}>
      <I18nProvider>
        <TeamAgentDetail
          agent={agent}
          board={board}
          companionMode={companionMode}
          isSidebarOpen
          onBack={() => undefined}
          onIssueOpen={() => undefined}
          onSettleTaskSession={() => undefined}
          onStartAutoHunt={() => "run-1"}
          onStartTaskSession={() => undefined}
          onStopSession={async () => true}
          requestedSessionId={null}
          token="token"
        />
      </I18nProvider>
    </RegistryContext.Provider>,
  );
  return view;
};

/** Opens the disclosure and settles the list it asks for. */
const openConversations = async (container: HTMLElement) => {
  const toggle = container.querySelector<HTMLButtonElement>(
    ".agent-conversations button[aria-expanded]",
  );
  await act(async () => toggle?.click());
  await flush();
  return container.querySelector<HTMLButtonElement>(
    ".agent-conversations-body li button",
  );
};

beforeEach(() => {
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
  window.localStorage.setItem("briar.locale.v1", "en");
  vi.spyOn(api, "listAgentDirectMessages").mockResolvedValue({
    channels: [conversation],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TeamAgentDetail conversations", () => {
  it("opens the conversation on the phone's direct message page", async () => {
    const registry = createTestRegistry([
      [activeWorkspaceIdAtom, board.team.workspaceId],
    ]);
    const view = await renderDetail(registry, { companionMode: true });

    const row = await openConversations(view.container);
    expect(row?.textContent).toContain("Bay");

    await act(async () => row?.click());

    expect(registry.get(companionPageAtom)).toBe("dms");
    expect(registry.get(activeChannelIdAtom)).toBe(conversation.id);

    await view.cleanup();
  });

  it("still records a visit on the desktop", async () => {
    const registry = createTestRegistry([
      [activeWorkspaceIdAtom, board.team.workspaceId],
    ]);
    const view = await renderDetail(registry, { companionMode: false });

    const row = await openConversations(view.container);
    await act(async () => row?.click());

    expect(registry.get(activePageAtom)).toBe("dms");
    expect(registry.get(navigationChannelIdAtom)).toBe(conversation.id);
    expect(registry.get(activeChannelIdAtom)).toBe(conversation.id);

    await view.cleanup();
  });
});
