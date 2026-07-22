import {
  ArrowUpRight,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  FolderGit2,
  GitCommitHorizontal,
  GitFork,
  LoaderCircle,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { JellySelect } from "./JellySelect";
import { UpdateControl } from "./UpdateControl";
import { sourceLabel, stageMeta } from "../lib/stages";
import type { AutoHuntHealth } from "../lib/project-connection";
import type { DashboardPayload, HuntRun, HuntSource } from "../types";

type SourceFilter = "all" | HuntSource;
type StatusFilter = "active" | "attention" | "completed";

export function HuntDashboard({
  dashboard,
  demoMode,
  error,
  health,
  healthError,
  healthLoading,
  isCreatingIssue,
  recoveringRunId,
  recoveryError,
  isSidebarOpen,
  onCreateIssue,
  onHealthRefresh,
  onReconnect,
  onRetryRun,
  onCancelRun,
  onRepair,
  onRefresh,
  onSidebarOpen,
}: {
  dashboard: DashboardPayload | null;
  demoMode: boolean;
  error: string | null;
  health: AutoHuntHealth | null;
  healthError: string | null;
  healthLoading: boolean;
  isCreatingIssue: boolean;
  recoveringRunId: string | null;
  recoveryError: string | null;
  isSidebarOpen: boolean;
  onCreateIssue: (input: {
    title: string;
    description: string | null;
    priority: number | null;
  }) => Promise<unknown>;
  onHealthRefresh: () => void;
  onReconnect: () => void;
  onRetryRun: (runId: string) => Promise<unknown>;
  onCancelRun: (runId: string) => Promise<unknown>;
  onRepair: () => void;
  onRefresh: () => void;
  onSidebarOpen: () => void;
}) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isIssueDialogOpen, setIsIssueDialogOpen] = useState(false);

  const runs = dashboard?.runs ?? [];
  const selected = runs.find((run) => run.id === selectedRunId) ?? null;
  const activeCount = runs.filter((run) => !["completed", "cancelled"].includes(run.stage)).length;
  const attentionCount = runs.filter((run) => ["blocked", "failed"].includes(run.stage)).length;
  const completedCount = runs.filter((run) => run.stage === "completed").length;
  const average = activeCount
    ? Math.round(
        runs
          .filter((run) => !["completed", "cancelled"].includes(run.stage))
          .reduce((sum, run) => sum + run.progress, 0) / activeCount,
      )
    : 0;

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return runs.filter((run) => {
      if (source !== "all" && run.source !== source) return false;
      if (status === "active" && ["completed", "cancelled"].includes(run.stage)) return false;
      if (status === "attention" && !["blocked", "failed"].includes(run.stage)) return false;
      if (status === "completed" && run.stage !== "completed") return false;
      return !normalized || `${run.title} ${run.sourceKey} ${run.repository}`.toLowerCase().includes(normalized);
    });
  }, [query, runs, source, status]);

  return (
    <main className="main-content" id="dashboard">
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
        <div className="window-controls" aria-hidden="true"><i /><i /><i /></div>
        <div className="sync-state"><span />D1 연결됨</div>
      </header>
      <div className="dashboard-scroll">
        <section className="page-heading">
          <div>
            <div className="heading-line">
              <p className="eyebrow">AUTO HUNT OVERVIEW</p>
              {demoMode && <span className="demo-badge">DEMO DATA</span>}
            </div>
            <h1>자동사냥</h1>
            <p>에이전트가 처리하는 작업의 흐름과 병목을 한눈에 확인하세요.</p>
          </div>
          <jelly-button className="refresh-button" onClick={onRefresh} size="small" variant="white">
            <RefreshCw size={15} />새로고침
          </jelly-button>
        </section>

        {error && <div className="error-banner"><CircleAlert size={16} />{error}</div>}

        <section className="metric-grid">
          <Metric label="진행 중" value={activeCount} note="자동사냥 작업" icon={<LoaderCircle size={18} />} tone="violet" />
          <Metric label="평균 진행률" value={`${average}%`} note="진행 중 작업 기준" icon={<ActivityRing value={average} />} tone="blue" />
          <Metric label="확인 필요" value={attentionCount} note="차단 또는 실패" icon={<CircleAlert size={18} />} tone="rose" />
          <Metric label="완료" value={completedCount} note="Production QA 통과" icon={<Check size={18} />} tone="emerald" />
        </section>

        <ConnectionHealth
          error={healthError}
          health={health}
          loading={healthLoading}
          onReconnect={onReconnect}
          onRefresh={onHealthRefresh}
          onRepair={onRepair}
        />

        <UpdateControl />

        <jelly-card className="queue-panel">
          <div className="queue-header">
            <div>
              <h2>작업 큐</h2>
              <span>{filtered.length}개 작업</span>
            </div>
            <div className="queue-tools">
              <button className="create-issue-button" onClick={() => setIsIssueDialogOpen(true)} type="button">
                <Plus size={14} />이슈 만들기
              </button>
              <label className="search-box"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="작업 검색" /></label>
              <div className="source-filter">
                {(["all", "issue", "feedback", "error"] as const).map((value) => (
                  <button key={value} className={source === value ? "active" : ""} onClick={() => setSource(value)}>
                    {value === "all" ? "전체" : sourceLabel[value]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="status-tabs">
            <button className={status === "active" ? "active" : ""} onClick={() => setStatus("active")}>진행 중 <span>{activeCount}</span></button>
            <button className={status === "attention" ? "active" : ""} onClick={() => setStatus("attention")}>확인 필요 <span>{attentionCount}</span></button>
            <button className={status === "completed" ? "active" : ""} onClick={() => setStatus("completed")}>완료 <span>{completedCount}</span></button>
          </div>
          <div className="queue-table">
            <div className="queue-table-head"><span>작업</span><span>상태</span><span>진행률</span><span>업데이트</span><span /></div>
            {filtered.length ? filtered.map((run) => <RunRow key={run.id} run={run} onOpen={() => setSelectedRunId(run.id)} />) : (
              <div className="empty-state"><Bot size={25} /><strong>조건에 맞는 자동사냥 작업이 없습니다.</strong><span>필터를 변경하거나 새 작업이 기록될 때까지 기다려주세요.</span></div>
            )}
          </div>
        </jelly-card>
      </div>
      {isIssueDialogOpen && (
        <CreateIssueDialog
          isSubmitting={isCreatingIssue}
          onClose={() => setIsIssueDialogOpen(false)}
          onCreate={async (input) => {
            await onCreateIssue(input);
            setIsIssueDialogOpen(false);
          }}
        />
      )}
      {selected && (
        <RunDialog
          error={recoveryError}
          isRecovering={recoveringRunId === selected.id}
          onCancel={() => onCancelRun(selected.id)}
          onClose={() => setSelectedRunId(null)}
          onRetry={() => onRetryRun(selected.id)}
          run={selected}
        />
      )}
    </main>
  );
}

export function ConnectionHealth({
  error,
  health,
  loading,
  onReconnect,
  onRefresh,
  onRepair,
}: {
  error: string | null;
  health: AutoHuntHealth | null;
  loading: boolean;
  onReconnect: () => void;
  onRefresh: () => void;
  onRepair: () => void;
}) {
  const assetsNeedRepair =
    health && (!health.cliCurrent || !health.skillCurrent);
  return (
    <jelly-card className={`health-panel${health?.healthy ? " healthy" : ""}`}>
      <div className="health-header">
        <div>
          <span className="health-icon"><ShieldCheck size={16} /></span>
          <span><strong>Auto Hunt 연결 상태</strong><small>{health?.healthy ? "실행 준비 완료" : "로컬 실행 환경 검사"}</small></span>
        </div>
        <div className="health-actions">
          {assetsNeedRepair && <button onClick={onRepair} type="button"><Wrench size={13} />CLI·스킬 복구</button>}
          <button onClick={onReconnect} type="button"><FolderGit2 size={13} />저장소 재연결</button>
          <button aria-label="연결 상태 다시 검사" disabled={loading} onClick={onRefresh} type="button"><RefreshCw className={loading ? "spin" : ""} size={13} /></button>
        </div>
      </div>
      {error && <div className="health-error"><CircleAlert size={14} />{error}</div>}
      {health ? (
        <div className="health-grid">
          <HealthItem healthy={health.repositoryHealthy} icon={<FolderGit2 size={15} />} label="저장소" value={health.repositoryPath ?? "연결 안 됨"} />
          <HealthItem healthy={health.cliCurrent} icon={<Terminal size={15} />} label="Briar CLI" value={health.cliVersion ? `v${health.cliVersion}` : "설치 안 됨"} expected={`v${health.cliExpectedVersion}`} />
          <HealthItem healthy={health.skillCurrent} icon={<Bot size={15} />} label="Auto Hunt 스킬" value={health.skillVersion ? `v${health.skillVersion}` : "설치 안 됨"} expected={`v${health.skillExpectedVersion}`} />
          <HealthItem healthy={health.velenHealthy} icon={<ShieldCheck size={15} />} label="Velen" value={health.velenOrg ?? "조직 미설정"} expected={health.velenEmail ?? undefined} />
        </div>
      ) : (
        <div className="health-empty">{loading ? "로컬 Auto Hunt 환경을 검사하고 있습니다…" : "데스크톱 앱에서 연결 상태를 확인할 수 있습니다."}</div>
      )}
      {health && !health.healthy && health.issues.length > 0 && (
        <div className="health-issues">{health.issues.map((issue) => <span key={issue}><CircleAlert size={12} />{issue}</span>)}</div>
      )}
    </jelly-card>
  );
}

function HealthItem({
  expected,
  healthy,
  icon,
  label,
  value,
}: {
  expected?: string;
  healthy: boolean;
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return <div className="health-item"><i className={healthy ? "ok" : "warning"}>{icon}</i><span><small>{label}</small><strong title={value}>{value}</strong>{expected && <em>{expected}</em>}</span><b>{healthy ? "정상" : "확인 필요"}</b></div>;
}

export function CreateIssueDialog({
  isSubmitting,
  onClose,
  onCreate,
}: {
  isSubmitting: boolean;
  onClose: () => void;
  onCreate: (input: {
    title: string;
    description: string | null;
    priority: number | null;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("2");
  const [submitError, setSubmitError] = useState<string | null>(null);

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !isSubmitting && onClose()}>
      <form
        className="issue-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim() || isSubmitting) return;
          setSubmitError(null);
          void onCreate({
            title: title.trim(),
            description: description.trim() || null,
            priority: Number(priority),
          }).catch((error) =>
            setSubmitError(error instanceof Error ? error.message : String(error)),
          );
        }}
        role="dialog"
        aria-modal="true"
        aria-label="새 Auto Hunt 이슈"
      >
        <header>
          <div><p className="eyebrow">AUTO HUNT ISSUE</p><h2>이슈 만들기</h2></div>
          <button disabled={isSubmitting} onClick={onClose} type="button" aria-label="닫기"><X size={18} /></button>
        </header>
        <div className="issue-form-body">
          <label>
            <span>제목 <em>필수</em></span>
            <input autoFocus maxLength={300} onChange={(event) => setTitle(event.target.value)} placeholder="Codex가 해결할 작업을 적어주세요" required value={title} />
          </label>
          <label>
            <span>설명</span>
            <textarea maxLength={100000} onChange={(event) => setDescription(event.target.value)} placeholder="문제, 기대 결과, 참고할 맥락을 적어주세요" rows={6} value={description} />
          </label>
          <JellySelect
            className="issue-priority-select"
            label="우선순위"
            onValueChange={setPriority}
            options={[
              { label: "P1 · 긴급", value: "1" },
              { label: "P2 · 높음", value: "2" },
              { label: "P3 · 보통", value: "3" },
              { label: "P4 · 낮음", value: "4" },
            ]}
            value={priority}
          />
          {submitError && <div className="issue-form-error"><CircleAlert size={14} />{submitError}</div>}
          <p>생성 즉시 작업 큐의 <strong>대기</strong> 상태로 등록됩니다.</p>
        </div>
        <footer>
          <button disabled={isSubmitting} onClick={onClose} type="button">취소</button>
          <button className="issue-submit-button" disabled={isSubmitting || !title.trim()} type="submit">
            {isSubmitting ? <LoaderCircle className="spin" size={14} /> : <Plus size={14} />}
            {isSubmitting ? "등록 중" : "이슈 등록"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function Metric({ label, value, note, icon, tone }: { label: string; value: string | number; note: string; icon: React.ReactNode; tone: string }) {
  return <jelly-card className={`metric-card ${tone}`}><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></jelly-card>;
}

function ActivityRing({ value }: { value: number }) {
  return <span className="mini-ring" style={{ "--ring": `${value * 3.6}deg` } as React.CSSProperties} />;
}

function RunRow({ run, onOpen }: { run: HuntRun; onOpen: () => void }) {
  const meta = stageMeta[run.stage];
  const isClaimed =
    run.stage === "queued" &&
    Boolean(run.leaseExpiresAt) &&
    Date.parse(run.leaseExpiresAt!) > Date.now();
  return (
    <button className="run-row" onClick={onOpen}>
      <span className="run-title-cell"><i className={`source-dot ${run.source}`} /><span><strong>{run.title}</strong><small>AH-{run.runNumber} · {run.repository}{isClaimed && <> · <em>{run.claimedBy ?? "agent"} 할당</em></>}</small></span></span>
      <span><i className={`status-pill ${meta.tone}`}>{run.stage === "implementing" && <LoaderCircle className="spin" size={12} />}{meta.label}</i></span>
      <span className="progress-cell"><span><i style={{ width: `${run.progress}%` }} /></span><small>{run.progress}%</small></span>
      <span className="time-cell">{relativeTime(run.updatedAt)}</span>
      <span className="row-action"><ChevronRight size={16} /></span>
    </button>
  );
}

export function RunDialog({
  error,
  isRecovering,
  onCancel,
  onClose,
  onRetry,
  run,
}: {
  error: string | null;
  isRecovering: boolean;
  onCancel: () => Promise<unknown>;
  onClose: () => void;
  onRetry: () => Promise<unknown>;
  run: HuntRun;
}) {
  const meta = stageMeta[run.stage];
  const needsAttention = ["blocked", "failed"].includes(run.stage);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const runAction = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setConfirmCancel(false);
    } catch {
      // The hook exposes the actionable error in this dialog.
    }
  };
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="run-dialog" role="dialog" aria-modal="true" aria-label={`${run.title} 상세`}>
        <header><div><span className={`status-pill ${meta.tone}`}>{meta.label}</span><small>AH-{run.runNumber} · 시도 {run.currentAttempt}</small></div><button onClick={onClose} aria-label="닫기"><X size={18} /></button></header>
        <div className="dialog-body">
          <p className="eyebrow">{sourceLabel[run.source].toUpperCase()} · {run.repository}</p>
          <h2>{run.title}</h2>
          <p className="run-detail">{run.detail}</p>
          {needsAttention && (
            <div className="recovery-panel">
              <div><CircleAlert size={16} /><span><strong>{run.stage === "failed" ? "실행이 실패했습니다" : "진행이 차단되었습니다"}</strong><small>이전 시도의 활동 기록은 보존됩니다. 재시도하면 {run.currentAttempt + 1}번 시도로 새 작업이 시작됩니다.</small></span></div>
              {error && <p><CircleAlert size={13} />{error}</p>}
              <div className="recovery-actions">
                <button disabled={isRecovering} onClick={() => void runAction(onRetry)} type="button"><RotateCcw className={isRecovering ? "spin" : ""} size={14} />재시도</button>
                {confirmCancel ? (
                  <><button className="danger" disabled={isRecovering} onClick={() => void runAction(onCancel)} type="button">취소 확정</button><button disabled={isRecovering} onClick={() => setConfirmCancel(false)} type="button">돌아가기</button></>
                ) : (
                  <button className="danger-secondary" disabled={isRecovering} onClick={() => setConfirmCancel(true)} type="button">작업 취소</button>
                )}
              </div>
            </div>
          )}
          <div className="large-progress"><div><span>전체 진행률</span><strong>{run.progress}%</strong></div><i><b style={{ width: `${run.progress}%` }} /></i></div>
          <div className="run-facts">
            <span><GitFork size={15} /><small>브랜치</small><strong>{run.branch ?? "—"}</strong></span>
            <span><GitCommitHorizontal size={15} /><small>커밋</small><strong>{run.commitSha ?? "—"}</strong></span>
            <span><Clock3 size={15} /><small>시작</small><strong>{formatDate(run.startedAt)}</strong></span>
          </div>
          <div className="timeline"><h3>활동 기록</h3>{run.events.map((event) => <div className="timeline-event" key={event.id}><i className={stageMeta[event.stage].tone} /><span><strong>{stageMeta[event.stage].label} <em>시도 {event.attempt}</em></strong><p>{event.detail}</p><small>{event.actor} · {relativeTime(event.occurredAt)}</small></span></div>)}</div>
        </div>
        <footer><span>{needsAttention ? "실패 이력과 증거는 재시도 후에도 보존됩니다." : "Auto Hunt 실행 증거를 실시간으로 표시합니다."}</span><button><ArrowUpRight size={14} />로컬 저장소 열기</button></footer>
      </section>
    </div>
  );
}

function relativeTime(value: string) {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}시간 전`;
  return `${Math.floor(minutes / 1_440)}일 전`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
