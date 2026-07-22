import {
  Activity,
  ChevronDown,
  CircleHelp,
  FolderGit2,
  LogOut,
  PanelLeftClose,
  Plus,
  Settings,
} from "lucide-react";
import type { Project, SessionUser } from "../types";

export function Sidebar({
  activeProjectId,
  isOpen,
  onAddProject,
  onProjectChange,
  onLogout,
  onToggle,
  projects,
  user,
}: {
  activeProjectId: string | null;
  isOpen: boolean;
  onAddProject: () => void;
  onProjectChange: (projectId: string) => void;
  onLogout: () => void;
  onToggle: () => void;
  projects: Project[];
  user: SessionUser;
}) {
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
        <a href="#settings"><Settings size={16} strokeWidth={1.7} />설정</a>
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

            return (
              <section className="sidebar-project-group" key={project.id}>
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
                {isActive && (
                  <a
                    aria-current="page"
                    className="sidebar-project-view active"
                    href="#dashboard"
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
        <div className="user-card">
          <div className="avatar">
            {user.image ? <img src={user.image} alt="" /> : user.name.slice(0, 1).toUpperCase()}
          </div>
          <span>
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </span>
          <button onClick={onLogout} aria-label="로그아웃" title="로그아웃" type="button">
            <LogOut size={15} strokeWidth={1.7} />
          </button>
        </div>
      </div>
    </aside>
  );
}
