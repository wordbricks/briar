import {
  Activity,
  Bot,
  Building2,
  CalendarDays,
  FolderKanban,
  Hash,
  House,
  Inbox as InboxIcon,
  ListTodo,
  MessageCircle,
  Settings,
} from "lucide-react";

import { appSettingsNavigationGroups } from "../components/app-settings-navigation";
import type { WindowNavigationHistoryItem } from "../components/WindowNavigationControls";
import type { MessageKey } from "../i18n/messages";
import {
  channelIdFromNavigationLocation,
  isProjectNavigationPage,
  organizationIdFromNavigationLocation,
  pageFromNavigationLocation,
  projectIdFromNavigationLocation,
  runIdFromNavigationLocation,
  settingsTargetFromNavigationLocation,
  type ActivePage,
  type AppNavigationLocation,
} from "./app-navigation";
import type { ChannelSummary } from "./channels-contract";
import { directMessageDisplayName } from "./direct-messages";
import { formatIssueKey } from "./issue-key";
import type { NavigationHistoryRunLabel } from "../state/navigation/atoms";
import type { Organization, Project } from "../types";

/*
  Turning navigation history entries into the labels the window controls show.

  A location is only ids, so every row has to be resolved against the teams,
  organizations, channels and the runs the visit stack points at — which is why
  this was a 200 line `useMemo` in the app shell. It is pure, so it lives here
  with the other navigation helpers and is tested directly.
*/

export interface NavigationHistoryItemsInput {
  /** The history entries, oldest first. */
  readonly entries: readonly AppNavigationLocation[];
  readonly teams: readonly Project[];
  readonly organizations: readonly Organization[];
  readonly channels: readonly ChannelSummary[];
  /** Issue key and title per visited run, keyed by run id. */
  readonly runLabels: ReadonlyMap<string, NavigationHistoryRunLabel>;
  readonly currentUserId: string | null;
  readonly t: (key: MessageKey) => string;
}

