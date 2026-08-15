import { ArrowLeft, Building2 } from "lucide-react";
import { FormEvent, useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n";
import {
  isValidOrganizationHandle,
  organizationHandleFromName,
} from "../lib/organization-handle";

type HandleAvailability = "idle" | "checking" | "available" | "taken";

export function OrganizationCreate({
  embedded = false,
  onBack,
  onCheckHandle,
  onCreate,
}: {
  embedded?: boolean;
  onBack: () => void;
  onCheckHandle: (handle: string) => Promise<boolean>;
  onCreate: (input: { name: string; handle: string }) => Promise<void>;
}) {
  const { t } = useI18n();
  const nameId = useId();
  const handleId = useId();
  const handleMessageId = useId();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [hasEditedHandle, setHasEditedHandle] = useState(false);
  const [availability, setAvailability] =
    useState<HandleAvailability>("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmedName = name.trim();
  const handleIsValid = isValidOrganizationHandle(handle);

  useEffect(() => {
    setError(null);
    if (!handleIsValid) {
      setAvailability("idle");
      return;
    }

    let active = true;
    setAvailability("checking");
    const timer = window.setTimeout(() => {
      void onCheckHandle(handle)
        .then((available) => {
          if (active) setAvailability(available ? "available" : "taken");
        })
        .catch((caught) => {
          if (!active) return;
          setAvailability("idle");
          setError(caught instanceof Error ? caught.message : String(caught));
        });
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [handle, handleIsValid, onCheckHandle]);

  const handleMessage = !handle
    ? t("organization.create.handleRequired")
    : !handleIsValid
      ? t("organization.create.handleInvalid")
      : availability === "checking"
        ? t("organization.create.handleChecking")
        : availability === "taken"
          ? t("organization.create.handleTaken")
          : t("organization.create.handleHint");
  const handleHasError =
    (!handle && (hasEditedHandle || trimmedName.length > 0)) ||
    (handle.length > 0 && !handleIsValid) ||
    availability === "taken";
  const canSubmit =
    trimmedName.length > 0 &&
    handleIsValid &&
    availability === "available" &&
    !isSubmitting;
  const Root = embedded ? "section" : "main";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!trimmedName || !handleIsValid || isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    try {
      if (!(await onCheckHandle(handle))) {
        setAvailability("taken");
        return;
      }
      await onCreate({ name: trimmedName, handle });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (message.toLowerCase().includes("handle already exists")) {
        setAvailability("taken");
      } else {
        setError(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Root
      className={cn(
        "organization-create min-w-0",
        embedded
          ? "organization-create-embedded"
          : "flex-1 overflow-auto bg-background px-[clamp(28px,4.5vw,72px)] py-14",
      )}
    >
      <header className="organization-create-header mx-auto mb-7 flex max-w-[620px] items-start gap-3">
        {!embedded ? (
          <Button
            aria-label={t("organization.create.back")}
            className="organization-create-back size-8 shrink-0"
            onClick={onBack}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ArrowLeft aria-hidden="true" size={18} strokeWidth={1.8} />
          </Button>
        ) : null}
        <div className="min-w-0">
          <Typography as="span" className="tracking-wide uppercase" tone="primary" variant="micro">
            {t("organization.create.eyebrow")}
          </Typography>
          <Typography as="h1" className="mt-1" variant="title">
            {t("organization.create.title")}
          </Typography>
          <Typography className="mt-2" tone="muted" variant="bodySm">
            {t("organization.create.description")}
          </Typography>
        </div>
      </header>

      <form
        className="organization-create-card mx-auto grid max-w-[560px] gap-5 rounded-2xl border border-border bg-card p-6 shadow-md"
        onSubmit={submit}
      >
        <div
          aria-hidden="true"
          className="organization-create-icon grid size-11 place-items-center rounded-xl bg-accent text-primary"
        >
          <Building2 size={24} strokeWidth={1.6} />
        </div>

        <div className="grid gap-2">
          <Label htmlFor={nameId}>{t("organization.create.name")}</Label>
          <Input
            autoComplete="organization"
            autoFocus
            id={nameId}
            maxLength={100}
            onChange={(event) => {
              const nextName = event.target.value;
              setName(nextName);
              if (!hasEditedHandle) {
                setHandle(organizationHandleFromName(nextName));
              }
            }}
            placeholder={t("organization.create.namePlaceholder")}
            value={name}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor={handleId}>{t("organization.create.handle")}</Label>
          <div
            className={cn(
              "organization-handle-field flex h-10 items-center rounded-md border border-input bg-card focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20",
              handleHasError && "has-error border-destructive",
            )}
          >
            <span aria-hidden="true" className="pl-3 text-sm font-semibold text-muted-foreground">
              @
            </span>
            <Input
              aria-describedby={handleMessageId}
              aria-invalid={handleHasError}
              aria-label={t("organization.create.handle")}
              autoCapitalize="none"
              autoComplete="off"
              className="h-full border-0 bg-transparent pl-1 shadow-none focus-visible:ring-0"
              id={handleId}
              inputMode="url"
              maxLength={63}
              onChange={(event) => {
                setHasEditedHandle(true);
                setHandle(event.target.value.toLowerCase());
              }}
              pattern="[a-z0-9-]+"
              placeholder={t("organization.create.handlePlaceholder")}
              spellCheck={false}
              value={handle}
            />
          </div>
          <Typography
            as="small"
            className={cn(handleHasError && "has-error text-destructive")}
            id={handleMessageId}
            role={handleHasError ? "alert" : undefined}
            tone={handleHasError ? "destructive" : "muted"}
            variant="caption"
          >
            {handleMessage}
          </Typography>
        </div>

        {error ? (
          <Typography
            as="p"
            className="organization-create-error rounded-md border border-destructive/25 bg-destructive/8 px-3 py-2.5"
            role="alert"
            tone="destructive"
            variant="caption"
          >
            {error}
          </Typography>
        ) : null}

        <footer className="flex justify-end gap-2 pt-1">
          <Button onClick={onBack} type="button" variant="outline">
            {t("common.cancel")}
          </Button>
          <Button disabled={!canSubmit} type="submit">
            {isSubmitting
              ? t("organization.create.creating")
              : t("organization.create.submit")}
          </Button>
        </footer>
      </form>
    </Root>
  );
}
