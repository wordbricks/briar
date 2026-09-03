import { ArrowUpRight, Mail, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Spinner } from "./ui/spinner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n";
import { Logo } from "./Logo";

export type LoginMethod = "email" | "google";

export type LoginEmailHandlers = {
  onSendEmailCode?: (email: string) => Promise<void>;
  onVerifyEmailCode?: (email: string, code: string) => Promise<void>;
};

export function LoginActions({
  emailButtonLabel,
  loading,
  onLogin,
  onReset,
  onSendEmailCode,
  onVerifyEmailCode,
  webMode = false,
}: LoginEmailHandlers & {
  emailButtonLabel?: string;
  loading: boolean;
  onLogin: (method: LoginMethod) => void;
  onReset?: () => void;
  webMode?: boolean;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const directEmail = webMode && onSendEmailCode && onVerifyEmailCode;

  const sendCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!directEmail) return;
    await onSendEmailCode(email.trim().toLowerCase());
    setCode("");
    setCodeSent(true);
  };

  const verifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!directEmail) return;
    await onVerifyEmailCode(email.trim().toLowerCase(), code);
  };

  if (directEmail && codeSent) {
    return (
      <form
        className="grid gap-3"
        onSubmit={(event) => void verifyCode(event).catch(() => undefined)}
      >
        <Typography className="text-center" tone="muted" variant="caption">
          {t("login.codeSent")}
        </Typography>
        <label className="sr-only" htmlFor="login-email-code">
          {t("login.signInCode")}
        </label>
        <input
          autoComplete="one-time-code"
          autoFocus
          className="h-11 w-full rounded-[13px] border border-border bg-card px-3.5 text-center font-mono text-lg font-semibold tracking-[0.22em] text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
          disabled={loading}
          id="login-email-code"
          inputMode="numeric"
          maxLength={6}
          onChange={(event) =>
            setCode(event.target.value.replace(/\D/gu, "").slice(0, 6))}
          pattern="[0-9]{6}"
          placeholder="123456"
          required
          type="text"
          value={code}
        />
        <Button disabled={loading || code.length !== 6} type="submit">
          {loading ? <Spinner size={18} /> : null}
          {t("login.verifyCode")}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            disabled={loading}
            onClick={() =>
              void onSendEmailCode(email).catch(() => undefined)}
            type="button"
            variant="secondary"
          >
            {t("login.resend")}
          </Button>
          <Button
            disabled={loading}
            onClick={() => {
              setCodeSent(false);
              setCode("");
              onReset?.();
            }}
            type="button"
            variant="ghost"
          >
            {t("login.editEmail")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="grid gap-3">
      {directEmail ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => void sendCode(event).catch(() => undefined)}
        >
          <label className="sr-only" htmlFor="login-email">
            {t("login.email")}
          </label>
          <input
            autoComplete="email"
            className="h-11 w-full rounded-[13px] border border-border bg-card px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
            disabled={loading}
            id="login-email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            required
            type="email"
            value={email}
          />
          <Button
            className="grid h-11 w-full grid-cols-[20px_minmax(0,1fr)_16px] place-items-center rounded-[13px] px-3.5 text-xs font-semibold shadow-[0_5px_16px_rgba(38,42,32,0.05)] [&>svg:first-child]:size-[18px] [&>svg:last-child]:size-4"
            disabled={loading}
            type="submit"
          >
            {loading ? <Spinner size={18} /> : <Mail size={18} />}
            <span className="col-start-2 text-center">
              {emailButtonLabel ?? t("login.continueEmail")}
            </span>
            <ArrowUpRight size={16} />
          </Button>
        </form>
      ) : (
        <Button
          className="grid h-11 w-full grid-cols-[20px_minmax(0,1fr)_16px] place-items-center rounded-[13px] px-3.5 text-xs font-semibold shadow-[0_5px_16px_rgba(38,42,32,0.05)] [&>svg:first-child]:size-[18px] [&>svg:last-child]:size-4"
          disabled={loading}
          onClick={() => onLogin("email")}
          type="button"
        >
          {loading ? <Spinner size={18} /> : <Mail size={18} />}
          <span className="col-start-2 text-center">
            {emailButtonLabel ?? t("login.continueEmail")}
          </span>
          <ArrowUpRight size={16} />
        </Button>
      )}
      <div
        className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5 text-[var(--text-2xs)] text-muted-foreground before:h-px before:bg-border before:content-[''] after:h-px after:bg-border after:content-['']"
        role="separator"
      >
        <span>{t("login.or")}</span>
      </div>
      <Button
        className="grid h-[46px] w-full grid-cols-[20px_minmax(0,1fr)_16px] place-items-center rounded-[13px] border border-border bg-card px-3.5 text-xs font-semibold text-foreground shadow-[0_5px_16px_rgba(38,42,32,0.05)] hover:bg-secondary [&>svg:first-child]:size-[18px] [&>svg:last-child]:size-4"
        disabled={loading}
        onClick={() => onLogin("google")}
        type="button"
        variant="outline"
      >
        <GoogleIcon />
        <span className="col-start-2 text-center">{t("login.continueGoogle")}</span>
        <ArrowUpRight size={16} />
      </Button>
    </div>
  );
}

