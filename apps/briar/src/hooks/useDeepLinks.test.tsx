/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { ToastProvider } from "../components/ui/toast";
import { I18nProvider } from "../i18n";
import type { ChannelSummary } from "../lib/channels-contract";
import { demoDashboard } from "../lib/demo-data";
import { activeOrganizationIdAtom, organizationsAtom } from "../state/organization/atoms";
import { lockedTeamIdAtom } from "../state/platform";
import { createTestRegistry, type AtomRegistry } from "../state/registry";
import { loadingAtom, tokenAtom, userAtom } from "../state/session/atoms";
import { applySyncEvent } from "../state/sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../state/team/atoms";
import {
  activeChannelIdAtom,
  channelCatalogCursorAtom,
  requestedChannelMessageAtom,
} from "../state/channels/atoms";
import {
  pendingBriarLinkAtom,
  pendingInboxNotificationTargetAtom,
  requestedRunIdAtom,
  requestedRunInitialTabAtom,
  requestedRunMessageIdAtom,
  requestedSessionIdAtom,
} from "../state/navigation/atoms";
import { createReactTestRoot } from "../test/react";
import type { Organization, Project, SessionUser } from "../types";
import {
  useDeepLinks,
  type DeepLinkListeners,
  type UseDeepLinksInput,
} from "./useDeepLinks";

/*
  The resolver's branches, driven through the atoms it waits on.

  Every case here is a "the target arrived before the thing it needs" story,
  which is what the shell's version made hard to see: a channel link that has to
  wait for the catalog, an issue link for a team this account cannot open, a
  notification for a team that is not selected yet.
*/

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

const organization: Organization = {
  id: "org-a",
  name: "Org A",
  handle: "org-a",
  logo: null,
  role: "owner",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const teamA: Project = {
  ...demoDashboard.team,
  id: "team-a",
  name: "Team A",
  organizationId: organization.id,
};
const teamB: Project = { ...teamA, id: "team-b", name: "Team B" };

const channel = (overrides: Partial<ChannelSummary> = {}): ChannelSummary => ({
  id: "channel-1",
  organizationId: organization.id,
  kind: "channel",
  slug: "general",
  name: "General",
  topic: null,
  visibility: "public",
  defaultProjectId: null,
  archivedAt: null,
  memberCount: 1,
  agentCount: 0,
  createdByUserId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastMessageAt: null,
  lastMessagePreview: null,
  lastReadAt: null,
  hasUnread: false,
  dmParticipants: [],
  ...overrides,
});

interface Recorder {
  readonly channels: { channelId: string; page: string }[];
  readonly issues: { runId: string; teamId?: string | null }[];
  readonly pages: string[];
  readonly replaced: unknown[];
  readonly ensured: string[];
  readonly selectedOrganizations: string[];
  readonly selectedTeams: string[];
  readonly inboxReads: string[];
}

const recorder = (): Recorder => ({
  channels: [],
  issues: [],
  pages: [],
  replaced: [],
  ensured: [],
  selectedOrganizations: [],
  selectedTeams: [],
  inboxReads: [],
});

/** Listeners that record their registration and never fire on their own. */
const inertListeners = (): Partial<DeepLinkListeners> => ({
  listenForBriarLinks: () => () => {},
  listenForClickedIssueLinks: () => () => {},
  listenForStatusTrayOpenRun: () => () => {},
  macDesktop: false,
});

function Effects({ input }: { input: UseDeepLinksInput }) {
  useDeepLinks(input);
  return null;
}

const mount = async (registry: AtomRegistry, input: UseDeepLinksInput) => {
  const view = createReactTestRoot();
  await view.render(
    <RegistryContext.Provider value={registry}>
      <I18nProvider>
        <ToastProvider>
          <Effects input={input} />
        </ToastProvider>
      </I18nProvider>
    </RegistryContext.Provider>,
  );
  return view;
};

const flush = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

const harness = (
  overrides: Partial<DeepLinkListeners> = {},
  registryOverrides: {
    activeTeamId?: string | null;
    activeOrganizationId?: string | null;
  } = {},
) => {
  const registry = createTestRegistry([
    [userAtom, user],
    [tokenAtom, null],
    [loadingAtom, false],
    [organizationsAtom, [organization]],
    [
      activeOrganizationIdAtom,
      registryOverrides.activeOrganizationId === undefined
        ? organization.id
        : registryOverrides.activeOrganizationId,
    ],
    [teamsAtom, [teamA, teamB]],
    [
      activeTeamIdAtom,
      registryOverrides.activeTeamId === undefined
        ? teamA.id
        : registryOverrides.activeTeamId,
    ],
    [lockedTeamIdAtom, null],
    [pendingBriarLinkAtom, null],
  ]);
  const calls = recorder();
  const input: UseDeepLinksInput = {
    listeners: { ...inertListeners(), ...overrides },
    navigation: {
      navigateToChannel: (channelId, page) =>
        calls.channels.push({ channelId, page }),
      navigateToIssue: (runId, teamId) => calls.issues.push({ runId, teamId }),
      navigateToPage: (page) => calls.pages.push(page),
      replaceNavigationLocation: (location) => calls.replaced.push(location),
    },
    navigationTeamId: null,
    navigationUserBoundaryChanged: false,
    selectedRunId: null,
    session: {
      ensureTeamSelected: async (teamId) => {
        calls.ensured.push(teamId);
      },
      markInboxRead: (messageId) => calls.inboxReads.push(messageId),
      selectOrganization: (organizationId) => {
        calls.selectedOrganizations.push(organizationId);
        registry.set(activeOrganizationIdAtom, organizationId);
      },
      selectTeam: (teamId) => {
        calls.selectedTeams.push(teamId);
        registry.set(activeTeamIdAtom, teamId);
      },
    },
  };
  return { calls, input, registry };
};

const loadCatalog = (registry: AtomRegistry, channels: ChannelSummary[]) => {
  applySyncEvent(registry, {
    kind: "channel-catalog-snapshot",
    organizationId: organization.id,
    channels,
  });
  registry.set(channelCatalogCursorAtom, 1);
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("briar.locale.v1", "en");
});

