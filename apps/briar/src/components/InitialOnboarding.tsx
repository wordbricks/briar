import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/typography";
import onboardingEveIssueUrl from "../assets/onboarding-eve-issue.png";
import { useI18n } from "../i18n";
import { LoginScreen, type LoginMethod } from "./LoginScreen";

type Step = "welcome" | "login";

export function InitialOnboarding({
  error: loginError,
  loading: loginLoading,
  loginCode,
  onCancelLogin,
  onLogin,
}: {
  error: string | null;
  loading: boolean;
  loginCode: string | null;
  onCancelLogin: () => void;
  onLogin: (method: LoginMethod) => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("welcome");
  const returnToWelcome = () => {
    onCancelLogin();
    setStep("welcome");
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
        ) : (
          <section className="relative size-full min-h-[580px] overflow-hidden bg-card">
            <div
              aria-label={t("initialOnboarding.progress")}
              aria-valuemax={2}
              aria-valuemin={1}
              aria-valuenow={2}
              className="absolute inset-x-7 top-7 z-[8] h-[5px] overflow-hidden rounded-full bg-secondary shadow-[inset_0_1px_2px_rgba(45,45,42,0.08)] max-[760px]:inset-x-[22px] max-[760px]:top-6"
              role="progressbar"
            >
              <span className="block size-full rounded-full bg-[linear-gradient(90deg,var(--primary)_0%,#73585d_55%,#d8b8bd_100%)]" />
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
        )}
      </main>
    </div>
  );
}
