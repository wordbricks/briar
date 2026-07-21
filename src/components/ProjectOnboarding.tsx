import { ArrowRight, Check, Copy, FolderGit2, LogOut } from "lucide-react";
import { useMemo, useState } from "react";
import type { ProjectConnection } from "../hooks/useBriar";
import type { SessionUser } from "../types";
import { Logo } from "./Logo";

type Props = {
  connection: ProjectConnection | null;
  error: string | null;
  loading: boolean;
  onComplete: () => void;
  onCreate: (input: { name: string; repositoryPath: string }) => Promise<unknown>;
  onLogout: () => void;
  user: SessionUser;
};

export function ProjectOnboarding({
  connection,
  error,
  loading,
  onComplete,
  onCreate,
  onLogout,
  user,
}: Props) {
  const [name, setName] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [copied, setCopied] = useState(false);
  const connectCommand = useMemo(
    () =>
      connection
        ? `briar connect --project-id ${connection.project.id} --agent-token ${connection.agentToken} --repository "${connection.project.repositoryPath}"`
        : "",
    [connection],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onCreate({ name, repositoryPath }).catch(() => undefined);
  };

  const copyCommand = async () => {
    await navigator.clipboard.writeText(connectCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <main className="onboarding-shell">
      <header className="onboarding-topbar">
        <Logo />
        <button onClick={onLogout} type="button">
          <LogOut size={13} /> {user.email}
        </button>
      </header>
      <section className="onboarding-card">
        <div className="onboarding-icon">
          {connection ? <Check size={22} /> : <FolderGit2 size={22} />}
        </div>
        {connection ? (
          <>
            <p className="eyebrow">AGENT CONNECTION</p>
            <h1>{connection.project.name} 준비 완료</h1>
            <p className="onboarding-copy">
              아래 명령을 저장소에서 한 번 실행하세요. Agent가 기록한 Auto Hunt
              상태가 이 프로젝트 대시보드에 표시됩니다.
            </p>
            <div className="command-block">
              <code>{connectCommand}</code>
              <button aria-label="연결 명령 복사" onClick={() => void copyCommand()} type="button">
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>
            <p className="token-warning">
              Agent 토큰은 지금 한 번만 표시됩니다. 명령을 복사한 뒤 대시보드로 이동하세요.
            </p>
            <button className="primary-action" onClick={onComplete} type="button">
              대시보드 열기 <ArrowRight size={15} />
            </button>
          </>
        ) : (
          <>
            <p className="eyebrow">FIRST PROJECT</p>
            <h1>로컬 저장소 연결</h1>
            <p className="onboarding-copy">
              Briar는 저장소 코드를 업로드하지 않습니다. 로컬 Agent가 전송하는 작업
              상태와 Git 메타데이터만 표시합니다.
            </p>
            <form className="project-form" onSubmit={(event) => void submit(event)}>
              <label>
                프로젝트 이름
                <input
                  autoFocus
                  maxLength={100}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="wordbricks"
                  required
                  value={name}
                />
              </label>
              <label>
                로컬 저장소 경로
                <input
                  maxLength={1000}
                  onChange={(event) => setRepositoryPath(event.target.value)}
                  placeholder="/Users/me/git/wordbricks"
                  required
                  value={repositoryPath}
                />
              </label>
              {error ? <div className="login-error">{error}</div> : null}
              <button className="primary-action" disabled={loading} type="submit">
                {loading ? "연결 중…" : "프로젝트 만들기"} <ArrowRight size={15} />
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