export function LoginScreen({
  companionMode = false,
  embedded = false,
  error,
  loading,
  loginCode,
  onCancel,
  onLogin,
  onSendEmailCode,
  onVerifyEmailCode,
  webMode = false,
}: LoginEmailHandlers & {
  companionMode?: boolean;
  embedded?: boolean;
  error: string | null;
  loading: boolean;
  loginCode: string | null;
  onCancel: () => void;
  onLogin: (method: LoginMethod) => void;
  webMode?: boolean;
}) {
  const { t } = useI18n();
  const Shell = embedded ? "div" : "main";
  return (
    <Shell
      className={cn(
        "scrollbar-subtle relative grid h-full min-h-0 w-full place-items-center overflow-auto bg-[radial-gradient(circle_at_50%_30%,rgba(108,82,199,0.1),transparent_34%),var(--background)]",
        companionMode &&
          "min-h-dvh max-w-full min-w-0 place-items-stretch overflow-x-hidden overflow-y-auto overscroll-x-none bg-card",
        embedded &&
          "min-h-full overflow-hidden bg-[radial-gradient(circle_at_50%_35%,rgba(108,82,199,0.12),transparent_38%),var(--background)] p-[58px_28px_28px]",
      )}
      data-tauri-drag-region
    >
      <div className="pointer-events-none absolute top-[8%] size-80 rounded-full bg-primary/10 blur-[90px]" />
      <Card
        className={cn(
          "relative block w-[410px] rounded-3xl p-9 shadow-[0_26px_80px_rgba(38,42,32,0.1)]",
          companionMode &&
            "flex min-h-dvh w-full max-w-none min-w-0 flex-col justify-center rounded-none border-0 p-[max(32px,env(safe-area-inset-top))_max(24px,env(safe-area-inset-right))_max(28px,env(safe-area-inset-bottom))_max(24px,env(safe-area-inset-left))] shadow-none",
          embedded && "w-[min(410px,calc(100%_-_56px))]",
        )}
      >
        {loginCode ? (
          <Button
            aria-label={t("login.close")}
            className="absolute top-5 right-5 size-9 rounded-[10px] border border-transparent text-muted-foreground shadow-none transition-colors hover:border-border hover:bg-background hover:text-foreground"
            onClick={onCancel}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X size={18} />
          </Button>
        ) : null}
        <Logo />
        <div
          className={cn(
            "mt-[34px] mb-[26px]",
            companionMode && "mx-auto w-full max-w-[480px]",
          )}
        >
          <Typography
            as="p"
            className="m-0 mb-[7px]"
            tone="primary"
            variant="micro"
          >
            {t(
              companionMode
                ? "companion.badge"
                : webMode
                  ? "web.loginEyebrow"
                  : "login.eyebrow",
            )}
          </Typography>
          <Typography as="h1" variant="title">
            {t(
              companionMode
                ? "companion.loginTitle"
                : webMode
                  ? "web.loginTitle"
                  : "login.title",
            )
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
                : webMode
                  ? "web.loginDescription"
                  : "login.description",
            )}
          </Typography>
        </div>
        {loginCode ? (
          <div
            className={cn(
              "flex flex-col items-center rounded-[13px] border border-primary/20 bg-accent p-4 text-center",
              companionMode && "mx-auto w-full max-w-[480px] min-w-0",
            )}
          >
            <Typography as="span" tone="muted" variant="caption">
              {t(companionMode ? "companion.loginApprove" : "login.approveCode")}
            </Typography>
            <Typography
              as="strong"
              className="mt-[11px] mb-2 block max-w-full font-mono text-3xl font-semibold tracking-[0.25em] text-primary"
              variant="heading"
            >
              {loginCode}
            </Typography>
            <Typography as="small" tone="muted" variant="micro">
              {t(companionMode ? "companion.loginWaiting" : "login.waiting")}
            </Typography>
          </div>
        ) : (
          <div
            className={cn(
              companionMode && "mx-auto w-full max-w-[480px] min-w-0",
            )}
          >
            <LoginActions
              loading={loading}
              onLogin={onLogin}
              onReset={onCancel}
              onSendEmailCode={onSendEmailCode}
              onVerifyEmailCode={onVerifyEmailCode}
              webMode={webMode}
            />
          </div>
        )}
        {error ? (
          <Typography
            className={cn(
              "mt-3 rounded-[10px] border border-[var(--status-destructive-border)] bg-[var(--status-destructive-surface)] px-3 py-2.5 text-[color:var(--status-destructive-foreground)]",
              companionMode && "mx-auto w-full max-w-[480px]",
            )}
            role="alert"
            variant="caption"
          >
            {error}
          </Typography>
        ) : null}
        {companionMode ? (
          <Typography
            as="p"
            className="mx-auto mt-3.5 w-full max-w-[480px] text-center"
            tone="muted"
            variant="micro"
          >
            {t("companion.loginSecure")}
          </Typography>
        ) : null}
      </Card>
    </Shell>
  );
}

export function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M21.35 12.18c0-.64-.06-1.25-.16-1.84H12v3.48h5.25a4.5 4.5 0 0 1-1.95 2.95v2.26h3.16c1.85-1.7 2.89-4.22 2.89-6.85Z" />
      <path fill="#34A853" d="M12 21.72c2.64 0 4.86-.88 6.48-2.38l-3.16-2.46c-.88.59-2 .94-3.32.94-2.55 0-4.71-1.72-5.49-4.04H3.25v2.54A9.79 9.79 0 0 0 12 21.72Z" />
      <path fill="#FBBC05" d="M6.51 13.78A5.9 5.9 0 0 1 6.2 12c0-.62.11-1.22.31-1.78V7.68H3.25A9.8 9.8 0 0 0 2.22 12c0 1.56.37 3.03 1.03 4.32l3.26-2.54Z" />
      <path fill="#EA4335" d="M12 6.18c1.44 0 2.72.49 3.73 1.46l2.81-2.81A9.4 9.4 0 0 0 12 2.28a9.79 9.79 0 0 0-8.75 5.4l3.26 2.54C7.29 7.9 9.45 6.18 12 6.18Z" />
    </svg>
  );
}