describe("useDeepLinks", () => {
  it("waits for the channel catalog before opening a channel link", async () => {
    const { calls, input, registry } = harness();
    const view = await mount(registry, input);

    await act(async () => {
      registry.set(pendingBriarLinkAtom, {
        kind: "channel",
        organizationId: organization.id,
        channelId: "channel-1",
        messageId: null,
        rootMessageId: null,
      });
    });
    await flush();
    // The catalog has not landed, so the link is still pending.
    expect(calls.channels).toEqual([]);
    expect(registry.get(pendingBriarLinkAtom)).not.toBeNull();

    await act(async () => loadCatalog(registry, [channel()]));
    await flush();

    expect(calls.channels).toEqual([
      { channelId: "channel-1", page: "channels" },
    ]);
    expect(registry.get(activeChannelIdAtom)).toBe("channel-1");
    expect(registry.get(pendingBriarLinkAtom)).toBeNull();

    await view.cleanup();
  });

  it("switches organizations first when the link points at another one", async () => {
    const { calls, input, registry } = harness({}, {
      activeOrganizationId: "org-b",
    });
    const view = await mount(registry, input);

    await act(async () => {
      registry.set(pendingBriarLinkAtom, {
        kind: "channel",
        organizationId: organization.id,
        channelId: "channel-1",
        messageId: null,
        rootMessageId: null,
      });
    });
    await flush();

    expect(calls.selectedOrganizations).toEqual([organization.id]);
    expect(calls.channels).toEqual([]);

    await view.cleanup();
  });

  it("ignores a link to an organization the account is not in", async () => {
    const { calls, input, registry } = harness();
    const view = await mount(registry, input);

    await act(async () => {
      registry.set(pendingBriarLinkAtom, {
        kind: "channel",
        organizationId: "org-unknown",
        channelId: "channel-1",
        messageId: null,
        rootMessageId: null,
      });
    });
    await flush();

    expect(calls.selectedOrganizations).toEqual([]);
    expect(calls.channels).toEqual([]);
    expect(registry.get(pendingBriarLinkAtom)).not.toBeNull();

    await view.cleanup();
  });

  it("opens a direct message link on the direct message page", async () => {
    const { calls, input, registry } = harness();
    const view = await mount(registry, input);
    await act(async () => loadCatalog(registry, [channel({ kind: "dm" })]));

    await act(async () => {
      registry.set(pendingBriarLinkAtom, {
        kind: "channel",
        organizationId: organization.id,
        channelId: "channel-1",
        messageId: "message-1",
        rootMessageId: "message-1",
      });
    });
    await flush();

    expect(calls.channels).toEqual([{ channelId: "channel-1", page: "dms" }]);
    expect(registry.get(requestedChannelMessageAtom)).toEqual({
      channelId: "channel-1",
      messageId: "message-1",
      rootMessageId: "message-1",
    });

    await view.cleanup();
  });

  it("opens an issue link through the shared resolver", async () => {
    const { calls, input, registry } = harness();
    const view = await mount(registry, input);

    await act(async () => {
      registry.set(pendingBriarLinkAtom, {
        kind: "issue",
        projectId: teamB.id,
        runId: "run-1",
      });
    });
    await flush();

    expect(calls.ensured).toEqual([teamB.id]);
    expect(calls.issues).toEqual([{ runId: "run-1", teamId: teamB.id }]);
    expect(registry.get(requestedRunIdAtom)).toBe("run-1");
    expect(registry.get(pendingBriarLinkAtom)).toBeNull();

    await view.cleanup();
  });

  it("reports an issue link this window may not follow", async () => {
    const { calls, input, registry } = harness();
    registry.set(lockedTeamIdAtom, teamA.id);
    const view = await mount(registry, input);

    await act(async () => {
      registry.set(pendingBriarLinkAtom, {
        kind: "issue",
        projectId: teamB.id,
        runId: "run-1",
      });
    });
    await flush();

    expect(calls.issues).toEqual([]);
    expect(registry.get(requestedRunIdAtom)).toBeNull();

    await view.cleanup();
  });

  it("opens an agent session link on the agents page", async () => {
    const { calls, input, registry } = harness();
    const view = await mount(registry, input);

    await act(async () => {
      registry.set(pendingBriarLinkAtom, {
        kind: "session",
        projectId: teamA.id,
        sessionId: "session-1",
      });
    });
    await flush();

    expect(calls.pages).toEqual(["agents"]);
    expect(registry.get(requestedSessionIdAtom)).toBe("session-1");
    expect(registry.get(pendingBriarLinkAtom)).toBeNull();

    await view.cleanup();
  });

  it("selects the team a notification points at before routing to it", async () => {
    const { calls, input, registry } = harness({}, { activeTeamId: teamA.id });
    const view = await mount(registry, input);

    await act(async () => {
      registry.set(pendingInboxNotificationTargetAtom, {
        kind: "issue",
        projectId: teamB.id,
        targetId: "run-9",
        messageId: "message-9",
      } as never);
    });
    await flush();

    // The read receipt is sent before the team check, so the pass that
    // switches teams and the pass that routes both send it.
    expect(calls.inboxReads).toEqual(["message-9", "message-9"]);
    expect(calls.selectedTeams).toEqual([teamB.id]);
    expect(calls.issues).toEqual([{ runId: "run-9", teamId: teamB.id }]);
    expect(registry.get(requestedRunIdAtom)).toBe("run-9");
    expect(registry.get(pendingInboxNotificationTargetAtom)).toBeNull();

    await view.cleanup();
  });

  it("opens a conversation notification on the conversation tab", async () => {
    const { input, registry } = harness();
    const view = await mount(registry, input);

    await act(async () => {
      registry.set(pendingInboxNotificationTargetAtom, {
        kind: "conversation",
        projectId: teamA.id,
        targetId: "run-9",
        messageId: "message-9",
        conversationMessageId: "conversation-1",
      } as never);
    });
    await flush();

    expect(registry.get(requestedRunInitialTabAtom)).toBe("conversation");
    expect(registry.get(requestedRunMessageIdAtom)).toBe("conversation-1");

    await view.cleanup();
  });

  it("ignores a notification for a team this account cannot open", async () => {
    const { calls, input, registry } = harness();
    const view = await mount(registry, input);

    await act(async () => {
      registry.set(pendingInboxNotificationTargetAtom, {
        kind: "issue",
        projectId: "team-gone",
        targetId: "run-9",
        messageId: "message-9",
      } as never);
    });
    await flush();

    expect(calls.inboxReads).toEqual([]);
    expect(registry.get(pendingInboxNotificationTargetAtom)).not.toBeNull();

    await view.cleanup();
  });

  it("leaves an issue page whose run is gone", async () => {
    const { calls, input, registry } = harness();
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: teamA.id,
      payload: { ...demoDashboard, team: teamA, runs: [] },
    });
    const view = await mount(registry, {
      ...input,
      navigationTeamId: teamA.id,
      selectedRunId: "run-gone",
    });
    await flush();

    expect(calls.replaced).toHaveLength(1);

    await view.cleanup();
  });
});
