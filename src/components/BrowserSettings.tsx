import {
  Download,
  ExternalLink,
  Globe2,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  SettingsAlert,
  SettingsCard,
  SettingsGroupHeading,
  SettingsIconButton,
  SettingsNote,
  SettingsSection,
} from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/typography";
import { useI18n } from "../i18n";
import {
  inspectAgentBrowser,
  installAgentBrowser,
  type AgentBrowserStatus,
} from "../lib/agent-browser";

export function BrowserSettings() {
  const { t } = useI18n();
  const [status, setStatus] = useState<AgentBrowserStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await inspectAgentBrowser());
    } catch (inspectionError) {
      setError(String(inspectionError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function install() {
    setInstalling(true);
    setError(null);
    try {
      setStatus(await installAgentBrowser());
    } catch (installationError) {
      setError(String(installationError));
    } finally {
      setInstalling(false);
    }
  }

  const description = loading
    ? t("browser.checking")
    : status?.supported === false
      ? t("browser.unsupported")
      : status?.browserReady
        ? t("browser.installed")
        : status?.installed
          ? t("browser.runtimeMissing")
          : t("browser.notInstalled");

  return (
    <SettingsSection>
      <SettingsGroupHeading
        action={
          <SettingsIconButton
            aria-label={t("browser.refresh")}
            disabled={loading || installing}
            onClick={() => void refresh()}
            title={t("browser.refresh")}
          >
            {loading ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <RefreshCw size={16} />
            )}
          </SettingsIconButton>
        }
        title={t("browser.automation")}
      />

      <SettingsCard aria-busy={loading || installing}>
        <div className="grid min-h-[88px] grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-3 px-[18px] py-4">
          <span className="grid size-9 place-items-center rounded-lg bg-secondary text-foreground">
            <Globe2 aria-hidden="true" size={20} strokeWidth={1.8} />
          </span>
          <div className="grid min-w-0 gap-1">
            <Typography
              as="strong"
              className="flex min-w-0 flex-wrap items-baseline gap-2 tracking-tight [&_code]:font-mono [&_code]:text-xs [&_code]:font-medium [&_code]:text-muted-foreground"
              variant="body"
            >
              agent-browser
              {status?.version ? <code>{status.version}</code> : null}
            </Typography>
            <Typography as="p" tone="muted" variant="bodySm">
              {description}
            </Typography>
          </div>
          {!loading && status?.supported && !status.browserReady ? (
            <Button
              aria-label={t("browser.install")}
              disabled={installing}
              onClick={() => void install()}
              size="sm"
              type="button"
              variant="outline"
            >
              {installing ? (
                <LoaderCircle className="spin" />
              ) : (
                <Download />
              )}
              {installing
                ? t("browser.installing")
                : status.installed
                  ? t("browser.finishSetup")
                  : t("browser.installAction")}
            </Button>
          ) : null}
        </div>
      </SettingsCard>

      {error ? <SettingsAlert>{error}</SettingsAlert> : null}
      <SettingsNote>
        {t("browser.note")} {" "}
        <a
          className="inline-flex items-center gap-1 underline underline-offset-2"
          href="https://github.com/vercel-labs/agent-browser"
          rel="noreferrer"
          target="_blank"
        >
          {t("browser.projectLink")}
          <ExternalLink aria-hidden="true" size={12} />
        </a>
      </SettingsNote>
    </SettingsSection>
  );
}
