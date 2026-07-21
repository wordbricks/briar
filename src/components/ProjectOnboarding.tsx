import {
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
import { Logo } from "./Logo";

type Props = {
  connection: ProjectConnection | null;
  error: string | null;
  loading: boolean;
  onConnect: (settings: LocalAutoHuntConfig) => Promise<unknown>;
  onCreate: (input: { name: string }) => Promise<unknown>;
  onLogout: () => void;
  onVelenOrgChange: (org?: string | null) => Promise<VelenInspection | null>;
  user: SessionUser;
  velen: VelenInspection | null;
};

function elementValue(event: React.FormEvent<HTMLElement>) {
  return (event.currentTarget as HTMLElement & { value?: string }).value ?? "";
}

export function ProjectOnboarding({
  connection,
  error,
  loading,
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
        <button onClick={onLogout} type="button">
          <LogOut size={14} /> {user.email}
        </button>
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
                      <select
                        aria-label="Velen 조직"
                        className="native-select"
                        value={velenOrg}
                        onChange={(event) => {
                          const org = event.currentTarget.value;
                          setVelenOrg(org);
                          setLinearSource("");
                          void onVelenOrgChange(org);
                        }}
                      >
                        {velen.organizations.map((organization) => (
                          <option key={organization.slug} value={organization.slug}>
                            {organization.name}
                          </option>
                        ))}
                      </select>
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
                      <select className="native-select" aria-label="Linear 소스" value={linearSource} onChange={(event) => setLinearSource(event.currentTarget.value)}>
                        {linearSources.map((source) => <option key={source.sourceRef} value={source.sourceRef}>{source.sourceKey}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>팀 키 <small>선택</small></span>
                      <jelly-input label="Linear 팀 키" placeholder="예: WRD" value={linearTeam} onInput={(event) => setLinearTeam(elementValue(event))} />
                    </label>
                  </div>
                ) : null}
              </section>
            </div>

            {error ? <jelly-alert variant="rose" className="login-error">{error}</jelly-alert> : null}
            <jelly-button
              block
              disabled={loading || !velen || !velenOrg || (linearEnabled && !linearSource)}
              onClick={() => void connect()}
              size="large"
              variant="mint"
            >
              {loading ? "연결하는 중…" : "저장소 선택하고 Auto Hunt 연결"} <ArrowRight size={17} />
            </jelly-button>
            <p className="token-warning">
              경로, Agent 토큰, Velen 설정은 이 컴퓨터의 Briar 설정에 자동 저장됩니다.
              터미널 명령은 필요 없습니다.
            </p>
          </>
        ) : (
          <>
            <p className="eyebrow">FIRST PROJECT</p>
            <h1>프로젝트 만들기</h1>
            <p className="onboarding-copy">
              대시보드 프로젝트를 만든 다음 Git 저장소와 Velen을 연결하세요.
            </p>
            <form className="project-form" onSubmit={(event) => void submit(event)}>
              <label>
                <span>프로젝트 이름</span>
                <jelly-input
                  label="프로젝트 이름"
                  placeholder="wordbricks"
                  value={name}
                  onInput={(event) => setName(elementValue(event))}
                />
              </label>
              {error ? <jelly-alert variant="rose" className="login-error">{error}</jelly-alert> : null}
              <jelly-button block disabled={loading || !name.trim()} type="submit" size="large" variant="mint">
                {loading ? "만드는 중…" : "프로젝트 만들기"} <ArrowRight size={17} />
              </jelly-button>
            </form>
          </>
        )}
      </jelly-card>
    </jelly-theme>
  );
}
