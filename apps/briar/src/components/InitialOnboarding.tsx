import { ArrowRight, BellRing, Check, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Typography } from "@/components/ui/typography";
import onboardingEveIssueUrl from "../assets/onboarding-eve-issue.png";
import { useI18n } from "../i18n";
import {
  defaultInboxNotificationPreferences,
  openInboxNotificationSystemSettings,
  readInboxNotificationPermissionStatus,
  recommendedInboxNotificationPreferences,
  requestInboxNotificationPermission,
  writeInboxNotificationPreferences,
} from "../lib/inbox-notifications";
import type { InboxNotificationPermissionStatus } from "../generated/tauri";
import { LoginScreen, type LoginMethod } from "./LoginScreen";

type Step = "welcome" | "login" | "notifications";

type InitialOnboardingProps = {
  authenticated: boolean;
  error: string | null;
  loading: boolean;
  loginCode: string | null;
  onCancelLogin: () => void;
  onComplete: () => void;
  onLogin: (method: LoginMethod) => void;
  openSystemSettings?: typeof openInboxNotificationSystemSettings;
  readPermissionStatus?: typeof readInboxNotificationPermissionStatus;
  requestPermission?: typeof requestInboxNotificationPermission;
};

export function InitialOnboarding({
  authenticated,
  error: loginError,
  loading: loginLoading,
  loginCode,
  onCancelLogin,
  onComplete,
  onLogin,
  openSystemSettings = openInboxNotificationSystemSettings,
  readPermissionStatus = readInboxNotificationPermissionStatus,
  requestPermission = requestInboxNotificationPermission,
}: InitialOnboardingProps) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>(
    authenticated ? "notifications" : "welcome",
  );
  const [permissionStatus, setPermissionStatus] =
    useState<InboxNotificationPermissionStatus | null>(null);
  const [checkingPermission, setCheckingPermission] = useState(false);
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [permissionError, setPermissionError] = useState(false);

  useEffect(() => {
    if (authenticated && step !== "notifications") {
      setStep("notifications");
    } else if (!authenticated && step === "notifications") {
      setStep("login");
    }
  }, [authenticated, step]);

  const syncPermissionStatus = useCallback(async () => {
    setCheckingPermission(true);
    try {
      const status = await readPermissionStatus();
      writeInboxNotificationPreferences(
        status === "authorized"
          ? recommendedInboxNotificationPreferences()
          : defaultInboxNotificationPreferences(),
      );
      setPermissionStatus(status);
      setPermissionError(false);
    } catch {
      writeInboxNotificationPreferences(
        defaultInboxNotificationPreferences(),
      );
      setPermissionStatus(null);
      setPermissionError(true);
    } finally {
      setCheckingPermission(false);
    }
  }, [readPermissionStatus]);

  useEffect(() => {
    if (step !== "notifications") return;
    void syncPermissionStatus();
    const refreshOnFocus = () => void syncPermissionStatus();
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [step, syncPermissionStatus]);

  const returnToWelcome = () => {
    onCancelLogin();
    setStep("welcome");
  };

  const requestNotifications = async () => {
    if (requestingPermission || checkingPermission) return;
    setRequestingPermission(true);
    setPermissionError(false);
    try {
      if (await requestPermission()) {
        writeInboxNotificationPreferences(
          recommendedInboxNotificationPreferences(),
        );
        setPermissionStatus("authorized");
      } else {
        await syncPermissionStatus();
      }
    } catch {
      writeInboxNotificationPreferences(
        defaultInboxNotificationPreferences(),
      );
      setPermissionError(true);
    } finally {
      setRequestingPermission(false);
    }
  };

  const openNotificationSettings = async () => {
    setPermissionError(false);
    try {
      await openSystemSettings();
    } catch {
      setPermissionError(true);
    }
  };

  const completeLater = () => {
    writeInboxNotificationPreferences(defaultInboxNotificationPreferences());
    onComplete();
  };

  const notificationContent = permissionStatus === "authorized"
    ? {
        badge: t("initialOnboarding.notificationsEnabledBadge"),
        description: t("initialOnboarding.notificationsEnabledDescription"),
        title: t("initialOnboarding.notificationsEnabledTitle"),
      }
    : permissionStatus === "denied"
    ? {
        badge: t("initialOnboarding.notificationsDeniedBadge"),
        description: t("initialOnboarding.notificationsDeniedDescription"),
        title: t("initialOnboarding.notificationsDeniedTitle"),
      }
    : permissionStatus === "unsupported"
    ? {
        badge: t("initialOnboarding.notificationsUnavailableBadge"),
        description: t("initialOnboarding.notificationsUnavailableDescription"),
        title: t("initialOnboarding.notificationsUnavailableTitle"),
      }
    : {
        badge: t("initialOnboarding.notificationsEyebrow"),
        description: t("initialOnboarding.notificationsDescription"),
        title: t("initialOnboarding.notificationsTitle"),
      };

  return (
    <div className="relative block size-full">
      <div
        className="absolute inset-x-0 top-0 z-20 h-[18px]"
        data-tauri-drag-region
      />
      <main
        aria-label={t("initialOnboarding.label")}
        className="scrollbar-subtle size-full overflow-auto bg-card text-foreground"
      >
        {step === "welcome" ? (
          <section className="grid min-h-full w-full grid-rows-[minmax(290px,58%)_minmax(0,1fr)] overflow-hidden bg-card max-[760px]:grid-rows-[220px_auto]">
            <div
              aria-hidden="true"
              className="min-h-0 overflow-hidden bg-muted max-[760px]:min-h-[220px]"
            >
              <img
                alt=""
                className="block size-full object-cover object-center"
                src={onboardingEveIssueUrl}
              />
            </div>
            <div className="flex min-h-0 flex-col items-start justify-center p-[24px_42px_22px] max-[760px]:p-[28px_30px_32px]">
              <Typography
                as="p"
                className="m-0 mb-[7px]"
                tone="primary"
                variant="micro"
              >
                {t("initialOnboarding.eyebrow")}
              </Typography>
              <Typography
                as="h1"
                className="mt-2 max-w-[540px] leading-[1.14] tracking-[-1.2px]"
                variant="title"
              >
                {t("initialOnboarding.welcomeTitle")}
              </Typography>
              <Typography
                className="mt-2.5 max-w-[720px] leading-[1.65]"
                tone="muted"
                variant="caption"
              >
                {t("initialOnboarding.welcomeDescription")}
              </Typography>
              <Button
                className="mt-4 min-w-40 self-end rounded-[14px] px-[19px] text-xs font-bold shadow-[0_10px_24px_var(--primary-shadow)] transition-[transform,background-color,box-shadow] duration-150 hover:-translate-y-px hover:bg-[var(--primary-hover)] hover:shadow-[0_12px_28px_var(--primary-shadow)] active:scale-[.97] max-[760px]:self-stretch"
                onClick={() => setStep("login")}
                type="button"
              >
                {t("initialOnboarding.start")}
                <ArrowRight size={17} />
              </Button>
            </div>
          </section>
        ) : step === "login" ? (
          <section className="relative size-full min-h-[580px] overflow-hidden bg-card">
            <div
              aria-label={t("initialOnboarding.progress")}
              aria-valuemax={3}
              aria-valuemin={1}
              aria-valuenow={2}
              className="absolute inset-x-7 top-7 z-[8] h-[5px] overflow-hidden rounded-full bg-secondary shadow-[inset_0_1px_2px_rgba(45,45,42,0.08)] max-[760px]:inset-x-[22px] max-[760px]:top-6"
              role="progressbar"
            >
              <span className="block h-full w-2/3 rounded-full bg-[linear-gradient(90deg,var(--primary)_0%,#73585d_55%,#d8b8bd_100%)]" />
            </div>
            <LoginScreen
              embedded
              error={loginError}
              loading={loginLoading}
              loginCode={loginCode}
              onCancel={onCancelLogin}
              onLogin={onLogin}
            />
            <Button
              className="absolute bottom-6 left-7 z-[9] h-[42px] rounded-xl bg-secondary px-4 text-xs font-semibold text-muted-foreground shadow-none transition-[transform,background-color] duration-150 hover:bg-secondary/80 active:scale-[.97]"
              onClick={returnToWelcome}
              type="button"
              variant="secondary"
            >
              {t("initialOnboarding.back")}
            </Button>
          </section>
        ) : (
          <section className="relative flex min-h-full w-full items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_8%,color-mix(in_srgb,var(--primary)_9%,transparent),transparent_42%),var(--card)] px-8 py-16 max-[640px]:px-5 max-[640px]:py-12">
            <div
              aria-label={t("initialOnboarding.progress")}
              aria-valuemax={3}
              aria-valuemin={1}
              aria-valuenow={3}
              className="absolute inset-x-7 top-7 z-[8] h-[5px] overflow-hidden rounded-full bg-secondary shadow-[inset_0_1px_2px_rgba(45,45,42,0.08)] max-[760px]:inset-x-[22px] max-[760px]:top-6"
              role="progressbar"
            >
              <span className="block size-full rounded-full bg-[linear-gradient(90deg,var(--primary)_0%,#73585d_55%,#d8b8bd_100%)]" />
            </div>
            <div className="w-full max-w-[560px] text-center">
              <div
                aria-hidden="true"
                className="mx-auto mb-7 grid size-[92px] place-items-center rounded-[30px] border border-primary/15 bg-primary/10 text-primary shadow-[0_22px_55px_color-mix(in_srgb,var(--primary)_16%,transparent)]"
              >
                {permissionStatus === "authorized" ? (
                  <Check strokeWidth={2.4} size={42} />
                ) : checkingPermission ? (
                  <Spinner size={38} />
                ) : (
                  <BellRing size={40} />
                )}
              </div>
              <Typography
                as="p"
                className="mb-3"
                tone="primary"
                variant="micro"
              >
                {notificationContent.badge}
              </Typography>
              <Typography
                as="h1"
                className="mx-auto max-w-[520px] leading-[1.14] tracking-[-1.2px]"
                variant="title"
              >
                {notificationContent.title}
              </Typography>
              <Typography
                aria-live="polite"
                className="mx-auto mt-3 max-w-[500px] leading-[1.65]"
                tone="muted"
                variant="caption"
              >
                {checkingPermission && permissionStatus === null
                  ? t("initialOnboarding.notificationsChecking")
                  : notificationContent.description}
              </Typography>

              <div className="mx-auto mt-7 grid max-w-[430px] gap-3">
                {permissionStatus === "authorized" ? (
                  <Button
                    className="h-12 rounded-[14px] text-xs font-bold shadow-[0_10px_24px_var(--primary-shadow)]"
                    onClick={onComplete}
                    type="button"
                  >
                    {t("initialOnboarding.notificationsContinue")}
                    <ArrowRight size={17} />
                  </Button>
                ) : permissionStatus === "denied" ? (
                  <Button
                    className="h-12 rounded-[14px] text-xs font-bold"
                    onClick={() => void openNotificationSettings()}
                    type="button"
                  >
                    {t("initialOnboarding.notificationsOpenSettings")}
                    <ExternalLink size={16} />
                  </Button>
                ) : permissionStatus === "unsupported" ? null : (
                  <Button
                    aria-label={t("initialOnboarding.notificationsEnableLabel")}
                    className="h-12 rounded-[14px] text-xs font-bold shadow-[0_10px_24px_var(--primary-shadow)]"
                    disabled={checkingPermission || requestingPermission}
                    onClick={() => void requestNotifications()}
                    type="button"
                  >
                    {requestingPermission ? (
                      <Spinner size={17} />
                    ) : (
                      <BellRing size={17} />
                    )}
                    {requestingPermission
                      ? t("initialOnboarding.notificationsRequesting")
                      : t("initialOnboarding.notificationsEnable")}
                  </Button>
                )}

                {permissionError ? (
                  <div
                    className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-left text-xs leading-relaxed text-destructive"
                    role="alert"
                  >
                    {t("initialOnboarding.notificationsError")}
                  </div>
                ) : null}

                {permissionError ? (
                  <Button
                    className="h-11 rounded-xl text-xs font-semibold"
                    disabled={checkingPermission}
                    onClick={() => void syncPermissionStatus()}
                    type="button"
                    variant="outline"
                  >
                    {t("initialOnboarding.notificationsRetry")}
                  </Button>
                ) : null}

                {permissionStatus !== "authorized" ? (
                  <Button
                    className="h-11 rounded-xl text-xs font-semibold text-muted-foreground"
                    disabled={checkingPermission || requestingPermission}
                    onClick={completeLater}
                    type="button"
                    variant="ghost"
                  >
                    {t("initialOnboarding.notificationsLater")}
                  </Button>
                ) : null}
              </div>

              {permissionStatus !== "authorized" ? (
                <p className="mt-5 text-[11px] leading-relaxed text-muted-foreground">
                  {t("initialOnboarding.notificationsSettingsHint")}
                </p>
              ) : null}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
