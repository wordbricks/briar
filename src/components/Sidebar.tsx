import {
  Activity,
  Boxes,
  CircleHelp,
  GitBranch,
  LogOut,
  PanelLeftClose,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";
import type { Project, SessionUser } from "../types";
import { JellySelect } from "./JellySelect";

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
          <PanelLeftClose size={17} />
        </button>
      </div>
      <div className="project-switcher-row">
        <div className="project-switcher">
          <span className="project-icon"><GitBranch size={15} /></span>
          <JellySelect
            className="sidebar-project-select"
            label="프로젝트 선택"
            onValueChange={onProjectChange}
            options={projects.map((project) => ({
              label: project.name,
              value: project.id,
            }))}
            size="small"
            value={activeProjectId ?? ""}
          />
        </div>
        <button
          aria-label="프로젝트 추가"
          className="project-add-button"
          onClick={onAddProject}
          title="프로젝트 추가"
          type="button"
        >
          <Plus size={16} />
        </button>
      </div>
      <nav className="sidebar-nav">
        <p>WORKSPACE</p>
        <a className="active" href="#dashboard"><Activity size={17} />자동사냥</a>
        <a href="#agents"><Sparkles size={17} />Agents<span className="soon">Soon</span></a>
        <button className="sidebar-nav-action" onClick={onAddProject} type="button">
          <Boxes size={17} />Projects<Plus className="nav-action-icon" size={14} />
        </button>
      </nav>
      <div className="sidebar-bottom">
        <a href="#settings"><Settings size={17} />설정</a>
        <a href="#help"><CircleHelp size={17} />도움말</a>
        <div className="user-card">
          <div className="avatar">
            {user.image ? <img src={user.image} alt="" /> : user.name.slice(0, 1).toUpperCase()}
          </div>
          <span><strong>{user.name}</strong><small>{user.email}</small></span>
          <button onClick={onLogout} aria-label="로그아웃"><LogOut size={15} /></button>
        </div>
      </div>
    </aside>
  );
}
