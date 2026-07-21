import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { Logo } from "./Logo";

export function LoginScreen({
  error,
  loading,
  loginCode,
  onLogin,
}: {
  error: string | null;
  loading: boolean;
  loginCode: string | null;
  onLogin: () => void;
}) {
  return (
    <main className="login-shell">
      <div className="login-glow" />
      <section className="login-card">
        <Logo />
        <div className="login-copy">
          <p className="eyebrow">AGENT DEVELOPMENT ENVIRONMENT</p>
          <h1>에이전트의 작업을<br />한눈에 지켜보세요.</h1>
          <p>
            로컬 저장소에 Briar를 연결하면 Codex의 자동사냥 진행 상태가
            실시간 대시보드에 기록됩니다.
          </p>
        </div>
        {loginCode ? (
          <div className="device-code-card">
            <span>브라우저에서 로그인 후 이 코드를 승인하세요</span>
            <strong>{loginCode}</strong>
            <small>승인을 기다리고 있습니다…</small>
          </div>
        ) : (
          <button className="google-button" onClick={onLogin} disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={18} /> : <GoogleIcon />}
            Google로 계속하기
            <ArrowUpRight size={16} />
          </button>
        )}
        {error && <p className="login-error">{error}</p>}
        <p className="login-footnote">로그인은 시스템 브라우저에서 안전하게 진행됩니다.</p>
      </section>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M21.35 12.18c0-.64-.06-1.25-.16-1.84H12v3.48h5.25a4.5 4.5 0 0 1-1.95 2.95v2.26h3.16c1.85-1.7 2.89-4.22 2.89-6.85Z" />
      <path fill="#34A853" d="M12 21.72c2.64 0 4.86-.88 6.48-2.38l-3.16-2.46c-.88.59-2 .94-3.32.94-2.55 0-4.71-1.72-5.49-4.04H3.25v2.54A9.79 9.79 0 0 0 12 21.72Z" />
      <path fill="#FBBC05" d="M6.51 13.78A5.9 5.9 0 0 1 6.2 12c0-.62.11-1.22.31-1.78V7.68H3.25A9.8 9.8 0 0 0 2.22 12c0 1.56.37 3.03 1.03 4.32l3.26-2.54Z" />
      <path fill="#EA4335" d="M12 6.18c1.44 0 2.72.49 3.73 1.46l2.81-2.81A9.4 9.4 0 0 0 12 2.28a9.79 9.79 0 0 0-8.75 5.4l3.26 2.54C7.29 7.9 9.45 6.18 12 6.18Z" />
    </svg>
  );
}
