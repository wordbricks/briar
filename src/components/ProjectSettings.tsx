import {
  AlertTriangle,
  ArrowLeft,
  LoaderCircle,
  PanelLeftOpen,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Project } from "../types";

export function ProjectSettings({
  isDeleting,
  isSidebarOpen,
  onBack,
  onDelete,
  onSidebarOpen,
  project,
}: {
  isDeleting: boolean;
  isSidebarOpen: boolean;
  onBack: () => void;
  onDelete: () => Promise<unknown>;
  onSidebarOpen: () => void;
  project: Project;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isConfirming) return;
    cancelButtonRef.current?.focus();
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isDeleting) setIsConfirming(false);
    };
    document.addEventListener("keydown", closeWithKeyboard);
    return () => document.removeEventListener("keydown", closeWithKeyboard);
  }, [isConfirming, isDeleting]);

  const confirmDelete = async () => {
    setDeleteError(null);
    try {
      await onDelete();
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <main className="main-content project-settings-page">
      <header className={`topbar${isSidebarOpen ? "" : " sidebar-closed"}`} data-tauri-drag-region>
        {!isSidebarOpen && (
          <button
            aria-controls="app-sidebar"
            aria-expanded="false"
            aria-label="왼쪽 패널 열기"
            className="sidebar-toggle"
            onClick={onSidebarOpen}
            title="왼쪽 패널 열기"
            type="button"
          >
            <PanelLeftOpen size={17} />
          </button>
        )}
        <button className="project-settings-back" onClick={onBack} type="button">
          <ArrowLeft size={16} strokeWidth={1.8} />
          <span>자동사냥으로 돌아가기</span>
        </button>
      </header>

      <div className="project-settings-scroll">
        <div className="project-settings-content">
          <header className="project-settings-heading">
            <p className="eyebrow">PROJECT SETTINGS</p>
            <h1>프로젝트 설정</h1>
            <p>{project.name} 프로젝트의 연결과 데이터를 관리합니다.</p>
          </header>

          <section className="project-settings-card">
            <div>
              <span>프로젝트 이름</span>
              <strong>{project.name}</strong>
            </div>
            <small>생성일 {new Date(project.createdAt).toLocaleDateString("ko-KR")}</small>
          </section>

          <section className="project-settings-danger">
            <div>
              <span className="danger-icon"><AlertTriangle size={18} strokeWidth={1.8} /></span>
              <span>
                <strong>위험 영역</strong>
                <small>프로젝트와 모든 Auto Hunt 기록을 영구적으로 삭제합니다.</small>
              </span>
            </div>
            <button onClick={() => setIsConfirming(true)} type="button">
              <Trash2 size={15} strokeWidth={1.8} />
              프로젝트 삭제
            </button>
          </section>
        </div>
      </div>

      {isConfirming && (
        <div className="dialog-backdrop" role="presentation">
          <section
            aria-describedby="delete-project-description"
            aria-labelledby="delete-project-title"
            aria-modal="true"
            className="delete-project-dialog"
            role="dialog"
          >
            <span className="delete-project-dialog-icon"><Trash2 size={20} strokeWidth={1.8} /></span>
            <h2 id="delete-project-title">{project.name} 프로젝트를 삭제할까요?</h2>
            <p id="delete-project-description">
              프로젝트 설정과 Auto Hunt 기록이 모두 삭제되며 되돌릴 수 없습니다.
            </p>
            {deleteError && <p className="delete-project-error">{deleteError}</p>}
            <footer>
              <button
                disabled={isDeleting}
                onClick={() => setIsConfirming(false)}
                ref={cancelButtonRef}
                type="button"
              >
                취소
              </button>
              <button
                className="delete-project-confirm"
                disabled={isDeleting}
                onClick={() => void confirmDelete()}
                type="button"
              >
                {isDeleting ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
                삭제하기
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
