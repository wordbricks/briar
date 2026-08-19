import {
  ArrowUpRight,
  Building2,
  Check,
  FolderKanban,
  LoaderCircle,
  LogOut,
  Mail,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { Typography } from "@/components/ui/typography";
import { useI18n } from "../i18n";
import { isApiErrorStatus, loadOrganizationInvitation } from "../lib/api";
import type { OrganizationInvitationPreview, SessionUser } from "../types";
import { GoogleIcon, type LoginMethod } from "./LoginScreen";
import { Logo } from "./Logo";

export function InvitationOnboarding({
  accepting,
  error: loginError,
  loading: loginLoading,
  loginCode,
  onAccept,
  onCancelLogin,
  onLeave,
  onLogin,
  onSwitchAccount,
  token,
  user,
}: {
  accepting: boolean;
  error: string | null;
  loading: boolean;
  loginCode: string | null;
  onAccept: () => Promise<void>;
  onCancelLogin: () => void;
  onLeave: () => void;
  onLogin: (method: LoginMethod) => void;
  onSwitchAccount: () => Promise<void>;
  token: string;
  user: SessionUser | null;
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
    void loadOrganizationInvitation(token)
      .then((result) => {
        if (!cancelled) setInvitation(result.invitation);
      })
      .catch(() => {
        if (!cancelled) setInvitationError(t("invitation.invalid"));
      })
      .finally(() => {
        if (!cancelled) setLoadingInvitation(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t, token]);

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
    <main aria-label={t("invitation.label")} className="login-shell">
      <div className="login-glow" />
      <section className="login-card w-full max-w-[520px] rounded-3xl border border-border bg-card shadow-lg">
        <Logo />
        {loadingInvitation ? (
          <div className="grid min-h-56 place-items-center" role="status">
            <LoadingState />
          </div>
        ) : invitation ? (
          <>
            <div className="login-copy">
              <Typography
                as="p"
                className="eyebrow"
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
                <Check className="text-success" size={18} />
                <Typography as="span" tone="muted" variant="caption">
                  {t("invitation.noTools")}
                </Typography>
              </div>
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
                <Button
                  disabled={accepting}
                  onClick={() => {
                    setAcceptError(null);
                    void onAccept().catch((caught) =>
                      setAcceptError(
                        isApiErrorStatus(caught, 409)
                          ? t("invitation.emailMismatch")
                          : caught instanceof Error
                            ? caught.message
                            : String(caught),
                      ),
                    );
                  }}
                  type="button"
                >
                  {accepting ? (
                    <LoaderCircle className="spin" size={17} />
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
              <div className="device-code-card mt-5 rounded-xl border border-primary/20 bg-accent p-4 text-center">
                <Typography as="span" tone="muted" variant="caption">
                  {t("login.approveCode")}
                </Typography>
                <Typography
                  as="strong"
                  className="mt-2.5 mb-2 block tracking-[0.25em] text-primary"
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
              <div className="mt-5 grid gap-3">
                <Button
                  className="email-button h-11 w-full justify-between rounded-xl"
                  disabled={loginLoading}
                  onClick={() => onLogin("email")}
                  type="button"
                >
                  {loginLoading ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <Mail size={18} />
                  )}
                  <span className="flex-1 text-center">
                    {t("invitation.signIn")}
                  </span>
                  <ArrowUpRight size={16} />
                </Button>
                <div className="login-provider-divider" role="separator">
                  <span>{t("login.or")}</span>
                </div>
                <Button
                  className="google-button h-11 w-full justify-between rounded-xl"
                  disabled={loginLoading}
                  onClick={() => onLogin("google")}
                  type="button"
                  variant="outline"
                >
                  <GoogleIcon />
                  <span className="flex-1 text-center">
                    {t("invitation.signInGoogle")}
                  </span>
                  <ArrowUpRight size={16} />
                </Button>
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
            className="login-error mt-3 text-destructive"
            role="alert"
            variant="caption"
          >
            {error}
          </Typography>
        ) : null}
      </section>
    </main>
  );
}
