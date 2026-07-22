import {
  ArrowLeft,
  ArrowRight,
  Check,
  Database,
  FolderGit2,
  FolderOpen,
  Link2,
  ListChecks,
  LogOut,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProjectConnection } from "../hooks/useBriar";
import type {
  LocalAutoHuntConfig,
  VelenInspection,
} from "../lib/project-connection";
import type { SessionUser } from "../types";
import { JellySelect } from "./JellySelect";
import { Logo } from "./Logo";
import {
  normalizeAutoHuntWorkflow,
} from "../lib/auto-hunt-contract";
import { useI18n } from "../i18n";

type Props = {
  canCancel?: boolean;
  connection: ProjectConnection | null;
  error: string | null;
  loading: boolean;
  onCancel: () => void;
  onConnect: (settings: LocalAutoHuntConfig) => Promise<unknown>;
  onCreate: (input: { name: string }) => Promise<unknown>;
  onLogout: () => void;
  onVelenOrgChange: (org?: string | null) => Promise<VelenInspection | null>;
  user: SessionUser;
  velen: VelenInspection | null;
};

export function ProjectOnboarding({
  canCancel = false,
  connection,
  error,
  loading,
  onCancel,
  onConnect,
  onCreate,
  onLogout,
  onVelenOrgChange,
  user,
  velen,
}: Props) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [velenOrg, setVelenOrg] = useState("");
  const [linearEnabled, setLinearEnabled] = useState(false);
  const [linearSource, setLinearSource] = useState("");
  const [linearTeam, setLinearTeam] = useState("");
  const initialWorkflow = normalizeAutoHuntWorkflow(connection?.workflow);

  useEffect(() => {
    if (!velen || velenOrg) return;
    setVelenOrg(velen.currentOrg ?? velen.organizations[0]?.slug ?? "");
  }, [velen, velenOrg]);

  const linearSources = useMemo(
    () =>
      (velen?.sources ?? []).filter(
        (source) => source.provider === "linear" && source.status === "active",
      ),
    [velen],
  );

  useEffect(() => {
    if (!linearSource && linearSources[0]) {
      setLinearSource(linearSources[0].sourceRef);
    }
  }, [linearSource, linearSources]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onCreate({ name }).catch(() => undefined);
  };

  const connect = async () => {
    if (!velenOrg) return;
    await onConnect({
      velenOrg,
      linearEnabled,
      linearSource: linearEnabled ? linearSource || null : null,
      linearTeam: linearEnabled ? linearTeam || null : null,
      workflow: initialWorkflow,
    }).catch(() => undefined);
  };

  return (
    <jelly-theme mode="light" className="onboarding-shell">
      <header className="onboarding-topbar">
        <Logo />
        <div className="onboarding-topbar-actions">
          {canCancel ? (
            <button onClick={onCancel} type="button">
              <ArrowLeft size={14} /> {t("onboarding.back")}
            </button>
          ) : null}
          <button onClick={onLogout} type="button">
            <LogOut size={14} /> {user.email}
          </button>
        </div>
      </header>
      <jelly-card className="onboarding-card">
        <div className="onboarding-icon">
          {connection ? <Check size={24} /> : <FolderGit2 size={24} />}
        </div>
        {connection ? (
          <>
            <p className="eyebrow">AUTO HUNT CONNECTION</p>
            <h1>{t("onboarding.connectTitle", { name: connection.project.name })}</h1>
            <p className="onboarding-copy">{t("onboarding.connectDescription")}</p>

            <div className="setup-grid">
              <section className="setup-section">
                <div className="setup-section-heading">
                  <ListChecks size={18} />
                  <div>
                    <strong>{t("onboarding.workflow")}</strong>
                    <span>{t("onboarding.workflowDescription")}</span>
                  </div>
                </div>
              </section>

              <section className="setup-section">
                <div className="setup-section-heading">
                  <FolderOpen size={18} />
                  <div><strong>{t("onboarding.localRepository")}</strong><span>{t("onboarding.folderPicker")}</span></div>
                </div>
              </section>

              <section className="setup-section">
                <div className="setup-section-heading">
                  <Database size={18} />
                  <div>
                    <strong>Velen CLI <em>{t("common.required")}</em></strong>
                    <span>{velen ? `${velen.email ?? t("onboarding.loggedIn")} · ${t("onboarding.authenticated")}` : t("onboarding.checkingInstall")}</span>
                  </div>
                  <button className="icon-action" onClick={() => void onVelenOrgChange(velenOrg)} type="button" aria-label={t("onboarding.refreshVelen")}>
                    <RefreshCw size={15} />
                  </button>
                </div>
                {velen ? (
                  <div className="settings-fields single-field">
                    <label>
                      <span>{t("onboarding.organization")}</span>
                      <JellySelect
                        label={t("onboarding.velenOrg")}
                        options={velen.organizations.map((organization) => ({
                          label: organization.name,
                          value: organization.slug,
                        }))}
                        value={velenOrg}
                        onValueChange={(org) => {
                          setVelenOrg(org);
                          setLinearSource("");
                          void onVelenOrgChange(org);
                        }}
                      />
                    </label>
                  </div>
                ) : null}
              </section>

              <section className="setup-section">
                <div className="setup-section-heading">
                  <Link2 size={18} />
                  <div><strong>{t("onboarding.linear")}</strong><span>{t("onboarding.linearDescription")}</span></div>
                  <jelly-switch
                    aria-label={t("onboarding.linear")}
                    checked={linearEnabled}
                    disabled={!velen}
                    size="small"
                    variant="mint"
                    onChange={(event) => setLinearEnabled((event.currentTarget as HTMLElement & { checked?: boolean }).checked ?? false)}
                  />
                </div>
                {linearEnabled ? (
                  <div className="settings-fields">
                    <label>
                      <span>{t("onboarding.linearSource")}</span>
                      <JellySelect
                        label={t("onboarding.linearSource")}
                        onValueChange={setLinearSource}
                        options={linearSources.map((source) => ({
                          label: source.sourceKey,
                          value: source.sourceRef,
                        }))}
                        placeholder={t("onboarding.selectLinearSource")}
                        value={linearSource}
                      />
                    </label>
                    <label>
                      <span>{t("onboarding.teamKey")} <small>{t("common.optional")}</small></span>
                      <input
                        aria-label={t("onboarding.teamKey")}
                        className="native-input"
                        onChange={(event) => setLinearTeam(event.currentTarget.value)}
                        placeholder={t("onboarding.teamKeyExample")}
                        value={linearTeam}
                      />
                    </label>
                  </div>
                ) : null}
              </section>
            </div>

            {error ? <jelly-alert variant="rose" className="login-error">{error}</jelly-alert> : null}
            <button
              className="onboarding-primary-action"
              disabled={loading || !velen || !velenOrg || (linearEnabled && !linearSource)}
              onClick={() => void connect()}
              type="button"
            >
              {loading ? t("onboarding.connecting") : t("onboarding.connect")} <ArrowRight size={17} />
            </button>
            <p className="token-warning">
              {t("onboarding.localStorageNotice")}
            </p>
          </>
        ) : (
          <>
            <p className="eyebrow">{canCancel ? "NEW PROJECT" : "FIRST PROJECT"}</p>
            <h1>{canCancel ? t("onboarding.addProject") : t("onboarding.createProject")}</h1>
            <p className="onboarding-copy">
              {canCancel
                ? t("onboarding.addDescription")
                : t("onboarding.createDescription")}
            </p>
            <form className="project-form" onSubmit={(event) => void submit(event)}>
              <label>
                <span>{t("onboarding.projectName")}</span>
                <input
                  aria-label={t("onboarding.projectName")}
                  className="native-input"
                  onChange={(event) => setName(event.currentTarget.value)}
                  placeholder="wordbricks"
                  value={name}
                />
              </label>
              {error ? <jelly-alert variant="rose" className="login-error">{error}</jelly-alert> : null}
              <button
                className="onboarding-primary-action"
                disabled={loading || !name.trim()}
                type="submit"
              >
                {loading ? t("onboarding.creating") : t("onboarding.createProject")} <ArrowRight size={17} />
              </button>
            </form>
          </>
        )}
      </jelly-card>
    </jelly-theme>
  );
}