export function buildNavigationHistoryItems({
  entries,
  teams,
  organizations,
  channels,
  runLabels,
  currentUserId,
  t,
}: NavigationHistoryItemsInput): WindowNavigationHistoryItem[] {
  const pageLabels = {
    agents: t("sidebar.agents"),
    channels: t("sidebar.channels"),
    dms: t("sidebar.dms"),
    inbox: t("sidebar.inbox"),
    "my-issues": t("sidebar.myIssues"),
    projects: t("projects.title"),
    "organization-create": t("sidebar.addOrganization"),
    issues: t("sidebar.issues"),
    lobby: t("lobby.eyebrow"),
    schedule: t("sidebar.schedule"),
    settings: t("account.settings"),
  } satisfies Record<ActivePage, string>;
  const applicationSettingLabels = new Map(
    appSettingsNavigationGroups.flatMap((group) =>
      group.items.map((item) => [item.id, t(item.labelKey)] as const)
    ),
  );
  const organizationSettingLabels = {
    agents: t("organization.agents"),
    general: t("organization.general"),
    integrations: t("organization.integrations"),
    members: t("organization.membersAndInvites"),
    workers: t("organization.workers"),
  };
  const projectSettingLabels = {
    "agent-configuration": t("settings.navAgent"),
    execution: t("settings.navExecution"),
    general: t("settings.navGeneral"),
    integrations: t("settings.navIntegrations"),
    "issue-import": t("settings.navIssueImport"),
    tabs: t("settings.navTabs"),
    workflow: t("settings.navWorkflow"),
  };
  const pageIcon = (page: ActivePage) => {
    if (page === "lobby") return <House aria-hidden="true" size={16} />;
    if (page === "issues") return <Activity aria-hidden="true" size={16} />;
    if (page === "agents") return <Bot aria-hidden="true" size={16} />;
    if (page === "schedule") return <CalendarDays aria-hidden="true" size={16} />;
    if (page === "inbox") return <InboxIcon aria-hidden="true" size={16} />;
    if (page === "my-issues") return <ListTodo aria-hidden="true" size={16} />;
    if (page === "projects") return <FolderKanban aria-hidden="true" size={16} />;
    if (page === "channels") return <Hash aria-hidden="true" size={16} />;
    if (page === "dms") return <MessageCircle aria-hidden="true" size={16} />;
    if (page === "organization-create") {
      return <Building2 aria-hidden="true" size={16} />;
    }
    return <Settings aria-hidden="true" size={16} />;
  };
  const createItem = (
    index: number,
    location: AppNavigationLocation,
    item: Omit<WindowNavigationHistoryItem, "index" | "location">,
  ): WindowNavigationHistoryItem => ({ index, location, ...item });

  return entries.map((location, index) => {
    const page = pageFromNavigationLocation(location);
    const projectId = projectIdFromNavigationLocation(location);
    const project = projectId
      ? teams.find((candidate) => candidate.id === projectId)
      : undefined;
    const organizationId = organizationIdFromNavigationLocation(location);
    const organization = organizationId
      ? organizations.find((candidate) => candidate.id === organizationId)
      : undefined;
    const runId = runIdFromNavigationLocation(location);
    if (runId) {
      const run = runLabels.get(runId);
      return createItem(index, location, {
        context: project?.name ?? null,
        eyebrow: run
          ? formatIssueKey(project?.issueKeyPrefix, run.runNumber)
          : t("sidebar.issues"),
        icon: <Activity aria-hidden="true" size={16} />,
        label: run?.title ?? t("sidebar.issues"),
      });
    }

    const channelId = channelIdFromNavigationLocation(location);
    if (channelId) {
      const channel = channels.find((candidate) => candidate.id === channelId);
      const isDirectMessage = page === "dms" || channel?.kind === "dm";
      const channelName = channel
        ? isDirectMessage
          ? directMessageDisplayName(channel, currentUserId)
          : channel.name
        : isDirectMessage
          ? t("sidebar.dms")
          : t("sidebar.channels");
      return createItem(index, location, {
        context: organization?.name ?? null,
        eyebrow: isDirectMessage
          ? t("sidebar.dms")
          : channel
            ? `#${channel.slug}`
            : t("sidebar.channels"),
        icon: isDirectMessage
          ? <MessageCircle aria-hidden="true" size={16} />
          : <Hash aria-hidden="true" size={16} />,
        label: channelName,
      });
    }

    const settingsTarget = settingsTargetFromNavigationLocation(location);
    if (settingsTarget) {
      const sectionLabel = settingsTarget.scope === "application"
        ? applicationSettingLabels.get(settingsTarget.section) ??
          t("account.settings")
        : settingsTarget.scope === "organization"
          ? organizationSettingLabels[settingsTarget.section]
          : projectSettingLabels[settingsTarget.section];
      const settingsOwner = settingsTarget.scope === "organization"
        ? organizations.find(
            (candidate) => candidate.id === settingsTarget.organizationId,
          )?.name
        : settingsTarget.scope === "project"
          ? teams.find(
              (candidate) => candidate.id === settingsTarget.projectId,
            )?.name
          : null;
      return createItem(index, location, {
        context: settingsTarget.scope === "application"
          ? null
          : settingsTarget.scope === "organization"
            ? t("organization.settingsLabel")
            : t("sidebar.projectSettings"),
        eyebrow: settingsOwner ?? t("account.settings"),
        icon: settingsTarget.scope === "organization"
          ? <Building2 aria-hidden="true" size={16} />
          : <Settings aria-hidden="true" size={16} />,
        label: sectionLabel,
      });
    }

    if (page === "inbox" || page === "my-issues") {
      return createItem(index, location, {
        context: null,
        eyebrow: organization?.name ?? t("sidebar.myIssues"),
        icon: pageIcon(page),
        label: pageLabels[page],
      });
    }

    if (page === "organization-create") {
      return createItem(index, location, {
        context: null,
        eyebrow: t("sidebar.organizationSettings"),
        icon: pageIcon(page),
        label: pageLabels[page],
      });
    }

    if (projectId && isProjectNavigationPage(page)) {
      return createItem(index, location, {
        context: null,
        eyebrow: project?.name ?? t("sidebar.projects"),
        icon: pageIcon(page),
        label: pageLabels[page],
      });
    }

    if (page === "channels" || page === "dms") {
      return createItem(index, location, {
        context: project?.name ?? null,
        eyebrow: organization?.name ?? t("navigation.history"),
        icon: pageIcon(page),
        label: pageLabels[page],
      });
    }

    return createItem(index, location, {
      context: null,
      eyebrow: "Briar",
      icon: pageIcon(page),
      label: pageLabels[page],
    });
  });
}
