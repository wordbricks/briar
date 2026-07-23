import { ArrowUpRight, LoaderCircle, X } from "lucide-react";
import { Logo } from "./Logo";
import { useI18n } from "../i18n";

export function LoginScreen({
  companionMode = false,
  error,
  loading,
  loginCode,
  onCancel,
  onLogin,
}: {
  companionMode?: boolean;
  error: string | null;
  loading: boolean;
  loginCode: string | null;
  onCancel: () => void;
  onLogin: () => void;
}) {
  const { t } = useI18n();
  return (
    <main className="login-shell">
      <div className="login-glow" />
      <section className="login-card">
        {loginCode && (
          <button
            aria-label={t("login.close")}
            className="login-close-button"
            onClick={onCancel}
            type="button"
          >
            <X size={18} />
          </button>
        )}
        <Logo />
        <div className="login-copy">
          <p className="eyebrow">
            {companionMode ? t("companion.badge") : t("login.eyebrow")}
          </p>
          <h1>{t(companionMode ? "companion.loginTitle" : "login.title").split("\n").map((line, index) => <span key={line}>{index > 0 ? <br /> : null}{line}</span>)}</h1>
          <p>{t(companionMode ? "companion.loginDescription" : "login.description")}</p>
        </div>
        {loginCode ? (
          <div className="device-code-card">
            <span>
              {t(companionMode ? "companion.loginApprove" : "login.approveCode")}
            </span>
            <strong>{loginCode}</strong>
            <small>
              {t(companionMode ? "companion.loginWaiting" : "login.waiting")}
            </small>
          </div>
        ) : (
          <button className="google-button" onClick={onLogin} disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={18} /> : <GoogleIcon />}
            {t("login.continueGoogle")}
            <ArrowUpRight size={16} />
          </button>
        )}
        {error && <p className="login-error">{error}</p>}
        <p className="login-footnote">
          {t(companionMode ? "companion.loginSecure" : "login.secure")}
        </p>
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
