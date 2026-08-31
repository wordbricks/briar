import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Copy,
  Link2,
  LogOut,
  Mail,
  Users,
} from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChoiceCard } from "@/components/ui/choice-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Typography } from "@/components/ui/typography";
import { useI18n } from "../i18n";
import { parseOrganizationInvitationToken } from "../lib/organization-invitation";
import type { SessionUser } from "../types";
import { Logo } from "./Logo";
import { OrganizationCreate } from "./OrganizationCreate";

type SetupPhase = "choice" | "create" | "join";

export function FirstOrganizationSetup({
  onCheckHandle,
  onCreate,
  onJoin,
  onLogout,
  user,
}: {
  onCheckHandle: (handle: string) => Promise<boolean>;
  onCreate: (input: { name: string; handle: string }) => Promise<void>;
  onJoin: (token: string) => void;
  onLogout: () => void;
  user: SessionUser;
}) {
  const { t } = useI18n();
  const invitationId = useId();
  const [phase, setPhase] = useState<SetupPhase>("choice");
  const [invitationValue, setInvitationValue] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [emailCopied, setEmailCopied] = useState(false);

  const submitInvitation = (event: FormEvent) => {
    event.preventDefault();
    const token = parseOrganizationInvitationToken(invitationValue);
    if (!token) {
      setJoinError(t("organization.start.invalidInvitation"));
      return;
    }
    setJoinError(null);
    onJoin(token);
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(user.email);
      setEmailCopied(true);
    } catch {
      setJoinError(t("organization.start.copyFailed"));
    }
  };

  return (
    <div className="scrollbar-subtle relative grid h-full min-h-0 w-full place-items-start justify-items-center overflow-y-auto overscroll-y-contain bg-background [scrollbar-gutter:stable]">
      <header
        className="fixed inset-x-0 top-0 z-[2] flex h-[58px] items-center justify-between border-b border-border bg-card/80 pl-[var(--traffic-light-safe-inset)] pr-[22px] text-xl font-bold backdrop-blur-[18px]"
        data-tauri-drag-region
      >
        <Logo />
        <div className="flex items-center gap-1">
          <Button
            className="h-auto min-h-0 rounded-lg px-[9px] py-[7px] text-[var(--text-2xs)] font-medium text-muted-foreground shadow-none hover:bg-secondary hover:text-foreground [&_svg]:size-3.5"
            onClick={onLogout}
            type="button"
            variant="ghost"
          >
            <LogOut size={14} /> {user.email}
          </Button>
        </div>
      </header>
      <main className="flex w-full justify-center">
        <Card className="mt-[92px] mb-[34px] w-[min(720px,calc(100vw-48px))] max-w-full rounded-3xl p-9 shadow-[0_26px_80px_rgba(38,42,32,0.1)] max-[760px]:p-[26px]">
          {phase === "choice" ? (
            <section aria-labelledby="organization-start-title">
              <Typography as="span" tone="primary" variant="micro">
                {t("organization.start.eyebrow")}
              </Typography>
              <Typography
                as="h1"
                className="mt-1"
                id="organization-start-title"
                variant="title"
              >
                {t("organization.start.title")}
              </Typography>
              <Typography className="mt-2" tone="muted" variant="bodySm">
                {t("organization.start.description")}
              </Typography>
              <div className="mt-7 grid grid-cols-2 gap-3 max-[680px]:grid-cols-1">
                <ChoiceCard
                  className="min-h-[210px] max-[680px]:min-h-[160px]"
                  description={t("organization.start.createDescription")}
                  icon={<Building2 />}
                  onClick={() => setPhase("create")}
                  title={t("organization.start.createTitle")}
                  trailing={<ArrowRight />}
                />
                <ChoiceCard
                  className="min-h-[210px] max-[680px]:min-h-[160px]"
                  description={t("organization.start.joinDescription")}
                  icon={<Users />}
                  onClick={() => setPhase("join")}
                  title={t("organization.start.joinTitle")}
                  trailing={<ArrowRight />}
                />
              </div>
            </section>
          ) : phase === "create" ? (
            <OrganizationCreate
              embedded
              onBack={() => setPhase("choice")}
              onCheckHandle={onCheckHandle}
              onCreate={onCreate}
            />
          ) : (
            <section aria-labelledby="organization-join-title">
              <Button
                className="mb-5 -ml-2"
                onClick={() => {
                  setJoinError(null);
                  setPhase("choice");
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                <ArrowLeft size={16} />
                {t("organization.start.back")}
              </Button>
              <Typography as="span" tone="primary" variant="micro">
                {t("organization.start.joinEyebrow")}
              </Typography>
              <Typography
                as="h1"
                className="mt-1"
                id="organization-join-title"
                variant="title"
              >
                {t("organization.start.joinHeading")}
              </Typography>
              <Typography className="mt-2" tone="muted" variant="bodySm">
                {t("organization.start.joinHelp")}
              </Typography>

              <div className="mt-6 grid gap-2 rounded-2xl border border-border bg-secondary/50 p-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail size={16} />
                  <Typography as="span" variant="caption">
                    {t("organization.start.currentEmail")}
                  </Typography>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Typography
                    as="strong"
                    className="min-w-0 truncate"
                    variant="bodySm"
                  >
                    {user.email}
                  </Typography>
                  <Button
                    className="shrink-0"
                    onClick={() => void copyEmail()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {emailCopied ? <Check size={15} /> : <Copy size={15} />}
                    {t(
                      emailCopied
                        ? "organization.start.emailCopied"
                        : "organization.start.copyEmail",
                    )}
                  </Button>
                </div>
              </div>

              <form className="mt-5 grid gap-3" onSubmit={submitInvitation}>
                <Label htmlFor={invitationId}>
                  {t("organization.start.invitationLink")}
                </Label>
                <div className="flex gap-2 max-[560px]:flex-col">
                  <div className="relative min-w-0 flex-1">
                    <Link2
                      className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                      size={16}
                    />
                    <Input
                      autoCapitalize="none"
                      autoComplete="off"
                      className="pl-9"
                      id={invitationId}
                      onChange={(event) => {
                        setInvitationValue(event.currentTarget.value);
                        setJoinError(null);
                      }}
                      placeholder={t(
                        "organization.start.invitationPlaceholder",
                      )}
                      spellCheck={false}
                      value={invitationValue}
                    />
                  </div>
                  <Button disabled={!invitationValue.trim()} type="submit">
                    {t("organization.start.checkInvitation")}
                    <ArrowRight size={16} />
                  </Button>
                </div>
                {joinError ? (
                  <Typography role="alert" tone="destructive" variant="caption">
                    {joinError}
                  </Typography>
                ) : null}
              </form>

              <div className="mt-6 grid gap-2 rounded-xl border border-border p-4">
                <Typography as="strong" variant="bodySm">
                  {t("organization.start.askOwnerTitle")}
                </Typography>
                <Typography tone="muted" variant="caption">
                  {t("organization.start.askOwnerDescription", {
                    email: user.email,
                  })}
                </Typography>
                <Typography tone="muted" variant="caption">
                  {t("organization.start.invitationPolicy")}
                </Typography>
              </div>
            </section>
          )}
        </Card>
      </main>
    </div>
  );
}
