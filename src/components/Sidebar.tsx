import {
  Activity,
  Bot,
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Check,
  CircleHelp,
  Ellipsis,
  FolderGit2,
  LogOut,
  PanelLeftClose,
  Plus,
  Settings,
  Languages,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n, type Locale } from "../i18n";
import type { Project, SessionUser } from "../types";
import { UpdateControl } from "./UpdateControl";

export function Sidebar({
  activePage,
  activeProjectId,
  isOpen,
  onAddProject,
  onAutoHuntOpen,
  onIssuesOpen,
  onOrganizationSettings,
  onProjectChange,
  onProjectSettings,
  onLogout,
  onToggle,
  projects,
  user,
}: {
  activePage: "issues" | "auto-hunt" | "project-settings" | "organization-settings";
  activeProjectId: string | null;
  isOpen: boolean;
  onAddProject: () => void;
  onAutoHuntOpen: () => void;
  onIssuesOpen: () => void;
  onOrganizationSettings: (organizationId: string) => void;
  onProjectChange: (projectId: string) => void;
  onProjectSettings: (projectId: string) => void;
  onLogout: () => void;
  onToggle: () => void;
  projects: Project[];
  user: SessionUser;
}) {
  const { locale, setLocale, t } = useI18n();
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

  return (
    <aside
      aria-hidden={!isOpen}
      className={`sidebar${isOpen ? "" : " sidebar-collapsed"}`}
      inert={!isOpen ? true : undefined}
      id="app-sidebar"
    >
      <div className="sidebar-toolbar" data-tauri-drag-region>
        <button
          aria-controls="app-sidebar"
          aria-expanded="true"
          aria-label={t("sidebar.close")}
          className="sidebar-toggle"
          onClick={onToggle}
          title={t("sidebar.close")}
          type="button"
        >
          <PanelLeftClose size={16} strokeWidth={1.7} />
        </button>
      </div>

      <div className="sidebar-brand" data-tauri-drag-region>
        <span>Briar</span>
        <ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} />
      </div>

      <nav aria-label={t("sidebar.mainMenu")} className="sidebar-primary-nav">
        <a href="#help"><CircleHelp size={16} strokeWidth={1.7} />{t("sidebar.help")}</a>
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
          {projects.map((project, index) => {
            const isActive = project.id === activeProjectId;
            const isMenuOpen = project.id === openProjectMenuId;
            const organizationName = project.organizationName ?? "내 조직";
            const startsOrganization =
              index === 0 ||
              (projects[index - 1]?.organizationId ?? "personal") !==
                (project.organizationId ?? "personal");

            return (
              <section className="sidebar-project-group" key={project.id}>
                {startsOrganization && (
                  <button
                    className="sidebar-organization-heading"
                    onClick={() =>
                      onOrganizationSettings(
                        project.organizationId ?? project.id,
                      )
                    }
                    type="button"
                  >
                    <Building2 size={14} strokeWidth={1.7} />
                    <span>{organizationName}</span>
                  </button>
                )}
                <div className="sidebar-project-row">
                  <button
                    aria-expanded={isActive}
                    className="sidebar-project-heading"
                    onClick={() => onProjectChange(project.id)}
                    type="button"
                  >
                    <FolderGit2 size={16} strokeWidth={1.7} />
                    <span>{project.name}</span>
                    {isActive && <i aria-label={t("sidebar.currentProject")} />}
                  </button>
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
                {isActive && (
                  <div className="sidebar-project-views">
                    <a
                      aria-current={activePage === "issues" ? "page" : undefined}
                      className={`sidebar-project-view${activePage === "issues" ? " active" : ""}`}
                      href="#issues"
                      onClick={onIssuesOpen}
                    >
                      <Activity size={14} strokeWidth={1.7} />
                      <span>{t("sidebar.issues")}</span>
                    </a>
                    <a
                      aria-current={activePage === "auto-hunt" ? "page" : undefined}
                      className={`sidebar-project-view${activePage === "auto-hunt" ? " active" : ""}`}
                      href="#auto-hunt"
                      onClick={onAutoHuntOpen}
                    >
                      <Bot size={14} strokeWidth={1.7} />
                      <span>{t("sidebar.autoHunt")}</span>
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
                <a href="#settings" onClick={() => { setIsAccountMenuOpen(false); setIsLanguageMenuOpen(false); }} role="menuitem">
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
