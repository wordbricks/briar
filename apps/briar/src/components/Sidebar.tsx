import {
  Activity,
  Bot,
  Briefcase,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Check,
  Ellipsis,
  ExternalLink,
  FolderKanban,
  Inbox,
  ListTodo,
  LogOut,
  Plus,
  Settings,
  Languages,
  MessagesSquare,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { collapseLinkedAutoHuntSessions } from "../state/agent-sessions/model";
import type { AutoHuntSession } from "../types";
import { useI18n, type Locale } from "../i18n";
import { cn } from "../lib/utils";
import {
  isLocalTeamRepositoryReady,
  localTeamConnectionState,
} from "../lib/local-team-connection";
import { isTeamScheduleTabEnabled } from "../lib/team-tabs";
import type { RepositoryReadiness } from "../generated/tauri";
import type {
  ChannelSidebarSection,
  ChannelSummary,
  ChannelVisibility,
} from "../lib/channels-contract";
import type {
  Workspace,
  PlanningProject,
  Project,
  ProjectAgent,
  SessionUser,
} from "../types";
import {
  sidebarWidthDefault,
  sidebarWidthMax,
  sidebarWidthMin,
} from "../lib/sidebar-width";
import {
  SidebarDirectMessages,
  type SidebarDirectMessageActions,
} from "./SidebarDirectMessages";
import { TeamAgentAvatar } from "./TeamAgentAvatar";
import { TeamIcon, teamIconComponent } from "./TeamIcon";
import {
  sidebarModeOptionActiveClass,
  sidebarModeOptionClass,
  sidebarUnreadDotClass,
  sidebarWorkspaceMenuClass,
  sidebarWorkspaceMenuItemClass,
} from "./sidebar-classes";
import {
  SidebarCollapsibleSection,
  SidebarWorkspaceChannels,
  SidebarProjectChannels,
} from "./SidebarChannels";
import { UpdateControl } from "./UpdateControl";
import { useToast } from "./ui/toast";

type SidebarPage =
  | "issues"
  | "lobby"
  | "projects"
  | "agents"
  | "channels"
  | "dms"
  | "schedule"
  | "inbox"
  | "my-issues"
  | "project-settings"
  | "workspace-create"
  | "workspace-settings"
  | "settings";

const EMPTY_CHANNELS: ChannelSummary[] = [];
const EMPTY_SIDEBAR_SECTIONS: ChannelSidebarSection[] = [];

export function Sidebar({
  activePage,
  activeWorkspaceId,
  activeProjectId,
  activePlanningProjectId,
  activeChannelId,
  agents,
  channels,
  channelsLoading = false,
  connectedTeamIds,
  directMessages = EMPTY_CHANNELS,
  isComposingDirectMessage = false,
  isOpen,
  onAddProject,
  onAddPlanningProject,
  onPlanningProjectEdit,
  onPlanningProjectOpen,
  onAgentSessionOpen,
  onAgentsOpen,
  onLobbyOpen,
  onScheduleOpen,
  onInboxOpen,
  onMyIssuesOpen,
  onDmsOpen = () => {},
  onWorkOpen = () => {},
  onDirectMessageOpen = () => {},
  onDirectMessageCompose = () => {},
  directMessageActions,
  directMessageSections = EMPTY_SIDEBAR_SECTIONS,
  onChannelCreate,
  onChannelDelete,
  onChannelOpen,
  onChannelSettings,
  onIssuesOpen,
  onCreateIssue,
  onAddWorkspace,
  onWorkspaceChange,
  onProjectChange,
  onProjectOpenInNewWindow,
  onProjectRepositoryOpen,
  onProjectSettings,
  onSettings,
  onLogout,
  workspaces,
  projects,
  planningProjects = [],
  projectReadiness,
  projectReadinessError,
  projectWindowProjectId = null,
  sessions,
  sidebarResizeProps,
  sidebarWidth,
  token,
  unreadInboxCount,
  unreadDmCount = 0,
  user,
}: {
  activePage: SidebarPage;
  activeWorkspaceId: string | null;
  activeProjectId: string | null;
  activePlanningProjectId?: string | null;
  activeChannelId?: string | null;
  agents: ProjectAgent[];
  channels?: ChannelSummary[];
  channelsLoading?: boolean;
  connectedTeamIds: string[] | null;
  /** The active workspace's DMs, listed while the DMs half is on. */
  directMessages?: ChannelSummary[];
  /** A new DM is being composed, so the list's New row is the current one. */
  isComposingDirectMessage?: boolean;
  isOpen: boolean;
  onAddProject: () => void;
  onAddPlanningProject?: (teamId: string) => void;
  onPlanningProjectEdit?: (projectId: string) => void;
  onPlanningProjectOpen?: (projectId: string, teamId: string) => void;
  onAgentSessionOpen: (sessionId: string) => void;
  onAgentsOpen: () => void;
  onLobbyOpen: () => void;
  onScheduleOpen: () => void;
  onInboxOpen: () => void;
  onMyIssuesOpen?: () => void;
  /** The DMs half of the toggle. */
  onDmsOpen?: () => void;
  /** The Work half of the toggle. */
  onWorkOpen?: () => void;
  onDirectMessageOpen?: (channelId: string) => void;
  onDirectMessageCompose?: () => void;
  /** Everything the DM row and section context menus can do. */
  directMessageActions?: SidebarDirectMessageActions;
  /** The member's own sidebar sections, in position order. */
  directMessageSections?: readonly ChannelSidebarSection[];
  onChannelCreate?: (
    name: string,
    visibility: ChannelVisibility,
    defaultProjectId?: string | null,
  ) => Promise<void>;
  onChannelDelete?: (channelId: string) => Promise<void>;
  onChannelOpen?: (channelId: string) => void;
  onChannelSettings?: (channelId: string) => void;
  onIssuesOpen: () => void;
  onCreateIssue: (projectId: string) => void;
  onAddWorkspace: () => void;
  onWorkspaceChange: (workspaceId: string) => void;
  onProjectChange: (projectId: string) => void;
  onProjectOpenInNewWindow?: (projectId: string) => Promise<void>;
  onProjectRepositoryOpen: (projectId: string) => void;
  onProjectSettings: (projectId: string) => void;
  onSettings: () => void;
  onLogout: () => void;
  workspaces: Workspace[];
  projects: Project[];
  planningProjects?: PlanningProject[];
  projectReadiness: Record<string, RepositoryReadiness>;
  projectReadinessError: Record<string, string>;
  projectWindowProjectId?: string | null;
  sessions: AutoHuntSession[];
  sidebarResizeProps?: {
    onDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
    onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
    onPointerCancel?: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove?: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp?: (event: React.PointerEvent<HTMLDivElement>) => void;
  };
  sidebarWidth?: number;
  token: string | null;
  unreadInboxCount: number;
  unreadDmCount?: number;
  user: SessionUser;
}) {
  const { locale, setLocale, t } = useI18n();
  const { toast } = useToast();
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const organizationMenuRef = useRef<HTMLDivElement | null>(null);
  // Teams start expanded; only explicitly collapsed IDs are stored.
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedPlanningProjectTeamIds, setCollapsedPlanningProjectTeamIds] =
    useState<Set<string>>(() => new Set());
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuItemRef = useRef<HTMLButtonElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const languageMenuRef = useRef<HTMLDivElement>(null);
  const languageTriggerRef = useRef<HTMLButtonElement>(null);

  const catalog = channels ?? EMPTY_CHANNELS;
  const organizationRole = workspaces.find(
    (workspace) => workspace.id === activeWorkspaceId,
  )?.role ?? null;
  const activeChannelProjectId = catalog.find(
    (channel) => channel.id === activeChannelId,
  )?.defaultProjectId;

  useEffect(() => {
    if (activePage !== "channels" || !activeChannelProjectId) return;
    setCollapsedProjectIds((current) => {
      if (!current.has(activeChannelProjectId)) return current;
      const next = new Set(current);
      next.delete(activeChannelProjectId);
      return next;
    });
  }, [activeChannelProjectId, activePage]);

  useEffect(() => {
    if (!isWorkspaceMenuOpen) return;
    const focusTarget =
      organizationMenuRef.current?.querySelector<HTMLButtonElement>(
        '[role="menuitemradio"][aria-checked="true"]',
      ) ??
      organizationMenuRef.current?.querySelector<HTMLButtonElement>(
        ".sidebar-workspace-menu [role='menuitem']",
      );
    focusTarget?.focus();

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!organizationMenuRef.current?.contains(event.target as Node)) {
        setIsWorkspaceMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsWorkspaceMenuOpen(false);
      organizationMenuRef.current
        ?.querySelector<HTMLButtonElement>(".sidebar-brand")
        ?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isWorkspaceMenuOpen]);

  useEffect(() => {
    if (!openProjectMenuId) return;
    menuItemRef.current?.focus();
    const closeMenu = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || menuTriggerRef.current?.contains(target)) {
        return;
      }
      setOpenProjectMenuId(null);
    };
    const closeMenuWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenProjectMenuId(null);
      menuTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeMenuWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeMenuWithKeyboard);
    };
  }, [openProjectMenuId]);

  useEffect(() => {
    if (!isAccountMenuOpen) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setIsAccountMenuOpen(false);
        setIsLanguageMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isLanguageMenuOpen) {
        setIsLanguageMenuOpen(false);
        languageTriggerRef.current?.focus();
      }
      else setIsAccountMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isAccountMenuOpen, isLanguageMenuOpen]);

  useEffect(() => {
    if (!isLanguageMenuOpen) return;
    languageMenuRef.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?.focus();
  }, [isLanguageMenuOpen]);

  const languages: { locale: Locale; label: string }[] = [
    { locale: "ko", label: t("language.ko") },
    { locale: "en", label: t("language.en") },
    { locale: "zh", label: t("language.zh") },
  ];
  const activeWorkspace =
    workspaces.find(
      (workspace) =>
        workspace.id ===
        projects.find((project) => project.id === projectWindowProjectId)
          ?.workspaceId,
    ) ??
    workspaces.find(
      (workspace) => workspace.id === activeWorkspaceId,
    ) ??
    workspaces.find(
      (workspace) =>
        workspace.id ===
        projects.find((project) => project.id === activeProjectId)
          ?.workspaceId,
    ) ??
    workspaces[0] ??
    null;
  const isProjectWindow = Boolean(projectWindowProjectId);
  // The toggle has no state of its own: the DM page is the DMs half and every
  // other page is Work. A project window has no DMs, so it is Work throughout.
  const sidebarMode = activePage === "dms" && !isProjectWindow ? "dms" : "work";
  const projectWindowProject = isProjectWindow
    ? projects.find((project) => project.id === projectWindowProjectId) ?? null
    : null;
  const visibleProjects = activeWorkspace
    ? projects.filter(
        (project) => project.workspaceId === activeWorkspace.id,
      )
    : projects;
  useEffect(() => {
    if (activePage !== "projects" || !activeProjectId) return;
    setCollapsedProjectIds((current) => {
      if (!current.has(activeProjectId)) return current;
      const next = new Set(current);
      next.delete(activeProjectId);
      return next;
    });
    setCollapsedPlanningProjectTeamIds((current) => {
      if (!current.has(activeProjectId)) return current;
      const next = new Set(current);
      next.delete(activeProjectId);
      return next;
    });
  }, [activePage, activeProjectId]);
  const runningAgentSessionsByProjectId = useMemo(() => {
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    const grouped = new Map<
      string,
      Array<{ agent: ProjectAgent | null; session: AutoHuntSession }>
    >();

    for (const project of projects) {
      const running = collapseLinkedAutoHuntSessions(
        sessions.filter(
          (session) =>
            session.projectId === project.id &&
            session.status === "running" &&
            session.agentId,
        ),
      )
        .map((session) => ({
          agent: agentById.get(session.agentId as string) ?? null,
          session,
        }))
        .sort(
          (left, right) =>
            new Date(right.session.startedAt).getTime() -
            new Date(left.session.startedAt).getTime(),
        );
      grouped.set(project.id, running);
    }

    return grouped;
  }, [agents, projects, sessions]);

  const isProjectExpanded = (projectId: string) =>
    !collapsedProjectIds.has(projectId);

  const setProjectExpanded = (projectId: string, expanded: boolean) => {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (expanded) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const toggleProjectExpanded = (projectId: string) => {
    setProjectExpanded(projectId, !isProjectExpanded(projectId));
  };

  const selectProject = (projectId: string) => {
    if (projectId !== activeProjectId) onProjectChange(projectId);
    setProjectExpanded(projectId, true);
    onLobbyOpen();
  };

  return (
    <aside
      aria-hidden={!isOpen}
      className={`sidebar${isProjectWindow ? " sidebar-project-window" : ""}${
        isOpen ? "" : " sidebar-collapsed"
      }`}
      inert={!isOpen ? true : undefined}
      id="app-sidebar"
    >
      <div
        className="flex h-[46px] flex-none basis-[46px] items-center pl-[var(--traffic-light-safe-inset)]"
        data-tauri-drag-region
      />

      {isProjectWindow ? (
        <button
          aria-label={
            projectWindowProject
              ? t("sidebar.openProjectHome", { name: projectWindowProject.name })
              : t("sidebar.projectUnavailable")
          }
          className={cn(
            "mx-2.5 flex h-[42px] w-[calc(100%-20px)] shrink-0 grow-0 basis-[42px] items-center gap-[9px]",
            "cursor-pointer rounded-[9px] bg-transparent px-2 text-left text-sidebar-foreground-strong",
            "not-disabled:hover:bg-sidebar-hover not-disabled:active:scale-[.985] disabled:cursor-default",
            "[&>img]:flex-none [&>svg]:flex-none",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sidebar-focus",
          )}
          data-briar-sidebar-project-brand=""
          disabled={!projectWindowProject}
          onClick={onLobbyOpen}
          type="button"
        >
          {projectWindowProject ? (
            <TeamIcon className="size-5" project={projectWindowProject} />
          ) : null}
          <span className="min-w-0 truncate text-md/[20px] font-bold tracking-[-.25px]">
            {projectWindowProject?.name ?? t("sidebar.projectUnavailable")}
          </span>
        </button>
      ) : (
        <div
          className="relative flex h-[42px] flex-none basis-[42px] items-center gap-1.5 px-2.5"
          data-briar-sidebar-workspace-switcher=""
          ref={organizationMenuRef}
        >
        <button
          aria-expanded={isWorkspaceMenuOpen}
          aria-haspopup="menu"
          aria-label={t("sidebar.workspaceSwitcher")}
          className={cn(
            "flex h-8.5 min-w-0 flex-auto cursor-pointer items-center gap-[5px] rounded-[8px] px-[7px]",
            "bg-transparent text-left text-md/[20px] font-bold tracking-[-.25px] text-sidebar-foreground-strong",
            "hover:bg-sidebar-hover aria-expanded:bg-sidebar-hover active:scale-[.985]",
            "[&>span]:min-w-0 [&>span]:truncate",
            "[&>svg]:flex-none [&>svg]:text-sidebar-foreground-muted",
            "[&>svg]:transition-[transform] [&>svg]:duration-[160ms] [&>svg]:ease-[cubic-bezier(.2,.8,.2,1)]",
            "motion-reduce:[&>svg]:transition-none",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sidebar-focus",
          )}
          onClick={() => {
            setOpenProjectMenuId(null);
            setIsAccountMenuOpen(false);
            setIsLanguageMenuOpen(false);
            setIsWorkspaceMenuOpen((open) => !open);
          }}
          type="button"
        >
          {activeWorkspace?.logo ? (
            <img
              alt=""
              className="size-5 flex-none rounded-[5px] object-cover"
              src={activeWorkspace.logo}
            />
          ) : null}
          <span>{activeWorkspace?.name ?? "Briar"}</span>
          <ChevronDown
            aria-hidden="true"
            className={isWorkspaceMenuOpen ? "rotate-180" : ""}
            size={14}
            strokeWidth={1.8}
          />
        </button>
        {isWorkspaceMenuOpen && (
          <div
            aria-label={t("sidebar.workspaceMenu")}
            className={sidebarWorkspaceMenuClass}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              const items = Array.from(
                organizationMenuRef.current?.querySelectorAll<HTMLButtonElement>(
                  ".sidebar-workspace-menu button",
                ) ?? [],
              );
              const current = Math.max(
                0,
                items.indexOf(document.activeElement as HTMLButtonElement),
              );
              const offset = event.key === "ArrowDown" ? 1 : -1;
              items[(current + offset + items.length) % items.length]?.focus();
            }}
            role="menu"
          >
            <div
              aria-label={t("sidebar.workspaceList")}
              className="grid gap-px"
              role="group"
            >
              {workspaces.map((workspace) => (
                <button
                  aria-checked={workspace.id === activeWorkspace?.id}
                  key={workspace.id}
                  onClick={() => {
                    onWorkspaceChange(workspace.id);
                    setIsWorkspaceMenuOpen(false);
                  }}
                  className={sidebarWorkspaceMenuItemClass}
                  role="menuitemradio"
                  type="button"
                >
                  {workspace.logo ? (
                    <img
                      alt=""
                      className="size-4 rounded-[4px] object-cover"
                      src={workspace.logo}
                    />
                  ) : (
                    <Building2
                      aria-hidden="true"
                      className="text-sidebar-foreground-muted"
                      size={15}
                      strokeWidth={1.7}
                    />
                  )}
                  <span>{workspace.name}</span>
                  {workspace.id === activeWorkspace?.id ? (
                    <Check
                      aria-hidden="true"
                      className="text-sidebar-icon-accent"
                      size={15}
                      strokeWidth={1.8}
                    />
                  ) : null}
                </button>
              ))}
            </div>
            <div
              className="-mx-[7px] my-1.5 h-px bg-sidebar-border"
              role="separator"
            />
            <button
              className={cn(
                sidebarWorkspaceMenuItemClass,
                "grid-cols-[18px_minmax(0,1fr)] font-semibold",
              )}
              onClick={() => {
                setIsWorkspaceMenuOpen(false);
                onAddWorkspace();
              }}
              role="menuitem"
              type="button"
            >
              <Plus
                aria-hidden="true"
                className="text-sidebar-icon-accent"
                size={15}
                strokeWidth={1.7}
              />
              <span>{t("sidebar.addWorkspace")}</span>
            </button>
          </div>
        )}
        <div
          aria-label={t("sidebar.modeToggle")}
          className="ml-auto inline-flex flex-none items-center gap-0.5 rounded-[9px] bg-sidebar-accent p-0.5"
          data-briar-sidebar-mode-toggle=""
          role="group"
        >
          <button
            aria-label={t("sidebar.modeChats")}
            aria-pressed={sidebarMode === "dms"}
            className={cn(sidebarModeOptionClass, sidebarMode === "dms" && sidebarModeOptionActiveClass)}
            data-briar-sidebar-mode-option=""
            onClick={() => {
              if (sidebarMode !== "dms") onDmsOpen();
            }}
            title={t("sidebar.modeChats")}
            type="button"
          >
            <MessagesSquare aria-hidden="true" size={15} strokeWidth={1.8} />
            {sidebarMode !== "dms" && unreadDmCount > 0 ? (
              <i
                aria-label={t("dm.unreadCount", { count: unreadDmCount })}
                className="absolute top-[3px] right-[3px] size-[7px] rounded-full bg-sidebar-icon-accent shadow-[0_0_0_2px_var(--sidebar-fallback)]"
                data-briar-sidebar-mode-unread=""
              />
            ) : null}
          </button>
          <button
            aria-label={t("sidebar.modeWork")}
            aria-pressed={sidebarMode === "work"}
            className={cn(sidebarModeOptionClass, sidebarMode === "work" && sidebarModeOptionActiveClass)}
            data-briar-sidebar-mode-option=""
            onClick={() => {
              if (sidebarMode !== "work") onWorkOpen();
            }}
            title={t("sidebar.modeWork")}
            type="button"
          >
            <Briefcase aria-hidden="true" size={15} strokeWidth={1.8} />
          </button>
        </div>
        </div>
      )}

      {sidebarMode === "dms" ? (
        <SidebarDirectMessages
          activeChannelId={activeChannelId ?? null}
          composing={isComposingDirectMessage}
          currentUserId={user.id}
          directMessages={directMessages}
          loading={channelsLoading}
          onCompose={onDirectMessageCompose}
          onOpen={onDirectMessageOpen}
          sections={directMessageSections}
          {...directMessageActions}
        />
      ) : (
      <>
      <nav aria-label={t("sidebar.mainMenu")} className="sidebar-primary-nav">
        <a
          aria-current={activePage === "inbox" ? "page" : undefined}
          className={activePage === "inbox" ? "active" : ""}
          href="#inbox"
          onClick={(event) => {
            event.preventDefault();
            onInboxOpen();
          }}
        >
          <Inbox size={16} strokeWidth={1.7} />
          <span>{t("sidebar.inbox")}</span>
          {unreadInboxCount > 0 && (
            <i
              aria-label={t("inbox.unreadCount", { count: unreadInboxCount })}
              className={sidebarUnreadDotClass}
              data-briar-sidebar-unread=""
            />
          )}
        </a>
        {!isProjectWindow && onMyIssuesOpen ? (
          <a
            aria-current={activePage === "my-issues" ? "page" : undefined}
            className={`sidebar-primary-subnav-link${
              activePage === "my-issues" ? " active" : ""
            }`}
            href="#my-issues"
            onClick={(event) => {
              event.preventDefault();
              onMyIssuesOpen();
            }}
          >
            <ListTodo aria-hidden="true" size={15} strokeWidth={1.7} />
            <span>{t("sidebar.myIssues")}</span>
          </a>
        ) : null}
        {isProjectWindow && projectWindowProject && onChannelOpen ? (
          <SidebarProjectChannels
            activeChannelId={activeChannelId}
            activePage={activePage}
            channels={catalog}
            channelsLoading={channelsLoading}
            currentUserId={user.id}
            onChannelCreate={onChannelCreate}
            onDeleteChannel={onChannelDelete}
            onOpen={onChannelOpen}
            onSettings={onChannelSettings}
            organizationRole={organizationRole}
            projectId={projectWindowProject.id}
            projectName={projectWindowProject.name}
            topLevel
          />
        ) : !isProjectWindow && onChannelOpen ? (
          <SidebarWorkspaceChannels
            activeChannelId={activeChannelId}
            activePage={activePage}
            channels={catalog}
            channelsLoading={channelsLoading}
            currentUserId={user.id}
            onChannelCreate={onChannelCreate}
            onChannelDelete={onChannelDelete}
            onChannelOpen={onChannelOpen}
            onChannelSettings={onChannelSettings}
            organizationRole={organizationRole}
          />
        ) : null}
      </nav>

      {projectWindowProject ? (
        <div className="sidebar-projects sidebar-project-window-tabs">
          <div className="sidebar-project-list">
            <div className="sidebar-project-views">
              <div className="sidebar-project-view-row">
                <a
                  aria-current={activePage === "issues" ? "page" : undefined}
                  className={`sidebar-project-view${
                    activePage === "issues" ? " active" : ""
                  }`}
                  href="#issues"
                  onClick={(event) => {
                    event.preventDefault();
                    onIssuesOpen();
                  }}
                >
                  <Activity size={14} strokeWidth={1.7} />
                  <span>{t("sidebar.issues")}</span>
                </a>
                <button
                  aria-label={t("dashboard.createIssue")}
                  className="sidebar-issue-add"
                  onClick={() => onCreateIssue(
                    planningProjects.find(
                      candidate => candidate.teamId === projectWindowProject.id &&
                        candidate.isDefault,
                    )?.id ?? projectWindowProject.id,
                  )}
                  title={t("dashboard.createIssue")}
                  type="button"
                >
                  <Plus aria-hidden="true" size={16} strokeWidth={1.7} />
                </button>
              </div>
              <div className="sidebar-agent-navigation">
                <a
                  aria-current={activePage === "agents" ? "page" : undefined}
                  className={`sidebar-project-view${
                    activePage === "agents" ? " active" : ""
                  }`}
                  href="#agents"
                  onClick={(event) => {
                    event.preventDefault();
                    onAgentsOpen();
                  }}
                >
                  <Bot size={14} strokeWidth={1.7} />
                  <span>{t("sidebar.agents")}</span>
                </a>
                {(runningAgentSessionsByProjectId.get(projectWindowProject.id) ?? [])
                  .length > 0 ? (
                  <div
                    aria-label={t("sidebar.runningAgentSessions")}
                    className="sidebar-agent-sessions"
                  >
                    {(runningAgentSessionsByProjectId.get(projectWindowProject.id) ?? [])
                      .map(({ agent, session }) => {
                        const title = agentSessionTitle(
                          session,
                          t("sidebar.untitledAgentSession"),
                        );
                        return (
                          <button
                            aria-label={t("sidebar.openAgentSession", { title })}
                            className="sidebar-agent-session"
                            key={session.id}
                            onClick={() => onAgentSessionOpen(session.id)}
                            title={title}
                            type="button"
                          >
                            {agent ? (
                              <TeamAgentAvatar
                                agent={agent}
                                isRunning
                                token={token}
                              />
                            ) : (
                              <span
                                aria-hidden="true"
                                className="project-agent-avatar"
                              >
                                <Bot size={19} />
                              </span>
                            )}
                            <span>
                              <strong>{title}</strong>
                              <small>
                                <i aria-hidden="true" />
                                {agent?.name ?? t("agents.title")}
                              </small>
                            </span>
                            <ChevronRight
                              aria-hidden="true"
                              size={13}
                              strokeWidth={1.8}
                            />
                          </button>
                        );
                      })}
                  </div>
                ) : null}
              </div>
              {isTeamScheduleTabEnabled(projectWindowProject) ? (
                <a
                  aria-current={activePage === "schedule" ? "page" : undefined}
                  className={`sidebar-project-view${
                    activePage === "schedule" ? " active" : ""
                  }`}
                  href="#schedule"
                  onClick={(event) => {
                    event.preventDefault();
                    onScheduleOpen();
                  }}
                >
                  <CalendarDays size={14} strokeWidth={1.7} />
                  <span>{t("sidebar.schedule")}</span>
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : isProjectWindow ? (
        <div className="sidebar-project-window-empty">
          <p>{t("sidebar.projectUnavailableDescription")}</p>
        </div>
      ) : (
      <div className="sidebar-projects">
        <div className="sidebar-section-heading">
          <span>{t("sidebar.teams")}</span>
          <button
            aria-label={t("sidebar.addProject")}
            onClick={onAddProject}
            title={t("sidebar.addProject")}
            type="button"
          >
            <Plus size={17} strokeWidth={1.6} />
          </button>
        </div>

        <div className="sidebar-project-list">
          {visibleProjects.map((project) => {
            const isActive = project.id === activeProjectId;
            const isExpanded = isProjectExpanded(project.id);
            const arePlanningProjectsExpanded =
              !collapsedPlanningProjectTeamIds.has(project.id);
            const teamPlanningProjects = planningProjects.filter(
              (candidate) => candidate.teamId === project.id,
            );
            const isMenuOpen = project.id === openProjectMenuId;
            const readiness = projectReadiness[project.id];
            const readinessError = projectReadinessError[project.id];
            const connectionState = localTeamConnectionState(
              connectedTeamIds,
              project.id,
            );
            const needsConnection = connectionState === "disconnected";
            const needsAttention =
              connectionState === "connected" &&
              Boolean(readiness) &&
              !isLocalTeamRepositoryReady(readiness ?? null);
            const needsInspection =
              connectionState !== "disconnected" &&
              !readiness &&
              Boolean(readinessError);
            const runningAgentSessions =
              runningAgentSessionsByProjectId.get(project.id) ?? [];
            const openProjectPage = (open: () => void) => {
              if (!isActive) onProjectChange(project.id);
              setProjectExpanded(project.id, true);
              open();
            };

            return (
              <section className="sidebar-project-group" key={project.id}>
                <div
                  className={`sidebar-project-row${needsConnection || needsAttention || needsInspection ? " has-warning" : ""}`}
                >
                  <div className="sidebar-project-heading-group">
                    <button
                      aria-controls={`project-views-${project.id}`}
                      aria-expanded={isExpanded}
                      aria-label={t(
                        isExpanded
                          ? "sidebar.collapseProject"
                          : "sidebar.expandProject",
                        { name: project.name },
                      )}
                      className="sidebar-project-toggle"
                      onClick={() => toggleProjectExpanded(project.id)}
                      title={t(
                        isExpanded
                          ? "sidebar.collapseProject"
                          : "sidebar.expandProject",
                        { name: project.name },
                      )}
                      type="button"
                    >
                      {isExpanded ? (
                        <ChevronDown size={14} strokeWidth={1.9} />
                      ) : (
                        <ChevronRight size={14} strokeWidth={1.9} />
                      )}
                    </button>
                    <button
                      aria-current={
                        isActive && activePage === "lobby" ? "page" : undefined
                      }
                      className={`sidebar-project-heading${
                        isActive && activePage === "lobby" ? " active" : ""
                      }`}
                      onClick={() => selectProject(project.id)}
                      type="button"
                    >
                      <TeamIcon className="size-4" project={project} />
                      <span>{project.name}</span>
                      {isActive && <i aria-label={t("sidebar.currentProject")} />}
                    </button>
                  </div>
                  {needsConnection || needsAttention || needsInspection ? (
                    <button
                      aria-label={
                        needsConnection
                          ? t("sidebar.projectNotConnected", { name: project.name })
                          : t("repositorySetup.open", { name: project.name })
                      }
                      className="sidebar-project-warning"
                      data-project-readiness={needsAttention || needsInspection ? project.id : undefined}
                      data-project-reconnect={needsConnection ? project.id : undefined}
                      onClick={() => onProjectRepositoryOpen(project.id)}
                      title={
                        needsConnection
                          ? t("sidebar.projectNotConnected", { name: project.name })
                          : t("repositorySetup.open", { name: project.name })
                      }
                      type="button"
                    >
                      <span aria-hidden="true">!</span>
                    </button>
                  ) : null}
                  <button
                    aria-controls={
                      isMenuOpen ? `project-menu-${project.id}` : undefined
                    }
                    aria-expanded={isMenuOpen}
                    aria-haspopup="menu"
                    aria-label={t("sidebar.projectMenu", { name: project.name })}
                    className="sidebar-project-menu-trigger"
                    onClick={(event) => {
                      setIsAccountMenuOpen(false);
                      menuTriggerRef.current = event.currentTarget;
                      setOpenProjectMenuId(isMenuOpen ? null : project.id);
                    }}
                    title={t("sidebar.menu", { name: project.name })}
                    type="button"
                  >
                    <Ellipsis size={18} strokeWidth={2} />
                  </button>
                  {isMenuOpen && (
                    <div
                      className="sidebar-project-menu"
                      id={`project-menu-${project.id}`}
                      ref={menuRef}
                      role="menu"
                    >
                      {onProjectOpenInNewWindow ? (
                        <button
                          onClick={() => {
                            setOpenProjectMenuId(null);
                            void onProjectOpenInNewWindow(project.id).catch(() => {
                              toast(t("sidebar.projectWindowOpenFailed"), {
                                tone: "error",
                              });
                            });
                          }}
                          ref={menuItemRef}
                          role="menuitem"
                          type="button"
                        >
                          <ExternalLink size={16} strokeWidth={1.7} />
                          <span>{t("sidebar.openProjectInNewWindow")}</span>
                        </button>
                      ) : null}
                      <button
                        onClick={() => {
                          setOpenProjectMenuId(null);
                          onProjectSettings(project.id);
                        }}
                        ref={onProjectOpenInNewWindow ? undefined : menuItemRef}
                        role="menuitem"
                        type="button"
                      >
                        <Settings size={16} strokeWidth={1.7} />
                        <span>{t("sidebar.projectSettings")}</span>
                      </button>
                    </div>
                  )}
                </div>
                {isExpanded && (
                  <div
                    className="sidebar-project-views"
                    id={`project-views-${project.id}`}
                  >
                    <div className="sidebar-planning-projects">
                      <SidebarCollapsibleSection
                        active={isActive && activePage === "projects"}
                        ariaLabel={t(
                          arePlanningProjectsExpanded
                            ? "sidebar.collapseProjects"
                            : "sidebar.expandProjects",
                        )}
                        contextMenuItems={
                          onAddPlanningProject
                            ? [
                                {
                                  icon: (
                                    <Plus
                                      aria-hidden="true"
                                      size={15}
                                      strokeWidth={1.7}
                                    />
                                  ),
                                  label: t("sidebar.addPlanningProject", {
                                    name: project.name,
                                  }),
                                  onSelect: () => onAddPlanningProject(project.id),
                                },
                              ]
                            : null
                        }
                        expanded={arePlanningProjectsExpanded}
                        icon={
                          <FolderKanban
                            aria-hidden="true"
                            size={14}
                            strokeWidth={1.7}
                          />
                        }
                        label={t("sidebar.projects")}
                        listId={`planning-project-list-${project.id}`}
                        onToggle={() => {
                          setCollapsedPlanningProjectTeamIds((current) => {
                            const next = new Set(current);
                            if (arePlanningProjectsExpanded) next.add(project.id);
                            else next.delete(project.id);
                            return next;
                          });
                        }}
                        nested
                      >
                        <div
                          className="sidebar-planning-project-list"
                          id={`planning-project-list-${project.id}`}
                        >
                          {teamPlanningProjects.map((planningProject) => (
                            <div
                              className="sidebar-planning-project-row"
                              data-project-status={planningProject.status}
                              key={planningProject.id}
                            >
                              <button
                                aria-current={
                                  isActive &&
                                  activePage === "issues" &&
                                  activePlanningProjectId === planningProject.id
                                    ? "page"
                                    : undefined
                                }
                                className={
                                  isActive &&
                                  activePage === "issues" &&
                                  activePlanningProjectId === planningProject.id
                                    ? "active"
                                    : undefined
                                }
                                onClick={() => openProjectPage(() =>
                                  onPlanningProjectOpen?.(
                                    planningProject.id,
                                    planningProject.teamId,
                                  ),
                                )}
                                title={
                                  planningProject.description || planningProject.name
                                }
                                type="button"
                              >
                                {(() => {
                                  const PlanningProjectIcon = planningProject.icon
                                    ? teamIconComponent(planningProject.icon)
                                    : FolderKanban;
                                  return (
                                    <PlanningProjectIcon
                                      aria-hidden="true"
                                      size={14}
                                      strokeWidth={1.7}
                                      style={
                                        planningProject.color
                                          ? { color: planningProject.color }
                                          : undefined
                                      }
                                    />
                                  );
                                })()}
                                <span>{planningProject.name}</span>
                              </button>
                              {onPlanningProjectEdit ? (
                                <button
                                  aria-label={t("sidebar.editPlanningProject", {
                                    name: planningProject.name,
                                  })}
                                  onClick={() =>
                                    onPlanningProjectEdit(planningProject.id)
                                  }
                                  title={t("sidebar.editPlanningProject", {
                                    name: planningProject.name,
                                  })}
                                  type="button"
                                >
                                  <Settings size={12} strokeWidth={1.7} />
                                </button>
                              ) : null}
                              <button
                                aria-label={t("sidebar.createIssueInProject", {
                                  name: planningProject.name,
                                })}
                                onClick={() => openProjectPage(
                                  () => onCreateIssue(planningProject.id),
                                )}
                                title={t("sidebar.createIssueInProject", {
                                  name: planningProject.name,
                                })}
                                type="button"
                              >
                                <Plus size={13} strokeWidth={1.8} />
                              </button>
                            </div>
                          ))}
                          {teamPlanningProjects.length === 0 ? (
                            <p>{t("sidebar.noProjects")}</p>
                          ) : null}
                        </div>
                      </SidebarCollapsibleSection>
                    </div>
                    <div className="sidebar-project-view-row">
                      <a
                        aria-current={
                          isActive && activePage === "issues" ? "page" : undefined
                        }
                        className={`sidebar-project-view${
                          isActive && activePage === "issues" ? " active" : ""
                        }`}
                        href="#issues"
                        onClick={(event) => {
                          event.preventDefault();
                          openProjectPage(onIssuesOpen);
                        }}
                      >
                        <Activity size={14} strokeWidth={1.7} />
                        <span>{t("sidebar.issues")}</span>
                      </a>
                      <button
                        aria-label={t("dashboard.createIssue")}
                        className="sidebar-issue-add"
                        onClick={() =>
                          openProjectPage(() => onCreateIssue(
                            planningProjects.find(
                              candidate => candidate.teamId === project.id &&
                                candidate.isDefault,
                            )?.id ?? project.id,
                          ))
                        }
                        title={t("dashboard.createIssue")}
                        type="button"
                      >
                        <Plus aria-hidden="true" size={16} strokeWidth={1.7} />
                      </button>
                    </div>
                    <div className="sidebar-agent-navigation">
                      <a
                        aria-current={
                          isActive && activePage === "agents" ? "page" : undefined
                        }
                        className={`sidebar-project-view${
                          isActive && activePage === "agents" ? " active" : ""
                        }`}
                        href="#agents"
                        onClick={(event) => {
                          event.preventDefault();
                          openProjectPage(onAgentsOpen);
                        }}
                      >
                        <Bot size={14} strokeWidth={1.7} />
                        <span>{t("sidebar.agents")}</span>
                      </a>
                      {runningAgentSessions.length > 0 ? (
                        <div
                          aria-label={t("sidebar.runningAgentSessions")}
                          className="sidebar-agent-sessions"
                        >
                          {runningAgentSessions.map(({ agent, session }) => {
                            const title = agentSessionTitle(
                              session,
                              t("sidebar.untitledAgentSession"),
                            );
                            return (
                              <button
                                aria-label={t("sidebar.openAgentSession", {
                                  title,
                                })}
                                className="sidebar-agent-session"
                                key={session.id}
                                onClick={() => {
                                  if (!isActive) onProjectChange(project.id);
                                  onAgentSessionOpen(session.id);
                                }}
                                title={title}
                                type="button"
                              >
                                {agent ? (
                                  <TeamAgentAvatar
                                    agent={agent}
                                    isRunning
                                    token={token}
                                  />
                                ) : (
                                  <span
                                    aria-hidden="true"
                                    className="project-agent-avatar"
                                  >
                                    <Bot size={19} />
                                  </span>
                                )}
                                <span>
                                  <strong>{title}</strong>
                                  <small>
                                    <i aria-hidden="true" />
                                    {agent?.name ?? t("agents.title")}
                                  </small>
                                </span>
                                <ChevronRight
                                  aria-hidden="true"
                                  size={13}
                                  strokeWidth={1.8}
                                />
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                    {onChannelOpen ? (
                      <SidebarProjectChannels
                        activeChannelId={activeChannelId}
                        activePage={activePage}
                        channels={catalog}
                        channelsLoading={channelsLoading}
                        currentUserId={user.id}
                        onChannelCreate={onChannelCreate}
                        onDeleteChannel={onChannelDelete}
                        onOpen={onChannelOpen}
                        onSettings={onChannelSettings}
                        organizationRole={organizationRole}
                        projectId={project.id}
                        projectName={project.name}
                      />
                    ) : null}
                    {isTeamScheduleTabEnabled(project) ? (
                      <a
                        aria-current={
                          isActive && activePage === "schedule" ? "page" : undefined
                        }
                        className={`sidebar-project-view${
                          isActive && activePage === "schedule" ? " active" : ""
                        }`}
                        href="#schedule"
                        onClick={(event) => {
                          event.preventDefault();
                          openProjectPage(onScheduleOpen);
                        }}
                      >
                        <CalendarDays size={14} strokeWidth={1.7} />
                        <span>{t("sidebar.schedule")}</span>
                      </a>
                    ) : null}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
      )}
      </>
      )}

      <div className="sidebar-bottom">
        <div className="sidebar-footer-row">
          <div className="account-menu" ref={accountMenuRef}>
            {isAccountMenuOpen && (
              <div aria-label={t("account.menu")} className="account-popover" role="menu">
                <div className="account-popover-identity">
                  <div className="avatar">
                    {user.image ? <img src={user.image} alt="" /> : user.name.slice(0, 1).toUpperCase()}
                  </div>
                  <span><strong>{user.name}</strong><small>{user.email}</small></span>
                </div>
                <div className="account-popover-separator" />
                <a
                  href="#settings"
                  onClick={(event) => {
                    event.preventDefault();
                    setIsAccountMenuOpen(false);
                    setIsLanguageMenuOpen(false);
                    onSettings();
                  }}
                  role="menuitem"
                >
                  <Settings size={16} strokeWidth={1.7} />
                  <span>{t("account.settings")}</span>
                </a>
                <button
                  aria-expanded={isLanguageMenuOpen}
                  aria-haspopup="menu"
                  className="account-language-trigger"
                  onClick={() => setIsLanguageMenuOpen((open) => !open)}
                  ref={languageTriggerRef}
                  role="menuitem"
                  type="button"
                >
                  <Languages size={16} strokeWidth={1.7} />
                  <span>{t("account.language")}</span>
                  <ChevronRight aria-hidden="true" size={14} />
                </button>
                <button onClick={() => { setIsLanguageMenuOpen(false); onLogout(); }} role="menuitem" type="button">
                  <LogOut size={16} strokeWidth={1.7} />
                  <span>{t("account.logout")}</span>
                </button>
              </div>
            )}
            {isAccountMenuOpen && isLanguageMenuOpen && (
              <div
                aria-label={t("account.languageMenu")}
                className="language-popover"
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                  event.preventDefault();
                  const items = Array.from(languageMenuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
                  const current = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
                  const offset = event.key === "ArrowDown" ? 1 : -1;
                  items[(current + offset + items.length) % items.length]?.focus();
                }}
                ref={languageMenuRef}
                role="menu"
              >
                {languages.map((language) => (
                  <button
                    aria-checked={locale === language.locale}
                    key={language.locale}
                    lang={language.locale}
                    onClick={() => {
                      setLocale(language.locale);
                      setIsLanguageMenuOpen(false);
                    }}
                    role="menuitemradio"
                    type="button"
                  >
                    <span>{language.label}</span>
                    {locale === language.locale ? <Check aria-hidden="true" size={15} /> : null}
                  </button>
                ))}
              </div>
            )}
            <button
              aria-expanded={isAccountMenuOpen}
              aria-haspopup="menu"
              aria-label={t("account.menu")}
              className="user-card"
              onClick={() => {
                setOpenProjectMenuId(null);
                setIsLanguageMenuOpen(false);
                setIsAccountMenuOpen((open) => !open);
              }}
              type="button"
            >
              <div className="avatar">
                {user.image ? <img src={user.image} alt="" /> : user.name.slice(0, 1).toUpperCase()}
              </div>
              <span>
                <strong>{user.name}</strong>
                <small>{user.email}</small>
              </span>
              <ChevronUp aria-hidden="true" className={isAccountMenuOpen ? "open" : ""} size={14} strokeWidth={1.8} />
            </button>
          </div>
          <UpdateControl />
        </div>
      </div>
      {isOpen && sidebarResizeProps ? (
        <div
          aria-label={t("sidebar.resizeSidebar")}
          aria-orientation="vertical"
          aria-valuemax={sidebarWidthMax}
          aria-valuemin={sidebarWidthMin}
          aria-valuenow={sidebarWidth ?? sidebarWidthDefault}
          className="sidebar-resizer"
          role="separator"
          tabIndex={0}
          {...sidebarResizeProps}
        />
      ) : null}
    </aside>
  );
}

function agentSessionTitle(session: AutoHuntSession, fallback: string) {
  const request = session.request?.trim();
  if (request) return request;
  const issueTitles = session.issues
    .map((issue) => issue.title.trim())
    .filter(Boolean);
  return issueTitles.length > 0 ? issueTitles.join(" · ") : fallback;
}
