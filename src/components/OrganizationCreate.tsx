import { ArrowLeft, Building2 } from "lucide-react";
import { FormEvent, useEffect, useId, useState } from "react";
import { useI18n } from "../i18n";
import {
  isValidOrganizationHandle,
  organizationHandleFromName,
} from "../lib/organization-handle";

type HandleAvailability = "idle" | "checking" | "available" | "taken";

export function OrganizationCreate({
  onBack,
  onCheckHandle,
  onCreate,
}: {
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
    <main className="organization-create">
      <header className="organization-create-header">
        <button
          aria-label={t("organization.create.back")}
          className="organization-create-back"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={18} strokeWidth={1.8} />
        </button>
        <div>
          <span>{t("organization.create.eyebrow")}</span>
          <h1>{t("organization.create.title")}</h1>
          <p>{t("organization.create.description")}</p>
        </div>
      </header>

      <form className="organization-create-card" onSubmit={submit}>
        <div className="organization-create-icon" aria-hidden="true">
          <Building2 size={24} strokeWidth={1.6} />
        </div>

        <label htmlFor={nameId}>
          {t("organization.create.name")}
          <input
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
        </label>

        <label htmlFor={handleId}>
          {t("organization.create.handle")}
          <div
            className={`organization-handle-field${handleHasError ? " has-error" : ""}`}
          >
            <span aria-hidden="true">@</span>
            <input
              aria-label={t("organization.create.handle")}
              aria-describedby={handleMessageId}
              aria-invalid={handleHasError}
              autoCapitalize="none"
              autoComplete="off"
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
          <small
            className={handleHasError ? "has-error" : ""}
            id={handleMessageId}
            role={handleHasError ? "alert" : undefined}
          >
            {handleMessage}
          </small>
        </label>

        {error ? (
          <p className="organization-create-error" role="alert">
            {error}
          </p>
        ) : null}

        <footer>
          <button onClick={onBack} type="button">
            {t("common.cancel")}
          </button>
          <button disabled={!canSubmit} type="submit">
            {isSubmitting
              ? t("organization.create.creating")
              : t("organization.create.submit")}
          </button>
        </footer>
      </form>
    </main>
  );
}
