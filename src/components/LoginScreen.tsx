import { ArrowUpRight, LoaderCircle, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n";
import { Logo } from "./Logo";

export function LoginScreen({
  companionMode = false,
  embedded = false,
  error,
  loading,
  loginCode,
  onCancel,
  onLogin,
}: {
  companionMode?: boolean;
  embedded?: boolean;
  error: string | null;
  loading: boolean;
  loginCode: string | null;
  onCancel: () => void;
  onLogin: () => void;
}) {
  const { t } = useI18n();
  const Shell = embedded ? "div" : "main";
  return (
    <Shell
      className={cn(
        "login-shell",
        companionMode && "companion-login-shell",
        embedded && "embedded-login-shell",
      )}
    >
      <div className="login-glow" />
      <section className="login-card rounded-3xl border border-border bg-card shadow-lg">
        {loginCode ? (
          <Button
            aria-label={t("login.close")}
            className="login-close-button absolute top-5 right-5 size-9"
            onClick={onCancel}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X size={18} />
          </Button>
        ) : null}
        <Logo />
        <div className="login-copy">
          <Typography
            as="p"
            className="eyebrow"
            tone="primary"
            variant="micro"
          >
            {companionMode ? t("companion.badge") : t("login.eyebrow")}
          </Typography>
          <Typography as="h1" variant="title">
            {t(companionMode ? "companion.loginTitle" : "login.title")
              .split("\n")
              .map((line, index) => (
                <span key={line}>
                  {index > 0 ? <br /> : null}
                  {line}
                </span>
              ))}
          </Typography>
          <Typography className="mt-3" tone="muted" variant="bodySm">
            {t(
              companionMode
                ? "companion.loginDescription"
                : "login.description",
            )}
          </Typography>
        </div>
        {loginCode ? (
          <div className="device-code-card rounded-xl border border-primary/20 bg-accent p-4 text-center">
            <Typography as="span" tone="muted" variant="caption">
              {t(companionMode ? "companion.loginApprove" : "login.approveCode")}
            </Typography>
            <Typography
              as="strong"
              className="mt-2.5 mb-2 block tracking-[0.25em] text-primary"
              variant="heading"
            >
              {loginCode}
            </Typography>
            <Typography as="small" tone="muted" variant="micro">
              {t(companionMode ? "companion.loginWaiting" : "login.waiting")}
            </Typography>
          </div>
        ) : (
          <Button
            className="google-button h-11 w-full justify-between rounded-xl border border-border bg-card px-3.5 text-sm font-semibold text-foreground shadow-xs hover:bg-secondary"
            disabled={loading}
            onClick={onLogin}
            type="button"
            variant="outline"
          >
            {loading ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <GoogleIcon />
            )}
            <span className="flex-1 text-center">{t("login.continueGoogle")}</span>
            <ArrowUpRight size={16} />
          </Button>
        )}
        {error ? (
          <Typography className="login-error mt-3 text-destructive" role="alert" variant="caption">
            {error}
          </Typography>
        ) : null}
        {companionMode ? (
          <Typography
            as="p"
            className="login-footnote mt-3.5 text-center"
            tone="muted"
            variant="micro"
          >
            {t("companion.loginSecure")}
          </Typography>
        ) : null}
      </section>
    </Shell>
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
