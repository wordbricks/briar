import {
  Check,
  CircleAlert,
  ImagePlus,
  Save,
  Trash2,
  UserRound,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Typography } from "@/components/ui/typography";
import { useI18n } from "../i18n";
import {
  projectAgentAvatarAccept,
  projectAgentAvatarFromFile,
} from "../lib/project-agent-avatar";
import type { SessionUser } from "../types";

const usernamePattern = /^[a-z0-9_]{3,30}$/u;

export function AccountProfileSettings({
  compact = false,
  onSave,
  user,
}: {
  compact?: boolean;
  onSave: (input: {
    username: string | null;
    name: string;
    image: string | null;
  }) => Promise<SessionUser>;
  user: SessionUser;
}) {
  const { t } = useI18n();
  const [username, setUsername] = useState(user.username ?? "");
  const [name, setName] = useState(user.name);
  const [image, setImage] = useState(user.image ?? null);
  const [saved, setSaved] = useState({
    username: user.username ?? "",
    name: user.name,
    image: user.image ?? null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedUsername = username.trim().toLowerCase();
  const normalizedName = name.trim();
  const usernameValid =
    normalizedUsername.length === 0 || usernamePattern.test(normalizedUsername);
  const changed =
    normalizedUsername !== saved.username ||
    normalizedName !== saved.name ||
    image !== saved.image;

  const save = async () => {
    if (!usernameValid || !normalizedName || saving || !changed) return;
    setSaving(true);
    setError(null);
    try {
      const nextUser = await onSave({
        username: normalizedUsername || null,
        name: normalizedName,
        image,
      });
      const next = {
        username: nextUser.username ?? "",
        name: nextUser.name,
        image: nextUser.image ?? null,
      };
      setUsername(next.username);
      setName(next.name);
      setImage(next.image);
      setSaved(next);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(
        message === "Username is already taken"
          ? t("account.usernameTaken")
          : message,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      aria-label={t("account.profile")}
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Card>
        <CardContent className={compact ? "grid gap-5 p-4" : "grid gap-6 p-6"}>
          <div className="flex items-center gap-4">
            <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-secondary text-muted-foreground">
              {image ? (
                <img
                  alt={t("account.profilePicture")}
                  className="size-full object-cover"
                  src={image}
                />
              ) : (
                <UserRound aria-hidden="true" size={31} strokeWidth={1.6} />
              )}
            </span>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button asChild disabled={saving} size="sm" type="button" variant="outline">
                <label>
                  <ImagePlus aria-hidden="true" size={15} />
                  {t(image ? "account.changePicture" : "account.uploadPicture")}
                  <input
                    accept={projectAgentAvatarAccept}
                    aria-label={t("account.uploadPicture")}
                    className="sr-only"
                    disabled={saving}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (!file) return;
                      setError(null);
                      void projectAgentAvatarFromFile(file)
                        .then(setImage)
                        .catch(() => setError(t("account.pictureUploadFailed")));
                    }}
                    type="file"
                  />
                </label>
              </Button>
              {image ? (
                <Button
                  disabled={saving}
                  onClick={() => {
                    setImage(null);
                    setError(null);
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" size={15} />
                  {t("account.removePicture")}
                </Button>
              ) : null}
              <Typography className="basis-full" tone="muted" variant="caption">
                {t("account.pictureHint")}
              </Typography>
            </div>
          </div>

          <div className={compact ? "grid gap-4" : "grid grid-cols-2 gap-5"}>
            <label className="grid gap-2">
              <Typography as="span" variant="bodySm">
                {t("account.username")}
              </Typography>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">@</span>
                <Input
                  aria-invalid={Boolean(username) && !usernameValid}
                  autoCapitalize="none"
                  autoComplete="username"
                  className="pl-7"
                  disabled={saving}
                  maxLength={30}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setError(null);
                  }}
                  placeholder={t("account.usernamePlaceholder")}
                  spellCheck={false}
                  value={username}
                />
              </div>
              <Typography tone={username && !usernameValid ? "destructive" : "muted"} variant="caption">
                {t("account.usernameHint")}
              </Typography>
            </label>
            <label className="grid content-start gap-2">
              <Typography as="span" variant="bodySm">
                {t("account.nickname")}
              </Typography>
              <Input
                autoComplete="name"
                disabled={saving}
                maxLength={100}
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
                placeholder={t("account.nicknamePlaceholder")}
                value={name}
              />
            </label>
          </div>

          <div className="grid gap-2">
            <Typography as="span" variant="bodySm">
              {t("account.email")}
            </Typography>
            <Input disabled readOnly value={user.email} />
            <Typography tone="muted" variant="caption">
              {t("account.emailHint")}
            </Typography>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <p className="flex items-center gap-2 text-xs text-destructive" role="alert">
          <CircleAlert aria-hidden="true" size={14} />
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button
          className={compact ? "w-full" : undefined}
          disabled={saving || !usernameValid || !normalizedName || !changed}
          type="submit"
        >
          {saving ? (
            <Spinner aria-hidden="true" size={15} />
          ) : !changed ? (
            <Check aria-hidden="true" size={15} />
          ) : (
            <Save aria-hidden="true" size={15} />
          )}
          {saving
            ? t("common.saving")
            : !changed
              ? t("common.saved")
              : t("account.saveProfile")}
        </Button>
      </div>
    </form>
  );
}
