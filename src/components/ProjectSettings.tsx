import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  GitBranch,
  LoaderCircle,
  PanelLeftOpen,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  loadProjectLlmSettings,
  updateProjectLlmSettings,
  type ApprovalPolicy,
} from "../lib/project-llm";
import type { DashboardPayload, Project } from "../types";

const approvalPolicyDescriptions: Record<ApprovalPolicy, string> = {
  untrusted: "신뢰된 읽기 명령 외의 작업을 실행하기 전에 승인을 요청합니다.",
  "on-request": "Codex가 읽기 전용 경계를 넘어야 할 때 승인을 요청합니다.",
  never: "승인 요청을 표시하지 않고 허용된 범위 안에서만 동작합니다.",
};

export function ProjectSettings({
  dashboard,
  isDeleting,
  isSidebarOpen,
  onBack,
  onDelete,
  onSidebarOpen,
  project,
}: {
  dashboard: DashboardPayload | null;
  isDeleting: boolean;
  isSidebarOpen: boolean;
  onBack: () => void;
  onDelete: () => Promise<unknown>;
  onSidebarOpen: () => void;
  project: Project;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>("never");
  const [savedApprovalPolicy, setSavedApprovalPolicy] =
    useState<ApprovalPolicy>("never");
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [workflowCopied, setWorkflowCopied] = useState(false);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const workflow = dashboard?.settings.workflow ?? null;
  const workflowContract = workflow
    ? {
        version: workflow.version,
        stages: workflow.stages,
        completion: workflow.completion,
        release: workflow.release,
      }
    : null;
  const workflowJson = workflowContract
    ? JSON.stringify(workflowContract, null, 2)
    : "";

  useEffect(() => {
    let cancelled = false;
    setSettingsLoading(true);
    setSettingsError(null);
    void loadProjectLlmSettings(project.id)
      .then((settings) => {
        if (cancelled) return;
        setApprovalPolicy(settings.approvalPolicy);
        setSavedApprovalPolicy(settings.approvalPolicy);
      })
      .catch((caught) => {
        if (!cancelled) {
          setSettingsError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (!cancelled) setSettingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

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

  const saveLlmSettings = async () => {
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const settings = await updateProjectLlmSettings(project.id, { approvalPolicy });
      setApprovalPolicy(settings.approvalPolicy);
      setSavedApprovalPolicy(settings.approvalPolicy);
    } catch (caught) {
      setSettingsError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSettingsSaving(false);
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

          <section className="project-settings-automation">
            <header>
              <span className="project-settings-automation-icon">
                <GitBranch size={18} strokeWidth={1.8} />
              </span>
              <span>
                <strong>Auto Hunt 실행 워크플로</strong>
                <small>단계별 증거와 검증 명령, 완료·릴리스 조건을 정의한 실행 계약입니다.</small>
              </span>
              {workflowContract ? (
                <button
                  aria-label="워크플로 JSON 복사"
                  onClick={() => {
                    void navigator.clipboard.writeText(workflowJson).then(() => {
                      setWorkflowCopied(true);
                      window.setTimeout(() => setWorkflowCopied(false), 1_500);
                    });
                  }}
                  type="button"
                >
                  {workflowCopied ? <Check size={14} /> : <Copy size={14} />}
                  {workflowCopied ? "복사됨" : "JSON 복사"}
                </button>
              ) : null}
            </header>
            {workflowContract ? (
              <div className="project-workflow-contract">
                <div>
                  <span>저장소</span>
                  <strong>{dashboard?.settings.githubRepository ?? "연결된 저장소 없음"}</strong>
                </div>
                <pre aria-label="Auto Hunt 워크플로 JSON"><code>{workflowJson}</code></pre>
              </div>
            ) : (
              <p className="project-settings-empty">워크플로 정보를 불러오는 중입니다.</p>
            )}
          </section>

          <section className="project-settings-llm">
            <header>
              <span className="project-settings-llm-icon">
                <ShieldCheck size={18} strokeWidth={1.8} />
              </span>
              <span>
                <strong>LLM 승인 정책</strong>
                <small>이 프로젝트에서 시작하는 Codex App Server 대화에 적용됩니다.</small>
              </span>
            </header>
            <div className="project-settings-llm-control">
              <label htmlFor="project-approval-policy">승인 요청</label>
              <select
                disabled={settingsLoading || settingsSaving}
                id="project-approval-policy"
                onChange={(event) =>
                  setApprovalPolicy(event.currentTarget.value as ApprovalPolicy)
                }
                value={approvalPolicy}
              >
                <option value="untrusted">신뢰하지 않은 명령만 묻기</option>
                <option value="on-request">필요할 때 묻기</option>
                <option value="never">묻지 않기</option>
              </select>
              <button
                disabled={
                  settingsLoading ||
                  settingsSaving ||
                  approvalPolicy === savedApprovalPolicy
                }
                onClick={() => void saveLlmSettings()}
                type="button"
              >
                {settingsSaving ? (
                  <LoaderCircle className="spin" size={14} />
                ) : approvalPolicy === savedApprovalPolicy ? (
                  <Check size={14} />
                ) : null}
                {settingsSaving
                  ? "저장 중"
                  : approvalPolicy === savedApprovalPolicy
                    ? "저장됨"
                    : "저장"}
              </button>
            </div>
            <p>{approvalPolicyDescriptions[approvalPolicy]}</p>
            {settingsError && <p className="project-settings-llm-error">{settingsError}</p>}
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
