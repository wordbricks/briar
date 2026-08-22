import { CircleAlert, Trash2 } from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Typography } from "@/components/ui/typography";
import { useI18n } from "../i18n";
import type { SessionUser } from "../types";

const sharedOrganizationBlocker =
  "Account deletion is blocked by shared organization resources";
const confirmationMismatch = "Confirmation email does not match";
const recentSignInRequired = "Recent sign-in required for account deletion";

export function AccountDeletionSettings({
  compact = false,
  onDelete,
  user,
}: {
  compact?: boolean;
  onDelete: (confirmation: string) => Promise<void>;
  user: SessionUser;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed =
    confirmation.trim().toLowerCase() === user.email.toLowerCase();

  const close = () => {
    if (deleting) return;
    setOpen(false);
    setConfirmation("");
    setError(null);
  };

  const deleteAccount = async () => {
    if (!confirmed || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete(confirmation.trim());
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(
        message === sharedOrganizationBlocker
          ? t("account.deleteBlocked")
          : message === confirmationMismatch
            ? t("account.deleteConfirmationMismatch")
            : message === recentSignInRequired
              ? t("account.deleteRecentSignIn")
              : message,
      );
      setDeleting(false);
    }
  };

  return (
    <>
      <Card className="border-destructive/30">
        <CardContent
          className={
            compact
              ? "grid gap-4 p-4"
              : "flex items-center justify-between gap-6 p-5"
          }
        >
          <div className="grid gap-1.5">
            <Typography as="h3" variant="bodyLg">
              {t("account.deleteTitle")}
            </Typography>
            <Typography tone="muted" variant="bodySm">
              {t("account.deleteDescription")}
            </Typography>
          </div>
          <Button
            className={compact ? "w-full" : "shrink-0"}
            onClick={() => setOpen(true)}
            type="button"
            variant="destructive"
          >
            <Trash2 aria-hidden="true" size={15} />
            {t("account.deleteAction")}
          </Button>
        </CardContent>
      </Card>

      <Dialog
        onOpenChange={(nextOpen) => {
          if (nextOpen) setOpen(true);
          else close();
        }}
        open={open}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("account.deleteDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("account.deleteDialogDescription")}
            </DialogDescription>
          </DialogHeader>

          <label className="grid gap-2">
            <Typography as="span" variant="bodySm">
              {t("account.deleteConfirmationLabel", { email: user.email })}
            </Typography>
            <Input
              aria-label={t("account.deleteConfirmationInput")}
              autoCapitalize="none"
              autoComplete="off"
              disabled={deleting}
              onChange={(event) => {
                setConfirmation(event.target.value);
                setError(null);
              }}
              placeholder={user.email}
              spellCheck={false}
              type="email"
              value={confirmation}
            />
          </label>

          {error ? (
            <p
              className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-xs text-destructive"
              role="alert"
            >
              <CircleAlert aria-hidden="true" className="mt-0.5 shrink-0" size={14} />
              <span>{error}</span>
            </p>
          ) : null}

          <DialogFooter>
            <Button disabled={deleting} onClick={close} type="button" variant="outline">
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!confirmed || deleting}
              onClick={() => void deleteAccount()}
              type="button"
              variant="destructive"
            >
              {deleting ? (
                <Spinner aria-hidden="true" size={15} />
              ) : (
                <Trash2 aria-hidden="true" size={15} />
              )}
              {deleting
                ? t("account.deleting")
                : t("account.deleteConfirmAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
