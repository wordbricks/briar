import {
  Check,
  Download,
  ExternalLink,
  Globe2,
  RefreshCw,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
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
import { cn } from "@/lib/utils";
import asideSymbolBlack from "../assets/aside-symbol-black.png";
import asideSymbolWhite from "../assets/aside-symbol-white.png";
import { useI18n } from "../i18n";
import {
  inspectAgentBrowser,
  inspectAsideBrowser,
  inspectEgoBrowser,
  installAgentBrowser,
  loadBrowserAutomationSettings,
  setupAsideBrowser,
  updateBrowserAutomationSettings,
} from "../lib/agent-browser";
import type {
  AgentBrowserStatus,
  AsideBrowserStatus,
  BrowserAutomationProvider,
  BrowserAutomationSettings,
  EgoBrowserStatus,
} from "../generated/tauri";

const egoDownloadUrl = "https://lite.ego.app/download?auto=1";
const egoDocsUrl = "https://lite.ego.app/document/en/docs/quick-start";
const asideDocsUrl = "https://docs.aside.com/help/get-started";
const asideDeveloperDocsUrl = "https://docs.aside.com/help/developers";

function AsideSymbol() {
  return (
    <>
      <img
        alt=""
        aria-hidden="true"
        className="size-5 object-contain dark:hidden"
        src={asideSymbolBlack}
      />
      <img
        alt=""
        aria-hidden="true"
        className="hidden size-5 object-contain dark:block"
        src={asideSymbolWhite}
      />
    </>
  );
}

export function BrowserSettings() {
  const { t } = useI18n();
  const [status, setStatus] = useState<AgentBrowserStatus | null>(null);
  const [egoStatus, setEgoStatus] = useState<EgoBrowserStatus | null>(null);
  const [asideStatus, setAsideStatus] = useState<AsideBrowserStatus | null>(
    null,
  );
  const [settings, setSettings] =
    useState<BrowserAutomationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [settingUpAside, setSettingUpAside] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [agentBrowser, egoBrowser, asideBrowser, browserSettings] =
        await Promise.all([
          inspectAgentBrowser(),
          inspectEgoBrowser(),
          inspectAsideBrowser(),
          loadBrowserAutomationSettings(),
        ]);
      setStatus(agentBrowser);
      setEgoStatus(egoBrowser);
      setAsideStatus(asideBrowser);
      setSettings(browserSettings);
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

  async function setupAside() {
    setSettingUpAside(true);
    setError(null);
    try {
      setAsideStatus(await setupAsideBrowser());
    } catch (setupError) {
      setError(String(setupError));
    } finally {
      setSettingUpAside(false);
    }
  }

  async function selectProvider(provider: BrowserAutomationProvider) {
    if (!settings || settings.provider === provider || saving) return;
    const previous = settings;
    setSettings({ provider });
    setSaving(true);
    setError(null);
    try {
      setSettings(await updateBrowserAutomationSettings({ provider }));
    } catch (selectionError) {
      setSettings(previous);
      setError(String(selectionError));
    } finally {
      setSaving(false);
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

  const egoDescription = loading
    ? t("browser.checking")
    : egoStatus?.supported === false
      ? t("browser.egoUnsupported")
      : egoStatus?.browserReady
        ? t("browser.egoInstalled")
        : egoStatus?.installed
          ? t("browser.egoSetupRequired")
          : t("browser.egoNotInstalled");

  const asideDescription = loading
    ? t("browser.checking")
    : asideStatus?.supported === false
      ? t("browser.asideUnsupported")
      : asideStatus?.browserReady
        ? t("browser.asideInstalled")
        : asideStatus?.installed
          ? t("browser.asideSetupRequired")
          : t("browser.asideNotInstalled");

  return (
    <SettingsSection>
      <SettingsGroupHeading
        action={
          <SettingsIconButton
            aria-label={t("browser.refresh")}
            disabled={loading || installing || settingUpAside || saving}
            onClick={() => void refresh()}
            title={t("browser.refresh")}
          >
            {loading ? (
              <Spinner className="size-[16px]" />
            ) : (
              <RefreshCw size={16} />
            )}
          </SettingsIconButton>
        }
        title={t("browser.automation")}
      />

      <SettingsCard aria-busy={loading || saving}>
        <div
          aria-label={t("browser.toolSelection")}
          className="grid gap-2 p-3 sm:grid-cols-3"
          role="radiogroup"
        >
          {([
            {
              provider: "ego-browser",
              label: "ego (lite)",
              description: t("browser.egoChoiceDescription"),
              ariaLabel: t("browser.selectEgo"),
            },
            {
              provider: "agent-browser",
              label: "agent-browser",
              description: t("browser.agentChoiceDescription"),
              ariaLabel: t("browser.selectAgent"),
            },
            {
              provider: "aside",
              label: "Aside",
              description: t("browser.asideChoiceDescription"),
              ariaLabel: t("browser.selectAside"),
            },
          ] as const).map((choice) => {
            const selected = settings?.provider === choice.provider;
            return (
              <button
                aria-checked={selected}
                aria-label={choice.ariaLabel}
                className={cn(
                  "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  selected
                    ? "border-primary bg-accent text-accent-foreground"
                    : "border-border bg-card text-foreground hover:bg-secondary",
                )}
                disabled={
                  loading ||
                  saving ||
                  (choice.provider === "aside" &&
                    !asideStatus?.browserReady)
                }
                key={choice.provider}
                onClick={() => void selectProvider(choice.provider)}
                role="radio"
                type="button"
              >
                <span className="grid min-w-0 gap-0.5">
                  <Typography as="strong" variant="bodySm">
                    {choice.label}
                  </Typography>
                  <Typography as="span" tone="muted" variant="caption">
                    {choice.description}
                  </Typography>
                </span>
                {selected ? <Check aria-hidden="true" size={16} /> : null}
              </button>
            );
          })}
        </div>
      </SettingsCard>

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
              ego (lite)
              {egoStatus?.version ? <code>{egoStatus.version}</code> : null}
            </Typography>
            <Typography as="p" tone="muted" variant="bodySm">
              {egoDescription}
            </Typography>
          </div>
          {!loading && egoStatus?.supported && !egoStatus.browserReady ? (
            <Button asChild size="sm" variant="outline">
              <a
                aria-label={t("browser.egoDownload")}
                href={egoStatus.installed ? egoDocsUrl : egoDownloadUrl}
                rel="noreferrer"
                target="_blank"
              >
                <Download />
                {egoStatus.installed
                  ? t("browser.finishSetup")
                  : t("browser.egoDownloadAction")}
              </a>
            </Button>
          ) : null}
        </div>
        <div className="border-t border-border" />
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
                <Spinner className="size-[24px]" />
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

      <SettingsCard aria-busy={loading || settingUpAside}>
        <div className="grid min-h-[104px] grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-3 px-[18px] py-4">
          <span className="grid size-9 place-items-center rounded-lg bg-secondary text-foreground">
            <AsideSymbol />
          </span>
          <div className="grid min-w-0 gap-1.5">
            <Typography
              as="strong"
              className="flex min-w-0 flex-wrap items-baseline gap-2 tracking-tight [&_code]:font-mono [&_code]:text-xs [&_code]:font-medium [&_code]:text-muted-foreground"
              variant="body"
            >
              Aside
              {asideStatus?.version ? <code>{asideStatus.version}</code> : null}
            </Typography>
            <Typography as="p" tone="muted" variant="bodySm">
              {asideDescription}
            </Typography>
            {asideStatus?.installed ? (
              <div
                aria-label={t("browser.asideReadiness")}
                className="flex flex-wrap gap-x-3 gap-y-1"
              >
                {([
                  ["cliReady", t("browser.asideCli")],
                  ["mcpReady", t("browser.asideMcp")],
                  ["skillReady", t("browser.asideSkill")],
                ] as const).map(([key, label]) => (
                  <Typography
                    as="span"
                    className="inline-flex items-center gap-1"
                    key={key}
                    tone={asideStatus[key] ? "default" : "muted"}
                    variant="caption"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-3 place-items-center rounded-full border",
                        asideStatus[key]
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40",
                      )}
                    >
                      {asideStatus[key] ? <Check size={8} /> : null}
                    </span>
                    {label}
                  </Typography>
                ))}
              </div>
            ) : null}
          </div>
          {!loading && asideStatus?.supported && !asideStatus.installed ? (
            <Button asChild size="sm" variant="outline">
              <a
                aria-label={t("browser.asideInstall")}
                href={asideDocsUrl}
                rel="noreferrer"
                target="_blank"
              >
                <Download />
                {t("browser.asideInstallAction")}
              </a>
            </Button>
          ) : null}
          {!loading &&
          asideStatus?.supported &&
          asideStatus.installed &&
          !asideStatus.browserReady ? (
            <Button
              aria-label={t("browser.asideSetup")}
              disabled={settingUpAside}
              onClick={() => void setupAside()}
              size="sm"
              type="button"
              variant="outline"
            >
              {settingUpAside ? (
                <Spinner className="size-[24px]" />
              ) : (
                <Download />
              )}
              {settingUpAside
                ? t("browser.asideSettingUp")
                : t("browser.asideSetupAction")}
            </Button>
          ) : null}
        </div>
        <div className="border-t border-border px-[18px] py-3">
          <Typography as="p" tone="muted" variant="caption">
            {t("browser.asideNote")} {" "}
            <a
              className="inline-flex items-center gap-1 underline underline-offset-2"
              href={
                asideStatus?.installed ? asideDeveloperDocsUrl : asideDocsUrl
              }
              rel="noreferrer"
              target="_blank"
            >
              {t("browser.asideDocs")}
              <ExternalLink aria-hidden="true" size={12} />
            </a>
          </Typography>
        </div>
      </SettingsCard>

      {error ? <SettingsAlert>{error}</SettingsAlert> : null}
      <SettingsNote>
        {t("browser.preferenceNote")} {" "}
        <a
          className="inline-flex items-center gap-1 underline underline-offset-2"
          href="https://lite.ego.app/"
          rel="noreferrer"
          target="_blank"
        >
          {t("browser.egoProjectLink")}
          <ExternalLink aria-hidden="true" size={12} />
        </a>{" "}
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
