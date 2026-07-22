import {
  Activity,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Ellipsis,
  FolderGit2,
  LogOut,
  PanelLeftClose,
  Plus,
  Settings,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Project, SessionUser } from "../types";
import { UpdateControl } from "./UpdateControl";

export function Sidebar({
  activePage,
  activeProjectId,
  isOpen,
  onAddProject,
  onDashboardOpen,
  onProjectChange,
  onProjectSettings,
  onLogout,
  onToggle,
  projects,
  user,
}: {
  activePage: "dashboard" | "project-settings";
  activeProjectId: string | null;
  isOpen: boolean;
  onAddProject: () => void;
  onDashboardOpen: () => void;
  onProjectChange: (projectId: string) => void;
  onProjectSettings: (projectId: string) => void;
  onLogout: () => void;
  onToggle: () => void;
  projects: Project[];
  user: SessionUser;
}) {
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuItemRef = useRef<HTMLButtonElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

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
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsAccountMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isAccountMenuOpen]);

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
          aria-label="왼쪽 패널 닫기"
          className="sidebar-toggle"
          onClick={onToggle}
          title="왼쪽 패널 닫기"
          type="button"
        >
          <PanelLeftClose size={16} strokeWidth={1.7} />
        </button>
      </div>

      <div className="sidebar-brand" data-tauri-drag-region>
        <span>Briar</span>
        <ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} />
      </div>

      <nav aria-label="주요 메뉴" className="sidebar-primary-nav">
        <a href="#help"><CircleHelp size={16} strokeWidth={1.7} />도움말</a>
      </nav>

      <div className="sidebar-projects">
        <div className="sidebar-section-heading">
          <span>Projects</span>
          <button
            aria-label="프로젝트 추가"
            onClick={onAddProject}
            title="프로젝트 추가"
            type="button"
          >
            <Plus size={17} strokeWidth={1.6} />
          </button>
        </div>

        <div className="sidebar-project-list">
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            const isMenuOpen = project.id === openProjectMenuId;

            return (
              <section className="sidebar-project-group" key={project.id}>
                <div className="sidebar-project-row">
                  <button
                    aria-expanded={isActive}
                    className="sidebar-project-heading"
                    onClick={() => onProjectChange(project.id)}
                    type="button"
                  >
                    <FolderGit2 size={16} strokeWidth={1.7} />
                    <span>{project.name}</span>
                    {isActive && <i aria-label="현재 프로젝트" />}
                  </button>
                  <button
                    aria-controls={`project-menu-${project.id}`}
                    aria-expanded={isMenuOpen}
                    aria-haspopup="menu"
                    aria-label={`${project.name} 프로젝트 메뉴`}
                    className="sidebar-project-menu-trigger"
                    onClick={(event) => {
                      setIsAccountMenuOpen(false);
                      menuTriggerRef.current = event.currentTarget;
                      setOpenProjectMenuId(isMenuOpen ? null : project.id);
                    }}
                    title={`${project.name} 메뉴`}
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
                        <span>프로젝트 설정</span>
                      </button>
                    </div>
                  )}
                </div>
                {isActive && (
                  <a
                    aria-current={activePage === "dashboard" ? "page" : undefined}
                    className={`sidebar-project-view${activePage === "dashboard" ? " active" : ""}`}
                    href="#dashboard"
                    onClick={onDashboardOpen}
                  >
                    <Activity size={14} strokeWidth={1.7} />
                    <span>자동사냥</span>
                  </a>
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
              <div aria-label="계정 메뉴" className="account-popover" role="menu">
                <div className="account-popover-identity">
                  <div className="avatar">
                    {user.image ? <img src={user.image} alt="" /> : user.name.slice(0, 1).toUpperCase()}
                  </div>
                  <span><strong>{user.name}</strong><small>{user.email}</small></span>
                </div>
                <div className="account-popover-separator" />
                <a href="#settings" onClick={() => setIsAccountMenuOpen(false)} role="menuitem">
                  <Settings size={16} strokeWidth={1.7} />
                  <span>설정</span>
                </a>
                <button onClick={onLogout} role="menuitem" type="button">
                  <LogOut size={16} strokeWidth={1.7} />
                  <span>로그아웃</span>
                </button>
              </div>
            )}
            <button
              aria-expanded={isAccountMenuOpen}
              aria-haspopup="menu"
              aria-label="계정 메뉴"
              className="user-card"
              onClick={() => {
                setOpenProjectMenuId(null);
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
