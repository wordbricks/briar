import {
  ArrowLeft,
  ArrowRight,
  Check,
  Database,
  FolderGit2,
  FolderOpen,
  Link2,
  LogOut,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProjectConnection } from "../hooks/useBriar";
import type {
  LocalAutoHuntConfig,
  VelenInspection,
} from "../lib/project-connection";
import type { SessionUser } from "../types";
import { JellySelect } from "./JellySelect";
import { Logo } from "./Logo";

type Props = {
  canCancel?: boolean;
  connection: ProjectConnection | null;
  error: string | null;
  loading: boolean;
  onCancel: () => void;
  onConnect: (settings: LocalAutoHuntConfig) => Promise<unknown>;
  onCreate: (input: { name: string }) => Promise<unknown>;
  onLogout: () => void;
  onVelenOrgChange: (org?: string | null) => Promise<VelenInspection | null>;
  user: SessionUser;
  velen: VelenInspection | null;
};

export function ProjectOnboarding({
  canCancel = false,
  connection,
  error,
  loading,
  onCancel,
  onConnect,
  onCreate,
  onLogout,
  onVelenOrgChange,
  user,
  velen,
}: Props) {
  const [name, setName] = useState("");
  const [velenOrg, setVelenOrg] = useState("");
  const [linearEnabled, setLinearEnabled] = useState(false);
  const [linearSource, setLinearSource] = useState("");
  const [linearTeam, setLinearTeam] = useState("");

  useEffect(() => {
    if (!velen || velenOrg) return;
    setVelenOrg(velen.currentOrg ?? velen.organizations[0]?.slug ?? "");
  }, [velen, velenOrg]);

  const linearSources = useMemo(
    () =>
      (velen?.sources ?? []).filter(
        (source) => source.provider === "linear" && source.status === "active",
      ),
    [velen],
  );

  useEffect(() => {
    if (!linearSource && linearSources[0]) {
      setLinearSource(linearSources[0].sourceRef);
    }
  }, [linearSource, linearSources]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onCreate({ name }).catch(() => undefined);
  };

  const connect = async () => {
    if (!velenOrg) return;
    await onConnect({
      velenOrg,
      linearEnabled,
      linearSource: linearEnabled ? linearSource || null : null,
      linearTeam: linearEnabled ? linearTeam || null : null,
    }).catch(() => undefined);
  };

  return (
    <jelly-theme mode="light" className="onboarding-shell">
      <header className="onboarding-topbar">
        <Logo />
        <div className="onboarding-topbar-actions">
          {canCancel ? (
            <button onClick={onCancel} type="button">
              <ArrowLeft size={14} /> 대시보드로 돌아가기
            </button>
          ) : null}
          <button onClick={onLogout} type="button">
            <LogOut size={14} /> {user.email}
          </button>
        </div>
      </header>
      <jelly-card className="onboarding-card">
        <div className="onboarding-icon">
          {connection ? <Check size={24} /> : <FolderGit2 size={24} />}
        </div>
        {connection ? (
          <>
            <p className="eyebrow">AUTO HUNT CONNECTION</p>
            <h1>{connection.project.name} 연결</h1>
            <p className="onboarding-copy">
              Git 저장소와 Velen 조직을 선택하면 Briar가 Agent 설정을 자동으로
              저장합니다. Linear 연결은 선택 사항입니다.
            </p>

            <div className="setup-grid">
              <section className="setup-section">
                <div className="setup-section-heading">
                  <FolderOpen size={18} />
                  <div><strong>로컬 Git 저장소</strong><span>연결할 때 macOS 폴더 선택기가 열립니다.</span></div>
                </div>
              </section>

              <section className="setup-section">
                <div className="setup-section-heading">
                  <Database size={18} />
                  <div>
                    <strong>Velen CLI <em>필수</em></strong>
                    <span>{velen ? `${velen.email ?? "로그인됨"} · 인증 확인` : "설치 및 로그인을 확인하는 중…"}</span>
                  </div>
                  <button className="icon-action" onClick={() => void onVelenOrgChange(velenOrg)} type="button" aria-label="Velen 새로고침">
                    <RefreshCw size={15} />
                  </button>
                </div>
                {velen ? (
                  <div className="settings-fields single-field">
                    <label>
                      <span>조직</span>
                      <JellySelect
                        label="Velen 조직"
                        options={velen.organizations.map((organization) => ({
                          label: organization.name,
                          value: organization.slug,
                        }))}
                        value={velenOrg}
                        onValueChange={(org) => {
                          setVelenOrg(org);
                          setLinearSource("");
                          void onVelenOrgChange(org);
                        }}
                      />
                    </label>
                  </div>
                ) : null}
              </section>

              <section className="setup-section">
                <div className="setup-section-heading">
                  <Link2 size={18} />
                  <div><strong>Linear 연동</strong><span>연결하지 않아도 Auto Hunt는 정상 동작합니다.</span></div>
                  <jelly-switch
                    aria-label="Linear 연동"
                    checked={linearEnabled}
                    disabled={!velen}
                    size="small"
                    variant="mint"
                    onChange={(event) => setLinearEnabled((event.currentTarget as HTMLElement & { checked?: boolean }).checked ?? false)}
                  />
                </div>
                {linearEnabled ? (
                  <div className="settings-fields">
                    <label>
                      <span>Linear 소스</span>
                      <JellySelect
                        label="Linear 소스"
                        onValueChange={setLinearSource}
                        options={linearSources.map((source) => ({
                          label: source.sourceKey,
                          value: source.sourceRef,
                        }))}
                        placeholder="Linear 소스 선택"
                        value={linearSource}
                      />
                    </label>
                    <label>
                      <span>팀 키 <small>선택</small></span>
                      <input
                        aria-label="Linear 팀 키"
                        className="native-input"
                        onChange={(event) => setLinearTeam(event.currentTarget.value)}
                        placeholder="예: WRD"
                        value={linearTeam}
                      />
                    </label>
                  </div>
                ) : null}
              </section>
            </div>

            {error ? <jelly-alert variant="rose" className="login-error">{error}</jelly-alert> : null}
            <button
              className="onboarding-primary-action"
              disabled={loading || !velen || !velenOrg || (linearEnabled && !linearSource)}
              onClick={() => void connect()}
              type="button"
            >
              {loading ? "연결하는 중…" : "저장소 선택하고 Auto Hunt 연결"} <ArrowRight size={17} />
            </button>
            <p className="token-warning">
              경로, Agent 토큰, Velen 설정은 이 컴퓨터의 Briar 설정에 자동 저장됩니다.
              터미널 명령은 필요 없습니다.
            </p>
          </>
        ) : (
          <>
            <p className="eyebrow">{canCancel ? "NEW PROJECT" : "FIRST PROJECT"}</p>
            <h1>{canCancel ? "프로젝트 추가" : "프로젝트 만들기"}</h1>
            <p className="onboarding-copy">
              {canCancel
                ? "새 대시보드 프로젝트를 만든 다음 Git 저장소와 Velen을 연결하세요."
                : "대시보드 프로젝트를 만든 다음 Git 저장소와 Velen을 연결하세요."}
            </p>
            <form className="project-form" onSubmit={(event) => void submit(event)}>
              <label>
                <span>프로젝트 이름</span>
                <input
                  aria-label="프로젝트 이름"
                  className="native-input"
                  onChange={(event) => setName(event.currentTarget.value)}
                  placeholder="wordbricks"
                  value={name}
                />
              </label>
              {error ? <jelly-alert variant="rose" className="login-error">{error}</jelly-alert> : null}
              <button
                className="onboarding-primary-action"
                disabled={loading || !name.trim()}
                type="submit"
              >
                {loading ? "만드는 중…" : "프로젝트 만들기"} <ArrowRight size={17} />
              </button>
            </form>
          </>
        )}
      </jelly-card>
    </jelly-theme>
  );
}
