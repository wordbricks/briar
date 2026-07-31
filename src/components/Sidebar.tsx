import {
  Activity,
  Bot,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Check,
  Ellipsis,
  FolderGit2,
  Inbox,
  LogOut,
  Plus,
  Settings,
  Languages,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  collapseLinkedAutoHuntSessions,
  type AutoHuntSession,
} from "../hooks/useAutoHuntSessions";
import { useI18n, type Locale } from "../i18n";
import { isProjectConnectedLocally } from "../lib/local-project-connection";
import type { RepositoryReadiness } from "../lib/project-connection";
import type {
  Organization,
  Project,
  ProjectAgent,
  SessionUser,
} from "../types";
import { ProjectAgentAvatar } from "./ProjectAgentAvatar";
import { UpdateControl } from "./UpdateControl";

export function Sidebar({
  activePage,
  activeOrganizationId,
  activeProjectId,
  agents,
  connectedProjectIds,
  isOpen,
  onAddProject,
  onAgentSessionOpen,
  onAgentsOpen,
  onScheduleOpen,
  onInboxOpen,
  onIssuesOpen,
  onCreateIssue,
  onAddOrganization,
  onOrganizationChange,
  onOrganizationSettings,
  onProjectChange,
  onProjectReadinessOpen,
  onProjectSettings,
  onSettings,
  onLogout,
  organizations,
  projects,
  projectReadiness,
  sessions,
  token,
  unreadInboxCount,
  user,
}: {
  activePage:
    | "issues"
    | "agents"
    | "schedule"
    | "inbox"
    | "project-settings"
    | "organization-create"
    | "organization-settings"
    | "settings";
  activeOrganizationId: string | null;
  activeProjectId: string | null;
  agents: ProjectAgent[];
  connectedProjectIds: string[] | null;
  isOpen: boolean;
  onAddProject: () => void;
  onAgentSessionOpen: (sessionId: string) => void;
  onAgentsOpen: () => void;
  onScheduleOpen: () => void;
  onInboxOpen: () => void;
  onIssuesOpen: () => void;
  onCreateIssue: () => void;
  onAddOrganization: () => void;
  onOrganizationChange: (organizationId: string) => void;
  onOrganizationSettings: (
    organizationId: string,
    section?: "members",
  ) => void;
  onProjectChange: (projectId: string) => void;
  onProjectReadinessOpen: (projectId: string) => void;
  onProjectSettings: (projectId: string) => void;
  onSettings: () => void;
  onLogout: () => void;
  organizations: Organization[];
  projects: Project[];
  projectReadiness: Record<string, RepositoryReadiness>;
  sessions: AutoHuntSession[];
  token: string | null;
  unreadInboxCount: number;
  user: SessionUser;
}) {
  const { locale, setLocale, t } = useI18n();
  const [isOrganizationMenuOpen, setIsOrganizationMenuOpen] = useState(false);
  const [organizationMenuView, setOrganizationMenuView] = useState<
    "actions" | "organizations"
  >("actions");
  const organizationMenuRef = useRef<HTMLDivElement | null>(null);
  // Projects start expanded; only explicitly collapsed IDs are stored.
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuItemRef = useRef<HTMLButtonElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const languageMenuRef = useRef<HTMLDivElement>(null);
  const languageTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOrganizationMenuOpen) return;
    const focusTarget =
      organizationMenuView === "organizations"
        ? organizationMenuRef.current?.querySelector<HTMLButtonElement>(
            '[aria-checked="true"]',
          )
        : organizationMenuRef.current?.querySelector<HTMLButtonElement>(
            ".sidebar-organization-menu [role='menuitem']",
          );
    focusTarget?.focus();

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!organizationMenuRef.current?.contains(event.target as Node)) {
        setIsOrganizationMenuOpen(false);
        setOrganizationMenuView("actions");
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (organizationMenuView === "organizations") {
        setOrganizationMenuView("actions");
        return;
      }
      setIsOrganizationMenuOpen(false);
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
  }, [isOrganizationMenuOpen, organizationMenuView]);

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
  const activeOrganization =
    organizations.find(
      (organization) => organization.id === activeOrganizationId,
    ) ??
    organizations.find(
      (organization) =>
        organization.id ===
        projects.find((project) => project.id === activeProjectId)
          ?.organizationId,
    ) ??
    organizations[0] ??
    null;
  const visibleProjects = activeOrganization
    ? projects.filter(
        (project) => project.organizationId === activeOrganization.id,
      )
    : projects;
  const runningAgentSessionsByProjectId = useMemo(() => {
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    const grouped = new Map<
      string,
      Array<{ agent: ProjectAgent; session: AutoHuntSession }>
    >();

    for (const project of projects) {
      const projectAgents = new Map(
        agents
          .filter((agent) => agent.projectId === project.id)
          .map((agent) => [agent.id, agent]),
      );
      const running = collapseLinkedAutoHuntSessions(
        sessions.filter(
          (session) =>
            session.projectId === project.id &&
            session.status === "running" &&
            session.agentId &&
            projectAgents.has(session.agentId),
        ),
      )
        .map((session) => ({
          agent: agentById.get(session.agentId as string)!,
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
    onProjectChange(projectId);
    setProjectExpanded(projectId, true);
  };

  return (
    <aside
      aria-hidden={!isOpen}
      className={`sidebar${isOpen ? "" : " sidebar-collapsed"}`}
      inert={!isOpen ? true : undefined}
      id="app-sidebar"
    >
      <div className="sidebar-toolbar" data-tauri-drag-region />

      <div
        className="sidebar-organization-switcher"
        ref={organizationMenuRef}
      >
        <button
          aria-expanded={isOrganizationMenuOpen}
          aria-haspopup="menu"
          aria-label={t("sidebar.organizationSwitcher")}
          className="sidebar-brand"
          onClick={() => {
            setOpenProjectMenuId(null);
            setIsAccountMenuOpen(false);
            setIsLanguageMenuOpen(false);
            setIsOrganizationMenuOpen((open) => {
              if (open) setOrganizationMenuView("actions");
              return !open;
            });
          }}
          type="button"
        >
          {activeOrganization?.logo ? (
            <img
              alt=""
              className="sidebar-organization-logo"
              src={activeOrganization.logo}
            />
          ) : null}
          <span>{activeOrganization?.name ?? "Briar"}</span>
          <ChevronDown
            aria-hidden="true"
            className={isOrganizationMenuOpen ? "open" : ""}
            size={14}
            strokeWidth={1.8}
          />
        </button>
        {isOrganizationMenuOpen && (
          <div
            aria-label={t("sidebar.organizationMenu")}
            className="sidebar-organization-menu"
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              const items = Array.from(
                organizationMenuRef.current?.querySelectorAll<HTMLButtonElement>(
                  ".sidebar-organization-menu button",
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
            {organizationMenuView === "actions" ? (
              <>
                <div className="sidebar-organization-menu-group" role="group">
                  <button
                    onClick={() => {
                      if (!activeOrganization) return;
                      setIsOrganizationMenuOpen(false);
                      onOrganizationSettings(activeOrganization.id);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span>{t("sidebar.organizationSettings")}</span>
                  </button>
                  <button
                    onClick={() => {
                      if (!activeOrganization) return;
                      setIsOrganizationMenuOpen(false);
                      onOrganizationSettings(activeOrganization.id, "members");
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span>{t("sidebar.manageMembers")}</span>
                  </button>
                </div>
                <div
                  className="sidebar-organization-menu-separator"
                  role="separator"
                />
                <div className="sidebar-organization-menu-group" role="group">
                  <button
                    onClick={() => setOrganizationMenuView("organizations")}
                    role="menuitem"
                    type="button"
                  >
                    <span>{t("sidebar.switchOrganization")}</span>
                    <ChevronRight
                      aria-hidden="true"
                      size={15}
                      strokeWidth={1.8}
                    />
                  </button>
                  <button
                    onClick={() => {
                      setIsOrganizationMenuOpen(false);
                      setOrganizationMenuView("actions");
                      onLogout();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span>{t("account.logout")}</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <button
                  className="sidebar-organization-menu-back"
                  onClick={() => setOrganizationMenuView("actions")}
                  role="menuitem"
                  type="button"
                >
                  <ChevronLeft aria-hidden="true" size={15} strokeWidth={1.8} />
                  <span>{t("sidebar.switchOrganization")}</span>
                </button>
                <div
                  className="sidebar-organization-menu-separator"
                  role="separator"
                />
                <div
                  aria-label={t("sidebar.organizationList")}
                  className="sidebar-organization-menu-group organization-list"
                  role="group"
                >
                  {organizations.map((organization) => (
                    <button
                      aria-checked={organization.id === activeOrganization?.id}
                      key={organization.id}
                      onClick={() => {
                        onOrganizationChange(organization.id);
                        setIsOrganizationMenuOpen(false);
                        setOrganizationMenuView("actions");
                      }}
                      role="menuitemradio"
                      type="button"
                    >
                      {organization.logo ? (
                        <img
                          alt=""
                          className="sidebar-organization-list-logo"
                          src={organization.logo}
                        />
                      ) : (
                        <Building2 aria-hidden="true" size={15} strokeWidth={1.7} />
                      )}
                      <span>{organization.name}</span>
                      {organization.id === activeOrganization?.id ? (
                        <Check aria-hidden="true" size={15} strokeWidth={1.8} />
                      ) : null}
                    </button>
                  ))}
                </div>
                <div
                  className="sidebar-organization-menu-separator"
                  role="separator"
                />
                <button
                  className="sidebar-organization-add"
                  onClick={() => {
                    setIsOrganizationMenuOpen(false);
                    setOrganizationMenuView("actions");
                    onAddOrganization();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Plus aria-hidden="true" size={15} strokeWidth={1.7} />
                  <span>{t("sidebar.addOrganization")}</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

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
              className="sidebar-unread-dot"
            />
          )}
        </a>
      </nav>

      <div className="sidebar-projects">
        <div className="sidebar-section-heading">
          <span>{t("sidebar.projects")}</span>
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
            const isMenuOpen = project.id === openProjectMenuId;
            const readiness = projectReadiness[project.id];
            const needsConnection = !isProjectConnectedLocally(
              connectedProjectIds,
              project.id,
            );
            const needsAttention =
              !needsConnection && readiness?.requiresGithub && !readiness.prReady;
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
                  className={`sidebar-project-row${needsAttention ? " has-warning" : ""}`}
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
                      className="sidebar-project-heading"
                      onClick={() => selectProject(project.id)}
                      type="button"
                    >
                      <FolderGit2 size={16} strokeWidth={1.7} />
                      <span>{project.name}</span>
                      {isActive && <i aria-label={t("sidebar.currentProject")} />}
                    </button>
                  </div>
                  {needsAttention ? (
                    <button
                      aria-label={t("repositorySetup.open", { name: project.name })}
                      className="sidebar-project-warning"
                      data-project-readiness={project.id}
                      onClick={() => onProjectReadinessOpen(project.id)}
                      title={t("repositorySetup.open", { name: project.name })}
                      type="button"
                    >
                      <span aria-hidden="true">!</span>
                    </button>
                  ) : null}
                  <button
                    aria-controls={`project-menu-${project.id}`}
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
                      <button
                        onClick={() => {
                          setOpenProjectMenuId(null);
                          onProjectSettings(project.id);
                        }}
                        ref={menuItemRef}
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
                        onClick={() => openProjectPage(onCreateIssue)}
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
                                <ProjectAgentAvatar
                                  agent={agent}
                                  isRunning
                                  token={token}
                                />
                                <span>
                                  <strong>{title}</strong>
                                  <small>
                                    <i aria-hidden="true" />
                                    {agent.name}
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
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

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
