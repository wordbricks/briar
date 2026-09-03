import {
  Building2,
  Check,
  Cpu,
  FolderKanban,
  Github,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/loading-state";
import { Typography } from "@/components/ui/typography";
import { useI18n } from "../i18n";
import { ApiError, loadOrganizationInvitation } from "../lib/api";
import type { OrganizationInvitationPreview, SessionUser } from "../types";
import {
  LoginActions,
  type LoginEmailHandlers,
  type LoginMethod,
} from "./LoginScreen";
import { Logo } from "./Logo";

type Translate = ReturnType<typeof useI18n>["t"];

function invitationErrorMessage(error: unknown, t: Translate) {
  if (error instanceof ApiError) {
    if (error.code === "INVITATION_EMAIL_MISMATCH") {
      return t("invitation.emailMismatch");
    }
    if (error.code === "INVITATION_EXPIRED") {
      return t("invitation.expired");
    }
    if (error.code === "INVITATION_REVOKED") {
      return t("invitation.revoked");
    }
    if (error.status === 404) return t("invitation.invalid");
  }
  return error instanceof Error ? error.message : String(error);
}

export function InvitationOnboarding({
  accepting,
  error: loginError,
  loading: loginLoading,
  loadInvitation = loadOrganizationInvitation,
  loginCode,
  onAccept,
  onCancelLogin,
  onLeave,
  onLogin,
  onSendEmailCode,
  onSwitchAccount,
  onVerifyEmailCode,
  token,
  user,
  webMode = false,
}: LoginEmailHandlers & {
  accepting: boolean;
  error: string | null;
  loading: boolean;
  loadInvitation?: typeof loadOrganizationInvitation;
  loginCode: string | null;
  onAccept: () => Promise<void>;
  onCancelLogin: () => void;
  onLeave: () => void;
  onLogin: (method: LoginMethod) => void;
  onSwitchAccount: () => Promise<void>;
  token: string;
  user: SessionUser | null;
  webMode?: boolean;
}) {
  const { t } = useI18n();
  const [invitation, setInvitation] =
    useState<OrganizationInvitationPreview | null>(null);
  const [loadingInvitation, setLoadingInvitation] = useState(true);
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingInvitation(true);
    setInvitationError(null);
    void loadInvitation(token)
      .then((result) => {
        if (!cancelled) setInvitation(result.invitation);
      })
      .catch((caught) => {
        if (!cancelled) {
          setInvitationError(invitationErrorMessage(caught, t));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingInvitation(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadInvitation, t, token]);

  const unavailableMessage = invitation
    ? invitation.status === "expired"
      ? t("invitation.expired")
      : invitation.status === "revoked"
        ? t("invitation.revoked")
        : invitation.status === "accepted"
          ? t("invitation.used")
          : null
    : null;
  const error = acceptError ?? invitationError ?? loginError;

  return (
    <main
      aria-label={t("invitation.label")}
      className="scrollbar-subtle relative grid h-full min-h-0 w-full place-items-center overflow-auto bg-[radial-gradient(circle_at_50%_30%,rgba(108,82,199,0.1),transparent_34%),var(--background)]"
      data-tauri-drag-region
    >
      <div className="pointer-events-none absolute top-[8%] size-80 rounded-full bg-primary/10 blur-[90px]" />
      <Card className="relative block w-full max-w-[520px] rounded-3xl p-9 shadow-[0_26px_80px_rgba(38,42,32,0.1)]">
        <Logo />
        {loadingInvitation ? (
          <div className="grid min-h-56 place-items-center" role="status">
            <LoadingState />
          </div>
        ) : invitation ? (
          <>
            <div className="mt-[34px] mb-[26px]">
              <Typography
                as="p"
                className="m-0 mb-[7px]"
                tone="primary"
                variant="micro"
              >
                {t("invitation.eyebrow")}
              </Typography>
              <Typography as="h1" variant="title">
                {t("invitation.title", {
                  organization: invitation.organizationName,
                })}
              </Typography>
              <Typography className="mt-3" tone="muted" variant="bodySm">
                {t("invitation.description", {
                  project: invitation.initialProjectName,
                })}
              </Typography>
            </div>

            <div className="mt-5 grid gap-2 rounded-2xl border border-border bg-secondary/50 p-4">
              <div className="flex items-center gap-3">
                <Building2 className="text-primary" size={18} />
                <Typography as="strong" variant="bodySm">
                  {invitation.organizationName}
                </Typography>
              </div>
              <div className="flex items-center gap-3">
                <FolderKanban className="text-primary" size={18} />
                <Typography as="span" variant="bodySm">
                  {invitation.initialProjectName}
                </Typography>
              </div>
              <div className="flex items-center gap-3">
                <ShieldCheck className="text-primary" size={18} />
                <Typography as="span" variant="bodySm">
                  {t(`organization.role.${invitation.role}` as
                    | "organization.role.co-owner"
                    | "organization.role.developer"
                    | "organization.role.editor"
                    | "organization.role.viewer")}
                </Typography>
              </div>
              {invitation.role === "editor" ||
              invitation.role === "viewer" ? (
                <div className="flex items-center gap-3">
                  <Check className="text-success" size={18} />
                  <Typography as="span" tone="muted" variant="caption">
                    {t("invitation.noTools")}
                  </Typography>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <Github className="text-primary" size={18} />
                    <Typography as="span" tone="muted" variant="caption">
                      {t("invitation.githubRequired")}
                    </Typography>
                  </div>
                  <div className="flex items-center gap-3">
                    <Cpu className="text-primary" size={18} />
                    <Typography as="span" tone="muted" variant="caption">
                      {t("invitation.agentRequired")}
                    </Typography>
                  </div>
                </>
              )}
            </div>

            <Typography
              className="mt-4 text-center"
              tone="muted"
              variant="caption"
            >
              {t("invitation.email", { email: invitation.emailHint })}
            </Typography>

            {unavailableMessage ? (
              <div className="mt-4 grid gap-3 text-center">
                <Typography
                  className="text-destructive"
                  role="alert"
                  variant="bodySm"
                >
                  {unavailableMessage}
                </Typography>
                <Button onClick={onLeave} type="button" variant="outline">
                  {t("invitation.goToBriar")}
                </Button>
              </div>
            ) : user ? (
              <div className="mt-5 grid gap-3">
                <Typography
                  className="text-center"
                  tone="muted"
                  variant="caption"
                >
                  {t("invitation.signedInAs", { email: user.email })}
                </Typography>
                <Typography
                  className="text-center"
                  tone="muted"
                  variant="caption"
                >
                  {t("invitation.validationNotice")}
                </Typography>
                <Button
                  disabled={accepting}
                  onClick={() => {
                    setAcceptError(null);
                    void onAccept().catch((caught) =>
                      setAcceptError(invitationErrorMessage(caught, t)),
                    );
                  }}
                  type="button"
                >
                  {accepting ? (
                    <Spinner size={17} />
                  ) : (
                    <Check size={17} />
                  )}
                  {t(accepting ? "invitation.accepting" : "invitation.accept")}
                </Button>
                <Button
                  disabled={accepting}
                  onClick={() => void onSwitchAccount()}
                  type="button"
                  variant="ghost"
                >
                  <LogOut size={16} />
                  {t("invitation.switchAccount")}
                </Button>
              </div>
            ) : loginCode ? (
              <div className="mt-5 flex flex-col items-center rounded-[13px] border border-primary/20 bg-accent p-4 text-center">
                <Typography as="span" tone="muted" variant="caption">
                  {t("login.approveCode")}
                </Typography>
                <Typography
                  as="strong"
                  className="mt-[11px] mb-2 block max-w-full font-mono text-3xl font-semibold tracking-[0.25em] text-primary"
                  variant="heading"
                >
                  {loginCode}
                </Typography>
                <Button
                  onClick={onCancelLogin}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {t("common.cancel")}
                </Button>
              </div>
            ) : (
              <div className="mt-5">
                <LoginActions
                  emailButtonLabel={t("invitation.signIn")}
                  loading={loginLoading}
                  onLogin={onLogin}
                  onReset={onCancelLogin}
                  onSendEmailCode={onSendEmailCode}
                  onVerifyEmailCode={onVerifyEmailCode}
                  webMode={webMode}
                />
              </div>
            )}
          </>
        ) : (
          <div className="mt-5 grid gap-4 text-center">
            <Typography
              className="text-destructive"
              role="alert"
              variant="bodySm"
            >
              {error ?? t("invitation.invalid")}
            </Typography>
            <Button onClick={onLeave} type="button" variant="outline">
              {t("invitation.goToBriar")}
            </Button>
          </div>
        )}
        {error && invitation ? (
          <Typography
            className="mt-3 rounded-[10px] border border-[var(--status-destructive-border)] bg-[var(--status-destructive-surface)] px-3 py-2.5 text-[color:var(--status-destructive-foreground)]"
            role="alert"
            variant="caption"
          >
            {error}
          </Typography>
        ) : null}
      </Card>
    </main>
  );
}
