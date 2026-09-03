import { useAtomValue, useAtomSet } from "@effect/atom-react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bot,
  Building2,
  CalendarDays,
  FolderKanban,
  FolderPlus,
  Hash,
  House,
  Inbox as InboxIcon,
  Keyboard as KeyboardIcon,
  ListTodo,
  MessageCircle,
  MessagesSquare,
  PanelLeft,
  Plus,
  Settings,
} from "lucide-react";

import type { CommandPaletteItem } from "../components/CommandPalette";
import { TeamIcon } from "../components/TeamIcon";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import { directMessageDisplayName } from "../lib/direct-messages";
import { formatIssueKey } from "../lib/issue-key";
import { formatShortcut, type Keybindings } from "../lib/keybindings";
import { isTeamScheduleTabEnabled } from "../lib/team-tabs";
import { useChannelActions } from "../state/channels/actions";
import {
  activeChannelIdAtom,
  organizationDirectMessagesAtom,
  visibleOrganizationChannelsAtom,
} from "../state/channels/atoms";
import {
  createIssueTeamIdAtom,
  isCommandPaletteOpenAtom,
  isIssueDialogOpenAtom,
  isKeyboardShortcutsOpenAtom,
  isSidebarOpenAtom,
} from "../state/dialogs/atoms";
import { useNavigationActions } from "../state/navigation/actions";
import {
  activePageAtom,
  activeRunIdAtom,
  agentListRequestKeyAtom,
  canGoBackAtom,
  canGoForwardAtom,
  issueListRequestKeyAtom,
  requestedRunIdAtom,
  requestedRunInitialTabAtom,
  requestedSessionIdAtom,
  settingsTargetAtom,
} from "../state/navigation/atoms";
import {
  activeOrganizationAtom,
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../state/organization/atoms";
import { lockedTeamIdAtom } from "../state/platform";
import { tokenAtom, userAtom } from "../state/session/atoms";
import { activeDashboardAtom } from "../state/sync/view";
import { useTeamActions } from "../state/team/actions";
import {
  activeOrganizationTeamsAtom,
  activeTeamAtom,
  activeTeamIdAtom,
} from "../state/team/atoms";
import { collapseLinkedAutoHuntSessions } from "./useAutoHuntSessions";
import type { AutoHuntSession } from "../types";

/*
  The command palette's item list.

  It is built imperatively — six hundred lines of `if` and `for` pushing into an
  array — because the order, the section and the priority of an entry depend on
  the state around it, and that is genuinely easier to read as a sequence than
  as a merge of a dozen memos. What made it a problem was where it lived: in the
  app shell, reading two dozen shell values, rebuilt on every shell render even
  while the palette is closed.

  It reads what it shows from atoms now, including where the user is and what
  the history can do. What is still a parameter is what the app decides: whether
  a gate owns the screen, the auto hunt sessions, the inbox count, and the team
  selection the session facade still owns.
*/

/** What the shell knows and the palette cannot read from the store. */
export interface CommandPaletteItemsInput {
  /** False while a gate — login, onboarding, the intro — owns the screen. */
  readonly commandPaletteAvailable: boolean;
  /** Selects a team, still the session facade's. */
  readonly selectTeam: (teamId: string) => void;
  readonly sessions: readonly AutoHuntSession[];
  readonly unreadInboxCount: number;
  readonly keybindings: Keybindings;
  readonly keyboardShortcutsShortcut: string;
}

export function useCommandPaletteItems({
  commandPaletteAvailable,
  selectTeam,
  sessions,
  unreadInboxCount,
  keybindings,
  keyboardShortcutsShortcut,
}: CommandPaletteItemsInput): CommandPaletteItem[] {
  const { t } = useI18n();
  const activePage = useAtomValue(activePageAtom);
  const selectedRunId = useAtomValue(activeRunIdAtom);
  const canGoBack = useAtomValue(canGoBackAtom);
  const canGoForward = useAtomValue(canGoForwardAtom);
  const {
    goBack,
    goForward,
    navigateToIssue,
    navigateToPage,
    openAppSettings,
  } = useNavigationActions();
  const { startTeamCreation } = useTeamActions();
  const user = useAtomValue(userAtom);
  const token = useAtomValue(tokenAtom);
  const organizations = useAtomValue(organizationsAtom);
  const activeOrganization = useAtomValue(activeOrganizationAtom);
  const activeOrganizationId = useAtomValue(activeOrganizationIdAtom);
  const activeTeam = useAtomValue(activeTeamAtom);
  const activeTeamId = useAtomValue(activeTeamIdAtom);
  const activeOrganizationTeams = useAtomValue(activeOrganizationTeamsAtom);
  const lockedTeamId = useAtomValue(lockedTeamIdAtom);
  const dashboard = useAtomValue(activeDashboardAtom);
  const channels = useAtomValue(visibleOrganizationChannelsAtom);
  const directMessages = useAtomValue(organizationDirectMessagesAtom);
  const activeChannelId = useAtomValue(activeChannelIdAtom);
  const settingsTarget = useAtomValue(settingsTargetAtom);
  const setSettingsTarget = useAtomSet(settingsTargetAtom);
  const isSidebarOpen = useAtomValue(isSidebarOpenAtom);
  const setIsSidebarOpen = useAtomSet(isSidebarOpenAtom);
  const isCommandPaletteOpen = useAtomValue(isCommandPaletteOpenAtom);
  const setIsKeyboardShortcutsOpen = useAtomSet(isKeyboardShortcutsOpenAtom);
  const setIsIssueDialogOpen = useAtomSet(isIssueDialogOpenAtom);
  const setCreateIssueProjectId = useAtomSet(createIssueTeamIdAtom);
  const setRequestedRunId = useAtomSet(requestedRunIdAtom);
  const setRequestedRunInitialTab = useAtomSet(requestedRunInitialTabAtom);
  const setRequestedSessionId = useAtomSet(requestedSessionIdAtom);
  const setIssueListRequestKey = useAtomSet(issueListRequestKeyAtom);
  const setAgentListRequestKey = useAtomSet(agentListRequestKeyAtom);
  const { openOrganizationChannel } = useChannelActions();

  const paletteSections = {
    actions: {
      id: "actions",
      label: t("commandPalette.groupActions"),
    },
    context: {
      id: "context",
      label: t("commandPalette.groupContext"),
    },
    channels: {
      id: "channels",
      label: t("commandPalette.groupChannels"),
    },
    continue: {
      id: "continue",
      label: t("commandPalette.groupContinue"),
    },
    directMessages: {
      id: "direct-messages",
      label: t("commandPalette.groupDirectMessages"),
    },
    issues: {
      id: "issues",
      label: t("commandPalette.groupIssues"),
    },
    navigation: {
      id: "navigation",
      label: t("commandPalette.groupNavigation"),
    },
    projects: {
      id: "projects",
      label: t("commandPalette.groupProjects"),
    },
  } as const;
  const commandPaletteItems: CommandPaletteItem[] = [];
  const addPaletteItem = (
    item: Omit<CommandPaletteItem, "section" | "sectionLabel">,
    section: (typeof paletteSections)[keyof typeof paletteSections],
  ) => {
    if (!commandPaletteAvailable || !isCommandPaletteOpen) return;
    commandPaletteItems.push({
      ...item,
      section: section.id,
      sectionLabel: section.label,
    });
  };
  const openPaletteIssue = (runId: string) => {
    setRequestedSessionId(null);
    setRequestedRunInitialTab(null);
    setRequestedRunId(runId);
    navigateToIssue(runId);
  };

  if (unreadInboxCount > 0) {
    addPaletteItem({
      active: activePage === "inbox",
      description: t("commandPalette.unreadCount", {
        count: unreadInboxCount,
      }),
      icon: <InboxIcon />,
      id: "navigation:inbox",
      keywords: ["inbox", "notifications", "받은 편지함", "알림", "收件箱", "通知"],
      label: t("sidebar.inbox"),
      onSelect: () => navigateToPage("inbox"),
      priority: 180 + unreadInboxCount,
      scope: "navigation",
    }, paletteSections.continue);
  }
  if (!lockedTeamId && activeOrganizationId) {
    if (activeTeam) {
      addPaletteItem({
        active: activePage === "projects",
        description: activeTeam.name,
        icon: <FolderKanban />,
        id: `navigation:projects:${activeTeam.id}`,
        keywords: ["projects", "project list", "프로젝트", "项目"],
        label: t("sidebar.projects"),
        onSelect: () => navigateToPage("projects", activeTeam.id),
        priority: activePage === "projects" ? 125 : 55,
        scope: "navigation",
      }, paletteSections.navigation);
    }
    addPaletteItem({
      active: activePage === "my-issues",
      description: activeOrganization?.name,
      icon: <ListTodo />,
      id: `navigation:my-issues:${activeOrganizationId}`,
      keywords: ["my issues", "issues", "내 이슈", "我的问题"],
      label: t("sidebar.myIssues"),
      onSelect: () => navigateToPage("my-issues"),
      priority: activePage === "my-issues" ? 120 : 50,
      scope: "navigation",
    }, paletteSections.navigation);
  }

  const paletteProjectIds = new Set(
    activeOrganizationTeams.map((project) => project.id),
  );
  const runningPaletteSessions = isCommandPaletteOpen
    ? collapseLinkedAutoHuntSessions(sessions)
        .filter(
          (session) =>
            session.status === "running" &&
            paletteProjectIds.has(session.projectId),
        )
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    : [];
  for (const session of runningPaletteSessions) {
    const project = activeOrganizationTeams.find(
      (candidate) => candidate.id === session.projectId,
    );
    const label = session.request?.trim() || session.agentName?.trim() ||
      t("sidebar.untitledAgentSession");
    addPaletteItem({
      description: t("commandPalette.runningSession", {
        project: project?.name ?? t("sidebar.projects"),
      }),
      icon: <Bot />,
      id: `session:${session.id}`,
      keywords: [
        session.agentName ?? "",
        session.request ?? "",
        project?.name ?? "",
        "agent session",
        "에이전트 세션",
        "智能体会话",
      ],
      label,
      onSelect: () => {
        if (project && project.id !== activeTeamId) selectTeam(project.id);
        setRequestedRunId(null);
        setRequestedSessionId(session.id);
        navigateToPage("agents", project?.id ?? activeTeamId);
      },
      priority: 160,
      scope: "sessions",
    }, paletteSections.continue);
  }

  if (activeTeam) {
    addPaletteItem({
      description: t("commandPalette.createIssueDescription", {
        project: activeTeam.name,
      }),
      icon: <Plus />,
      id: `action:create-issue:${activeTeam.id}`,
      keywords: [
        "create issue",
        "new issue",
        "new task",
        "이슈 만들기",
        "새 이슈",
        "问题",
        "新建问题",
        activeTeam.name,
      ],
      label: t("dashboard.createIssue"),
      onSelect: () => {
        setCreateIssueProjectId(activeTeam.id);
        navigateToPage("issues");
        setIsIssueDialogOpen(true);
      },
      priority: 220,
      remember: false,
      restoreFocusOnSelect: false,
      scope: "actions",
    }, paletteSections.context);
    addPaletteItem({
      active:
        activePage === "settings" &&
        settingsTarget.scope === "project" &&
        settingsTarget.projectId === activeTeam.id,
      description: t("commandPalette.projectSettingsDescription", {
        project: activeTeam.name,
      }),
      icon: <Settings />,
      id: `action:project-settings:${activeTeam.id}`,
      keywords: [
        "team settings",
        "project settings",
        "팀 설정",
        "프로젝트 설정",
        "团队设置",
        "项目设置",
        activeTeam.name,
      ],
      label: t("sidebar.projectSettings"),
      onSelect: () => {
        setSettingsTarget({
          scope: "project",
          projectId: activeTeam.id,
          section: "general",
        });
        navigateToPage("settings");
      },
      priority: 150,
      scope: "actions",
    }, paletteSections.context);
  }

  addPaletteItem({
    description: t("commandPalette.keyboardShortcutsDescription"),
    icon: <KeyboardIcon />,
    id: "action:keyboard-shortcuts",
    keywords: [
      "keyboard shortcuts",
      "hotkeys",
      "vim",
      "keyboard mode",
      "단축키",
      "키보드",
      "快捷键",
    ],
    label: t("keyboardShortcuts.title"),
    onSelect: () => setIsKeyboardShortcutsOpen(true),
    priority: 90,
    remember: false,
    restoreFocusOnSelect: false,
    scope: "actions",
    shortcut: keyboardShortcutsShortcut,
  }, paletteSections.actions);

  addPaletteItem({
    description: t(
      isSidebarOpen
        ? "commandPalette.hideSidebarDescription"
        : "commandPalette.showSidebarDescription",
    ),
    icon: <PanelLeft />,
    id: "action:toggle-sidebar",
    keywords: ["sidebar", "panel", "사이드바", "패널", "侧边栏"],
    label: t(
      isSidebarOpen ? "commandPalette.hideSidebar" : "commandPalette.showSidebar",
    ),
    onSelect: () => setIsSidebarOpen((open) => !open),
    priority: 80,
    remember: false,
    scope: "actions",
    shortcut: formatShortcut(keybindings.sidebarToggle),
  }, paletteSections.actions);

  if (!lockedTeamId) {
    addPaletteItem({
      icon: <FolderPlus />,
      id: "action:add-project",
      keywords: ["new team", "add team", "new project", "add project", "팀 추가", "프로젝트 추가", "新建团队", "新建项目"],
      label: t("sidebar.addProject"),
      onSelect: startTeamCreation,
      priority: 60,
      remember: false,
      restoreFocusOnSelect: false,
      scope: "actions",
    }, paletteSections.actions);
    if (activeOrganization) {
      addPaletteItem({
        active:
          activePage === "settings" &&
          settingsTarget.scope === "organization" &&
          settingsTarget.organizationId === activeOrganization.id,
        description: activeOrganization.name,
        icon: <Building2 />,
        id: `action:organization-settings:${activeOrganization.id}`,
        keywords: [
          "organization settings",
          "workspace settings",
          "조직 설정",
          "组织设置",
          activeOrganization.name,
        ],
        label: t("sidebar.organizationSettings"),
        onSelect: () => {
          setSettingsTarget({
            scope: "organization",
            organizationId: activeOrganization.id,
            section: "general",
          });
          navigateToPage("settings");
        },
        priority: 50,
        scope: "actions",
      }, paletteSections.actions);
    }
  }

  if (canGoBack) {
    addPaletteItem({
      icon: <ArrowLeft />,
      id: "navigation:back",
      keywords: ["back", "history", "뒤로", "이전", "后退"],
      label: t("navigation.back"),
      onSelect: goBack,
      priority: 200,
      remember: false,
      scope: "navigation",
      shortcut: "⌘[",
    }, paletteSections.navigation);
  }
  if (canGoForward) {
    addPaletteItem({
      icon: <ArrowRight />,
      id: "navigation:forward",
      keywords: ["forward", "history", "앞으로", "다음", "前进"],
      label: t("navigation.forward"),
      onSelect: goForward,
      priority: 190,
      remember: false,
      scope: "navigation",
      shortcut: "⌘]",
    }, paletteSections.navigation);
  }
  if (activeTeam) {
    addPaletteItem({
      active: activePage === "lobby",
      description: activeTeam.name,
      icon: <House />,
      id: `navigation:project-home:${activeTeam.id}`,
      keywords: ["home", "overview", "project home", "홈", "项目主页", activeTeam.name],
      label: t("lobby.eyebrow"),
      onSelect: () => navigateToPage("lobby"),
      priority: activePage === "lobby" ? 120 : 70,
      scope: "navigation",
    }, paletteSections.navigation);
    addPaletteItem({
      active: activePage === "issues",
      description: activeTeam.name,
      icon: <Activity />,
      id: `navigation:issues:${activeTeam.id}`,
      keywords: ["issues", "tasks", "이슈", "작업", "问题", activeTeam.name],
      label: t("sidebar.issues"),
      onSelect: () => {
        setRequestedRunId(null);
        setIssueListRequestKey((key) => key + 1);
        navigateToPage("issues");
      },
      priority: activePage === "issues" ? 120 : 70,
      scope: "navigation",
    }, paletteSections.navigation);
    addPaletteItem({
      active: activePage === "agents",
      description: activeTeam.name,
      icon: <Bot />,
      id: `navigation:agents:${activeTeam.id}`,
      keywords: ["agents", "sessions", "에이전트", "세션", "智能体", activeTeam.name],
      label: t("sidebar.agents"),
      onSelect: () => {
        setRequestedSessionId(null);
        setAgentListRequestKey((key) => key + 1);
        navigateToPage("agents");
      },
      priority: activePage === "agents" ? 120 : 60,
      scope: "navigation",
    }, paletteSections.navigation);
    if (isTeamScheduleTabEnabled(activeTeam)) {
      addPaletteItem({
        active: activePage === "schedule",
        description: activeTeam.name,
        icon: <CalendarDays />,
        id: `navigation:schedule:${activeTeam.id}`,
        keywords: ["schedule", "calendar", "스케줄", "일정", "日程", activeTeam.name],
        label: t("sidebar.schedule"),
        onSelect: () => navigateToPage("schedule"),
        priority: activePage === "schedule" ? 120 : 50,
        scope: "navigation",
      }, paletteSections.navigation);
    }
  }
  if (activeOrganizationId && token) {
    addPaletteItem({
      active: activePage === "channels",
      description: activeOrganization?.name,
      icon: <MessagesSquare />,
      id: `navigation:channels:${activeOrganizationId}`,
      keywords: ["channels", "chat", "채널", "대화", "频道"],
      label: t("sidebar.channels"),
      onSelect: () => {
        const channel = channels.find(
          (candidate) => candidate.id === activeChannelId,
        ) ?? channels[0];
        if (channel) openOrganizationChannel(channel.id);
        else navigateToPage("channels");
      },
      priority: activePage === "channels" ? 120 : 50,
      scope: "navigation",
    }, paletteSections.navigation);
  }
  if (!lockedTeamId) {
    addPaletteItem({
      active: activePage === "dms",
      description: activeOrganization?.name,
      icon: <MessageCircle />,
      id: `navigation:dms:${activeOrganizationId ?? "none"}`,
      keywords: ["direct messages", "dm", "messages", "다이렉트 메시지", "私信"],
      label: t("sidebar.dms"),
      onSelect: () => {
        const directMessage = directMessages.find(
          (candidate) => candidate.id === activeChannelId,
        ) ?? directMessages[0];
        if (directMessage) openOrganizationChannel(directMessage.id);
        else navigateToPage("dms");
      },
      priority: activePage === "dms" ? 120 : 50,
      scope: "navigation",
    }, paletteSections.navigation);
  }
  if (unreadInboxCount === 0) {
    addPaletteItem({
      active: activePage === "inbox",
      icon: <InboxIcon />,
      id: "navigation:inbox",
      keywords: ["inbox", "notifications", "받은 편지함", "알림", "收件箱", "通知"],
      label: t("sidebar.inbox"),
      onSelect: () => navigateToPage("inbox"),
      priority: activePage === "inbox" ? 120 : 45,
      scope: "navigation",
    }, paletteSections.navigation);
  }
  addPaletteItem({
    active: activePage === "settings" && settingsTarget.scope === "application",
    icon: <Settings />,
    id: "navigation:app-settings",
    keywords: ["settings", "preferences", "설정", "환경설정", "设置"],
    label: t("appSettings.title"),
    onSelect: openAppSettings,
    priority: activePage === "settings" ? 100 : 40,
    scope: "navigation",
    shortcut: "⌘,",
  }, paletteSections.navigation);

  for (const project of isCommandPaletteOpen ? activeOrganizationTeams : []) {
    const organizationName = organizations.find(
      (organization) => organization.id === project.organizationId,
    )?.name ?? project.organizationName;
    addPaletteItem({
      active: project.id === activeTeamId,
      description:
        project.id === activeTeamId
          ? t("commandPalette.currentProject")
          : organizationName,
      icon: <TeamIcon className="size-4" project={project} />,
      id: `project:${project.id}`,
      keywords: [
        project.name,
        organizationName,
        "team",
        "project",
        "팀",
        "프로젝트",
        "团队",
        "项目",
      ],
      label: project.name,
      onSelect: () => {
        if (project.id !== activeTeamId) selectTeam(project.id);
        setRequestedRunId(null);
        setRequestedSessionId(null);
        navigateToPage("issues", project.id);
      },
      priority: project.id === activeTeamId ? 100 : 20,
      scope: "projects",
    }, paletteSections.projects);

    if (project.id !== activeTeam?.id) {
      addPaletteItem({
        description: t("commandPalette.createIssueDescription", {
          project: project.name,
        }),
        icon: <Plus />,
        id: `action:create-issue:${project.id}`,
        keywords: [
          "create issue",
          "new issue",
          "이슈 만들기",
          "새 이슈",
          "新建问题",
          project.name,
        ],
        label: t("commandPalette.createIssueIn", { project: project.name }),
        onSelect: () => {
          selectTeam(project.id);
          setCreateIssueProjectId(project.id);
          navigateToPage("issues", project.id);
          setIsIssueDialogOpen(true);
        },
        priority: -50,
        remember: false,
        restoreFocusOnSelect: false,
        scope: "actions",
      }, paletteSections.actions);
    }
  }

  const paletteDashboard = isCommandPaletteOpen ? dashboard : null;
  if (paletteDashboard && activeTeam && paletteDashboard.team.id === activeTeam.id) {
    const runs = [...paletteDashboard.runs].sort((left, right) => {
      if (left.id === selectedRunId) return -1;
      if (right.id === selectedRunId) return 1;
      return right.updatedAt.localeCompare(left.updatedAt);
    });
    for (const run of runs) {
      const issueKey = formatIssueKey(activeTeam.issueKeyPrefix, run.runNumber);
      const needsAttention = ["blocked", "failed", "paused"].includes(run.status);
      const isCurrent = run.id === selectedRunId;
      const section = isCurrent
        ? paletteSections.context
        : needsAttention || run.status === "running"
          ? paletteSections.continue
          : paletteSections.issues;
      addPaletteItem({
        active: isCurrent,
        description: t("commandPalette.issueDescription", {
          key: issueKey,
          status: t(`status.${run.status}` as MessageKey),
        }),
        icon: <Activity />,
        id: `issue:${run.id}`,
        keywords: [
          issueKey,
          run.sourceKey,
          run.title,
          t(`status.${run.status}` as MessageKey),
          activeTeam.name,
          "issue",
          "task",
          "이슈",
          "작업",
          "问题",
        ],
        label: run.title,
        onSelect: () => openPaletteIssue(run.id),
        priority: isCurrent ? 190 : needsAttention ? 140 : run.status === "running" ? 120 : 0,
        scope: "issues",
      }, section);
    }
  }

  for (const channel of isCommandPaletteOpen ? channels : []) {
    const isCurrent =
      channel.id === activeChannelId && activePage === "channels";
    const unread = channel.hasUnread;
    addPaletteItem({
      active: isCurrent,
      description: channel.topic?.trim() || `#${channel.slug}`,
      icon: <Hash />,
      id: `channel:${channel.id}`,
      keywords: [
        channel.name,
        channel.slug,
        channel.topic ?? "",
        activeOrganization?.name ?? "",
        "channel",
        "채널",
        "频道",
      ],
      label: channel.name,
      onSelect: () => openOrganizationChannel(channel.id),
      priority: isCurrent ? 180 : unread ? 130 : 0,
      scope: "channels",
    }, isCurrent
      ? paletteSections.context
      : unread
        ? paletteSections.continue
        : paletteSections.channels);
  }

  for (const directMessage of isCommandPaletteOpen ? directMessages : []) {
    const name = directMessageDisplayName(
      directMessage,
      user?.id ?? null,
    );
    const isCurrent =
      directMessage.id === activeChannelId && activePage === "dms";
    const unread = directMessage.hasUnread;
    const participantNames = directMessage.dmParticipants
      .map((participant) => participant.name);
    addPaletteItem({
      active: isCurrent,
      description: unread
        ? t("dm.unread")
        : t("commandPalette.directMessageDescription"),
      icon: <MessageCircle />,
      id: `direct-message:${directMessage.id}`,
      keywords: [
        name,
        ...participantNames,
        "direct message",
        "dm",
        "다이렉트 메시지",
        "私信",
      ],
      label: name,
      onSelect: () => openOrganizationChannel(directMessage.id),
      priority: isCurrent ? 180 : unread ? 130 : 0,
      scope: "direct-messages",
    }, isCurrent
      ? paletteSections.context
      : unread
        ? paletteSections.continue
        : paletteSections.directMessages);
  }

  return commandPaletteItems;
}
