import {
  Activity,
  Boxes,
  ChevronDown,
  CircleHelp,
  GitBranch,
  LogOut,
  Settings,
  Sparkles,
} from "lucide-react";
import type { Project, SessionUser } from "../types";
import { Logo } from "./Logo";

export function Sidebar({
  activeProjectId,
  onProjectChange,
  onLogout,
  projects,
  user,
}: {
  activeProjectId: string | null;
  onProjectChange: (projectId: string) => void;
  onLogout: () => void;
  projects: Project[];
  user: SessionUser;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand" data-tauri-drag-region>
        <Logo />
      </div>
      <button className="project-switcher">
        <span className="project-icon"><GitBranch size={15} /></span>
        <span>
          <small>PROJECT</small>
          <select
            value={activeProjectId ?? ""}
            onChange={(event) => onProjectChange(event.target.value)}
            aria-label="프로젝트 선택"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </span>
        <ChevronDown size={14} />
      </button>
      <nav className="sidebar-nav">
        <p>WORKSPACE</p>
        <a className="active" href="#dashboard"><Activity size={17} />자동사냥</a>
        <a href="#agents"><Sparkles size={17} />Agents<span className="soon">Soon</span></a>
        <a href="#projects"><Boxes size={17} />Projects</a>
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
