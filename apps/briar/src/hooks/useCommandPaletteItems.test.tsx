/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import type { CommandPaletteItem } from "../components/CommandPalette";
import { I18nProvider } from "../i18n";
import type { ChannelSummary } from "../lib/channels-contract";
import { demoDashboard } from "../lib/demo-data";
import { loadKeybindings } from "../lib/keybindings";
import { channelCatalogCursorAtom } from "../state/channels/atoms";
import { isCommandPaletteOpenAtom } from "../state/dialogs/atoms";
import type { InboxMessage } from "../state/inbox/model";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../state/organization/atoms";
import { lockedTeamIdAtom } from "../state/platform";
import { createNavigationActions } from "../state/navigation/actions";
import { createTestRegistry, type AtomRegistry } from "../state/registry";
import { tokenAtom, userAtom } from "../state/session/atoms";
import { applySyncEvent } from "../state/sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../state/team/atoms";
import { seedInboxMessages } from "../test/inbox";
import { createReactTestRoot } from "../test/react";
import type { Organization, Project, SessionUser } from "../types";
import {
  useCommandPaletteItems,
  type CommandPaletteItemsInput,
} from "./useCommandPaletteItems";

/*
  The palette is built imperatively, so what is worth pinning is the order of
  the conditions rather than every entry: which state makes an item appear at
  all, and which section and priority it lands in when it is the thing the user
  is currently looking at.
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

const team: Project = {
  ...demoDashboard.team,
  id: "team-a",
  name: "Team A",
  organizationId: organization.id,
  issueKeyPrefix: "TA",
};

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
  pinnedAt: null,
  sidebarSectionId: null,
  hiddenAt: null,
  ...overrides,
});

/** One unread issue notification, which is what promotes the inbox entry. */
const unreadInboxMessage = (id: string): InboxMessage => ({
  id,
  kind: "issue",
  projectId: team.id,
  projectName: team.name,
  targetId: "run-1",
  title: "run-1",
  occurredAt: "2026-09-01T00:00:00.000Z",
  version: "1",
  runNumber: 1,
  status: "failed",
  workflowStage: null,
  priority: null,
  structuredResult: null,
});

const baseInput: CommandPaletteItemsInput = {
  commandPaletteAvailable: true,
  keybindings: loadKeybindings(),
  keyboardShortcutsShortcut: "⌘/",
};

function Probe({
  input,
  onItems,
}: {
  input: CommandPaletteItemsInput;
  onItems: (items: CommandPaletteItem[]) => void;
}) {
  onItems(useCommandPaletteItems(input));
  return null;
}

const build = async (
  registry: AtomRegistry,
  overrides: Partial<CommandPaletteItemsInput> = {},
) => {
  let items: CommandPaletteItem[] = [];
  const view = createReactTestRoot();
  await view.render(
    <RegistryContext.Provider value={registry}>
      <I18nProvider>
        <Probe
          input={{ ...baseInput, ...overrides }}
          onItems={(next) => {
            items = next;
          }}
        />
      </I18nProvider>
    </RegistryContext.Provider>,
  );
  await view.cleanup();
  return items;
};

const harness = (open = true): AtomRegistry => {
  const registry = createTestRegistry([
    [userAtom, user],
    [tokenAtom, "token-1"],
    [organizationsAtom, [organization]],
    [activeOrganizationIdAtom, organization.id],
    [teamsAtom, [team]],
    [activeTeamIdAtom, team.id],
    [lockedTeamIdAtom, null],
    [isCommandPaletteOpenAtom, open],
  ]);
  // Where the palette is being opened from is read from the store now. A reset
  // rather than a visit keeps the history empty, which is what the "nowhere to
  // go back to" case below expects.
  createNavigationActions(registry).resetNavigation("issues");
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId: team.id,
    payload: {
      ...demoDashboard,
      team,
      runs: [{ ...demoDashboard.runs[0]!, id: "run-1", title: "Fix it", runNumber: 7 }],
    },
  });
  applySyncEvent(registry, {
    kind: "channel-catalog-snapshot",
    organizationId: organization.id,
    channels: [channel(), channel({ id: "dm-1", kind: "dm", name: "DM" })],
  });
  registry.set(channelCatalogCursorAtom, 1);
  return registry;
};

const ids = (items: CommandPaletteItem[]) => items.map((item) => item.id);

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("briar.locale.v1", "en");
});

describe("useCommandPaletteItems", () => {
  it("builds nothing while the palette is closed", async () => {
    const items = await build(harness(false));
    expect(items).toEqual([]);
  });

  it("builds nothing while a gate owns the screen", async () => {
    const items = await build(harness(), { commandPaletteAvailable: false });
    expect(items).toEqual([]);
  });

  it("offers the selected team's navigation, issues and channels", async () => {
    const items = await build(harness());
    const built = ids(items);
    expect(built).toContain(`navigation:issues:${team.id}`);
    expect(built).toContain(`navigation:agents:${team.id}`);
    expect(built).toContain("issue:run-1");
    expect(built).toContain("channel:channel-1");
    expect(built).toContain("direct-message:dm-1");
    expect(built).toContain(`action:create-issue:${team.id}`);
    expect(built).toContain("action:keyboard-shortcuts");
  });

  it("marks the open issue as current and ranks it first", async () => {
    const registry = harness();
    createNavigationActions(registry).navigateToIssue("run-1", team.id);
    const items = await build(registry);
    const issue = items.find((item) => item.id === "issue:run-1");
    expect(issue?.active).toBe(true);
    expect(issue?.section).toBe("context");
    expect(issue?.priority).toBe(190);
  });

  it("moves an unread channel into the continue section", async () => {
    const registry = harness();
    await act(async () => {
      applySyncEvent(registry, {
        kind: "channel-changed",
        channel: channel({ hasUnread: true }),
      });
    });
    const items = await build(registry);
    const item = items.find((entry) => entry.id === "channel:channel-1");
    expect(item?.section).toBe("continue");
    expect(item?.priority).toBe(130);
  });

  it("promotes the inbox while it has unread messages", async () => {
    const quiet = await build(harness());
    expect(
      quiet.find((item) => item.id === "navigation:inbox")?.section,
    ).toBe("navigation");

    const registry = harness();
    seedInboxMessages(registry, [unreadInboxMessage("m-1")]);
    const busy = await build(registry);
    const inbox = busy.find((item) => item.id === "navigation:inbox");
    expect(inbox?.section).toBe("continue");
    expect(inbox?.priority).toBe(181);
  });

  it("offers history entries only when the history can move", async () => {
    const still = await build(harness());
    expect(ids(still)).not.toContain("navigation:back");

    const registry = harness();
    const actions = createNavigationActions(registry);
    actions.navigateToPage("agents", team.id);
    actions.navigateToPage("lobby", team.id);
    actions.goBack();
    const moved = await build(registry);
    expect(ids(moved)).toContain("navigation:back");
    expect(ids(moved)).toContain("navigation:forward");
  });

  it("hides direct messages and team creation in a project window", async () => {
    const registry = harness();
    registry.set(lockedTeamIdAtom, team.id);
    const items = await build(registry);
    const built = ids(items);
    expect(built).not.toContain("direct-message:dm-1");
    expect(built).not.toContain(`navigation:dms:${organization.id}`);
    expect(built).not.toContain("action:add-project");
  });
});
