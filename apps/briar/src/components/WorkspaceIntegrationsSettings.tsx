import {
  ArrowLeft,
  Check,
  ExternalLink,
  Github,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { SettingsAlert, SettingsPageHeader } from "@/components/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/typography";
import { useI18n } from "../i18n";
import {
  createGithubInstallUrl,
  loadGithubIntegration,
  type GithubIntegration,
} from "../lib/api";
import { openExternalUrl } from "../lib/auth-session";

type IntegrationView = "catalog" | "github";

const emptyGithubIntegration: GithubIntegration = {
  configured: true,
  canManage: false,
  connected: false,
  installationId: null,
  accountLogin: null,
  accountAvatarUrl: null,
  repositories: [],
  connectedAt: null,
};

export function WorkspaceIntegrationsSettings({
  workspaceId,
  token,
}: {
  workspaceId: string;
  token: string;
}) {
  const { t } = useI18n();
  const [activeView, setActiveView] = useState<IntegrationView>("catalog");
  const [github, setGithub] = useState<GithubIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<"enable" | null>(null);
  const [authorizationStarted, setAuthorizationStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshGeneration = useRef(0);

  const refresh = useCallback(
    async (quiet = false) => {
      const generation = ++refreshGeneration.current;
      if (!token) {
        if (generation === refreshGeneration.current) {
          setGithub(null);
          setLoading(false);
          setRefreshing(false);
        }
        return null;
      }
      if (!quiet) setRefreshing(true);
      try {
        const result = await loadGithubIntegration(token, workspaceId);
        if (generation !== refreshGeneration.current) return null;
        setGithub(result);
        if (result.connected) setAuthorizationStarted(false);
        setError(null);
        return result;
      } catch (caught) {
        if (generation === refreshGeneration.current && !quiet) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
        return null;
      } finally {
        if (generation === refreshGeneration.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [workspaceId, token],
  );

  useEffect(
    () => () => {
      refreshGeneration.current += 1;
    },
    [],
  );

  useEffect(() => {
    setActiveView("catalog");
    setLoading(true);
    setGithub(null);
    setAuthorizationStarted(false);
    setError(null);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!authorizationStarted) return;
    const refreshAfterAuthorization = () => {
      if (document.visibilityState === "hidden") return;
      void refresh(true);
    };
    const intervalId = window.setInterval(refreshAfterAuthorization, 2_500);
    const timeoutId = window.setTimeout(
      () => setAuthorizationStarted(false),
      120_000,
    );
    window.addEventListener("focus", refreshAfterAuthorization);
    document.addEventListener("visibilitychange", refreshAfterAuthorization);
    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
      window.removeEventListener("focus", refreshAfterAuthorization);
      document.removeEventListener(
        "visibilitychange",
        refreshAfterAuthorization,
      );
    };
  }, [authorizationStarted, refresh]);

  const integration = github ?? emptyGithubIntegration;
  const statusLabel = integration.connected
    ? t("workspace.githubConnected")
    : t("common.notConnected");

  if (activeView === "catalog") {
    return (
      <>
        <SettingsPageHeader
          className="mb-10 max-w-none"
          description={t("workspace.integrationsDescription")}
          title={t("workspace.integrationsTitle")}
        />

        {error ? (
          <SettingsAlert className="mb-5 mt-0">{error}</SettingsAlert>
        ) : null}

        <section className="w-full max-w-[820px]">
          <Typography
            as="h2"
            className="mb-3 uppercase tracking-[0.08em]"
            tone="muted"
            variant="caption"
          >
            {t("workspace.integrationsEssentials")}
          </Typography>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <button
              aria-label={t("workspace.githubOpen")}
              className="group min-h-[210px] rounded-2xl border border-border bg-card p-6 text-left shadow-xs transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              data-integration="github"
              onClick={() => setActiveView("github")}
              type="button"
            >
              <div className="flex items-start gap-3.5">
                <span className="grid size-12 shrink-0 place-items-center rounded-xl border border-border bg-foreground text-background shadow-xs">
                  <Github aria-hidden="true" size={27} strokeWidth={1.8} />
                </span>
                <div className="min-w-0 pt-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Typography as="h3" variant="bodyLg">
                      GitHub
                    </Typography>
                    {integration.connected ? (
                      <span
                        aria-hidden="true"
                        className="grid size-4 place-items-center rounded-full bg-success text-white"
                      >
                        <Check size={11} strokeWidth={2.5} />
                      </span>
                    ) : null}
                  </div>
                  <Typography
                    aria-live="polite"
                    className="mt-0.5"
                    tone="muted"
                    variant="caption"
                  >
                    {loading ? t("workspace.githubLoading") : statusLabel}
                  </Typography>
                </div>
              </div>
              <Typography
                className="mt-7 line-clamp-4"
                tone="muted"
                variant="body"
              >
                {t("workspace.githubCardDescription")}
              </Typography>
            </button>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <Button
        className="-ml-2 mb-6 text-muted-foreground"
        onClick={() => setActiveView("catalog")}
        size="sm"
        type="button"
        variant="ghost"
      >
        <ArrowLeft aria-hidden="true" size={15} />
        {t("workspace.integrationsBack")}
      </Button>

      <header className="mb-8 flex max-w-[820px] flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl border border-border bg-foreground text-background shadow-xs">
            <Github aria-hidden="true" size={31} strokeWidth={1.7} />
          </span>
          <div className="min-w-0 pt-0.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <Typography as="h1" variant="heading">
                GitHub
              </Typography>
              {!loading ? (
                <Badge variant={integration.connected ? "success" : "secondary"}>
                  {statusLabel}
                </Badge>
              ) : null}
            </div>
            <Typography className="mt-1.5" tone="muted" variant="body">
              {t("workspace.githubTagline")}
            </Typography>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:pt-1">
          <Button
            aria-label={t("workspace.githubRefresh")}
            disabled={refreshing}
            onClick={() => void refresh()}
            size="icon-sm"
            title={t("workspace.githubRefresh")}
            type="button"
            variant="ghost"
          >
            <RefreshCw
              aria-hidden="true"
              className={refreshing ? "animate-spin" : undefined}
              size={16}
            />
          </Button>
          {!integration.connected ? (
            <Button
              disabled={
                loading ||
                !integration.configured ||
                !integration.canManage ||
                busyAction !== null
              }
              onClick={() => {
                setBusyAction("enable");
                setError(null);
                void createGithubInstallUrl(token, workspaceId)
                  .then(({ installUrl }) => openExternalUrl(installUrl))
                  .then(() => setAuthorizationStarted(true))
                  .catch((caught) =>
                    setError(
                      caught instanceof Error ? caught.message : String(caught),
                    ),
                  )
                  .finally(() => setBusyAction(null));
              }}
              type="button"
            >
              <ExternalLink aria-hidden="true" size={15} />
              {busyAction === "enable"
                ? t("workspace.githubEnabling")
                : t("workspace.githubEnable")}
            </Button>
          ) : null}
        </div>
      </header>

      {error ? <SettingsAlert className="mb-4 mt-0">{error}</SettingsAlert> : null}
      {authorizationStarted ? (
        <SettingsAlert className="mb-4 mt-0" tone="info">
          {t("workspace.githubAuthorizationStarted")}
        </SettingsAlert>
      ) : null}
      {!loading && github && !integration.configured ? (
        <SettingsAlert className="mb-4 mt-0" tone="warning">
          {t("workspace.githubServerNotConfigured")}
        </SettingsAlert>
      ) : null}
      {!loading &&
      github &&
      integration.configured &&
      !integration.canManage ? (
        <SettingsAlert className="mb-4 mt-0" tone="info">
          {t("workspace.githubPermission")}
        </SettingsAlert>
      ) : null}

      <section className="w-full max-w-[820px] overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
        {loading && !github ? (
          <Typography className="p-6" tone="muted" variant="bodySm">
            {t("workspace.githubLoading")}
          </Typography>
        ) : integration.connected ? (
          <div className="p-6 sm:p-7">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3.5">
                {integration.accountAvatarUrl ? (
                  <img
                    alt=""
                    className="size-11 rounded-full border border-border object-cover"
                    referrerPolicy="no-referrer"
                    src={integration.accountAvatarUrl}
                  />
                ) : (
                  <span className="grid size-11 place-items-center rounded-full bg-success/15 text-success">
                    <Check aria-hidden="true" size={22} strokeWidth={2.2} />
                  </span>
                )}
                <div className="min-w-0">
                  <Typography as="h2" variant="bodyLg">
                    {integration.accountLogin ?? t("workspace.githubAccount")}
                  </Typography>
                  <Typography className="mt-0.5" tone="muted" variant="caption">
                    {t("workspace.githubRepositoryAccess", {
                      count: integration.repositories.length,
                    })}
                  </Typography>
                </div>
              </div>
            </div>

            {integration.repositories.length > 0 ? (
              <div className="mt-6 border-t border-border pt-5">
                <Typography as="h3" variant="bodySm">
                  {t("workspace.githubRepositories")}
                </Typography>
                <div className="mt-3 flex flex-wrap gap-2">
                  {integration.repositories.slice(0, 8).map((repository) => (
                    <Badge key={repository.id} variant="outline">
                      {repository.fullName}
                    </Badge>
                  ))}
                  {integration.repositories.length > 8 ? (
                    <Badge variant="secondary">
                      +{integration.repositories.length - 8}
                    </Badge>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="p-6 sm:p-7">
            <div className="flex items-start gap-3.5">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground">
                <ShieldCheck aria-hidden="true" size={20} strokeWidth={1.8} />
              </span>
              <div>
                <Typography as="h2" variant="bodyLg">
                  {t("workspace.githubOverview")}
                </Typography>
                <Typography className="mt-2" tone="muted" variant="body">
                  {t("workspace.githubOverviewDescription")}
                </Typography>
              </div>
            </div>
            <ul className="mt-6 grid gap-3 border-t border-border pt-5 text-sm text-muted-foreground sm:grid-cols-3">
              <li className="flex gap-2">
                <Check className="mt-0.5 shrink-0 text-success" size={15} />
                <span>{t("workspace.githubBenefitPr")}</span>
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 shrink-0 text-success" size={15} />
                <span>{t("workspace.githubBenefitMerge")}</span>
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 shrink-0 text-success" size={15} />
                <span>{t("workspace.githubBenefitScope")}</span>
              </li>
            </ul>
          </div>
        )}
      </section>
    </>
  );
}
