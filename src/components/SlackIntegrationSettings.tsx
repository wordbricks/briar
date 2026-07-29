import { MessageSquare, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { SettingsAlert, SettingsPageHeader } from "@/components/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Typography } from "@/components/ui/typography";
import { useI18n } from "../i18n";
import {
  createSlackInstallUrl,
  disconnectSlackInstallation,
  loadSlackIntegration,
  updateSlackInstallation,
  type SlackIntegration,
} from "../lib/api";
import { openExternalUrl } from "../lib/auth-session";
import { SelectMenu } from "./SelectMenu";

export function SlackIntegrationSettings({
  organizationId,
  token,
}: {
  organizationId: string;
  token: string;
}) {
  const { t } = useI18n();
  const [integration, setIntegration] = useState<SlackIntegration | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installStarted, setInstallStarted] = useState(false);

  const refresh = () => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return loadSlackIntegration(token, organizationId)
      .then((result) => {
        setIntegration(result);
        setSelectedProjectId(
          (current) => current || result.projects[0]?.id || "",
        );
        setError(null);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void refresh();
  }, [organizationId, token]);

  const projectOptions =
    integration?.projects.map((project) => ({
      label: project.name,
      value: project.id,
    })) ?? [];

  return (
    <>
      <SettingsPageHeader
        className="mb-8 max-w-none"
        description={t("organization.slackDescription")}
        title={t("organization.slackTitle")}
      />

      {error ? <SettingsAlert className="mb-4 mt-0">{error}</SettingsAlert> : null}
      {installStarted ? (
        <SettingsAlert className="mb-4 mt-0">
          {t("organization.slackInstallStarted")}
        </SettingsAlert>
      ) : null}

      <section className="w-full max-w-[820px] space-y-4">
        <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
          <div className="flex items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#4a154b] text-white">
              <MessageSquare aria-hidden="true" size={22} strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Typography as="h2" variant="bodyLg">
                  Slack
                </Typography>
                <Badge
                  variant={
                    integration?.installations.length ? "default" : "secondary"
                  }
                >
                  {integration?.installations.length
                    ? t("organization.slackConnected")
                    : t("common.notConnected")}
                </Badge>
              </div>
              <Typography className="mt-1.5" tone="muted" variant="caption">
                {t("organization.slackMentionHelp")}
              </Typography>
            </div>
            <Button
              aria-label={t("organization.slackRefresh")}
              disabled={loading}
              onClick={() => void refresh()}
              size="icon-sm"
              title={t("organization.slackRefresh")}
              type="button"
              variant="ghost"
            >
              <RefreshCw
                aria-hidden="true"
                className={loading ? "animate-spin" : undefined}
                size={16}
              />
            </Button>
          </div>

          {loading && !integration ? (
            <Typography className="mt-6" tone="muted" variant="bodySm">
              {t("organization.slackLoading")}
            </Typography>
          ) : integration && !integration.configured ? (
            <SettingsAlert className="mt-6">
              {t("organization.slackServerNotConfigured")}
            </SettingsAlert>
          ) : integration?.projects.length === 0 ? (
            <SettingsAlert className="mt-6">
              {t("organization.slackNoProjects")}
            </SettingsAlert>
          ) : integration?.canManage ? (
            <div className="mt-6 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div className="grid gap-2">
                <Label>{t("organization.slackDefaultProject")}</Label>
                <SelectMenu
                  label={t("organization.slackDefaultProject")}
                  onValueChange={setSelectedProjectId}
                  options={projectOptions}
                  value={selectedProjectId}
                />
              </div>
              <Button
                disabled={!selectedProjectId || busyKey === "install"}
                onClick={() => {
                  setBusyKey("install");
                  setError(null);
                  setInstallStarted(false);
                  void createSlackInstallUrl(
                    token,
                    organizationId,
                    selectedProjectId,
                  )
                    .then(({ installUrl }) => openExternalUrl(installUrl))
                    .then(() => setInstallStarted(true))
                    .catch((caught) =>
                      setError(
                        caught instanceof Error
                          ? caught.message
                          : String(caught),
                      ),
                    )
                    .finally(() => setBusyKey(null));
                }}
                type="button"
              >
                <Plus aria-hidden="true" size={15} />
                {t("organization.slackAddWorkspace")}
              </Button>
            </div>
          ) : (
            <Typography className="mt-6" tone="muted" variant="caption">
              {t("organization.slackPermission")}
            </Typography>
          )}
        </div>

        {integration?.installations.map((installation) => (
          <div
            className="grid gap-5 rounded-xl border border-border bg-card p-6 shadow-xs md:grid-cols-[minmax(180px,1fr)_minmax(240px,340px)] md:items-center"
            key={installation.teamId}
          >
            <div>
              <Typography as="h3" variant="bodyLg">
                {installation.teamName}
              </Typography>
              <Typography className="mt-1" tone="muted" variant="micro">
                {t("organization.slackWorkspaceId", {
                  id: installation.teamId,
                })}
              </Typography>
            </div>
            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label>{t("organization.slackDefaultProject")}</Label>
                <SelectMenu
                  disabled={
                    !integration.canManage || busyKey === installation.teamId
                  }
                  label={t("organization.slackDefaultProject")}
                  onValueChange={(projectId) => {
                    setBusyKey(installation.teamId);
                    setError(null);
                    void updateSlackInstallation(
                      token,
                      organizationId,
                      installation.teamId,
                      projectId,
                    )
                      .then(({ installation: updated }) =>
                        setIntegration((current) =>
                          current
                            ? {
                                ...current,
                                installations: current.installations.map(
                                  (candidate) =>
                                    candidate.teamId === updated.teamId
                                      ? updated
                                      : candidate,
                                ),
                              }
                            : current,
                        ),
                      )
                      .catch((caught) =>
                        setError(
                          caught instanceof Error
                            ? caught.message
                            : String(caught),
                        ),
                      )
                      .finally(() => setBusyKey(null));
                  }}
                  options={projectOptions}
                  value={installation.defaultProjectId ?? ""}
                />
              </div>
              {integration.canManage ? (
                <Button
                  className="justify-self-start text-destructive hover:text-destructive"
                  disabled={busyKey === installation.teamId}
                  onClick={() => {
                    if (!window.confirm(t("organization.slackDisconnectConfirm")))
                      return;
                    setBusyKey(installation.teamId);
                    setError(null);
                    void disconnectSlackInstallation(
                      token,
                      organizationId,
                      installation.teamId,
                    )
                      .then(() =>
                        setIntegration((current) =>
                          current
                            ? {
                                ...current,
                                installations: current.installations.filter(
                                  (candidate) =>
                                    candidate.teamId !== installation.teamId,
                                ),
                              }
                            : current,
                        ),
                      )
                      .catch((caught) =>
                        setError(
                          caught instanceof Error
                            ? caught.message
                            : String(caught),
                        ),
                      )
                      .finally(() => setBusyKey(null));
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" size={14} />
                  {t("organization.slackDisconnect")}
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
