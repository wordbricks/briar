import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Database,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Link2,
  ListChecks,
  LoaderCircle,
  LogOut,
  RefreshCw,
  UploadCloud,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProjectConnection } from "../hooks/useBriar";
import type {
  LocalAutoHuntConfig,
  RepositoryReadiness,
  VelenInspection,
} from "../lib/project-connection";
import type { SessionUser } from "../types";
import { NativeSelect } from "./NativeSelect";
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
  onConnect: (
    settings: LocalAutoHuntConfig,
    repositoryPath: string,
  ) => Promise<unknown>;
  onCreate: (input: { name: string }) => Promise<unknown>;
  onLogout: () => void;
  onRepositorySelect: () => Promise<string | null>;
  onRepositoryInspect: (
    repositoryPath: string,
    workflow: LocalAutoHuntConfig["workflow"],
  ) => Promise<RepositoryReadiness>;
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
  onRepositorySelect,
  onRepositoryInspect,
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
  const [repositoryPath, setRepositoryPath] = useState("");
  const [repositoryReadiness, setRepositoryReadiness] =
    useState<RepositoryReadiness | null>(null);
  const [repositoryError, setRepositoryError] = useState<string | null>(null);
  const [selectingRepository, setSelectingRepository] = useState(false);
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
    if (!repositoryPath || !velenOrg) return;
    await onConnect({
      velenOrg,
      linearEnabled,
      linearSource: linearEnabled ? linearSource || null : null,
      linearTeam: linearEnabled ? linearTeam || null : null,
      workflow: initialWorkflow,
    }, repositoryPath).catch(() => undefined);
  };

  const selectRepository = async () => {
    setSelectingRepository(true);
    setRepositoryError(null);
    try {
      const selected = await onRepositorySelect();
      if (!selected) return;
      setRepositoryPath(selected);
      setRepositoryReadiness(null);
      const readiness = await onRepositoryInspect(selected, initialWorkflow);
      setRepositoryPath(readiness.repositoryPath);
      setRepositoryReadiness(readiness);
    } catch (caught) {
      setRepositoryReadiness(null);
      setRepositoryError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setSelectingRepository(false);
    }
  };

  return (
    <div className="onboarding-shell">
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
      <main className="onboarding-card">
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
                    <span>
                      {t("onboarding.workflowDescription").replace(
                        "Codex App Server",
                        "Agent backend",
                      )}
                    </span>
                  </div>
                </div>
              </section>

              <section className={`setup-section repository-setup${repositoryPath ? " connected" : ""}`}>
                <div className="setup-section-heading">
                  {repositoryPath ? <Check size={18} /> : <FolderOpen size={18} />}
                  <div>
                    <strong>{t("onboarding.localRepository")}</strong>
                    <span className={repositoryPath ? "repository-path" : undefined} title={repositoryPath || undefined}>
                      {repositoryPath || t("onboarding.folderPicker")}
                    </span>
                  </div>
                  <button
                    className="setup-repository-action"
                    disabled={loading || selectingRepository}
                    onClick={() => void selectRepository()}
                    type="button"
                  >
                    {selectingRepository ? (
                      <LoaderCircle aria-hidden="true" className="spin" size={14} />
                    ) : (
                      <FolderOpen aria-hidden="true" size={14} />
                    )}
                    {selectingRepository
                      ? t("onboarding.repositorySelecting")
                      : repositoryPath
                        ? t("onboarding.repositoryChange")
                        : t("onboarding.repositorySelect")}
                  </button>
                </div>
                {repositoryPath ? (
                  <div
                    aria-label={t("onboarding.gitReadiness")}
                    className="repository-readiness"
                  >
                    <span className={repositoryReadiness?.gitReady ? "ready" : "warning"}>
                      {repositoryReadiness?.gitReady ? <Check size={13} /> : <CircleAlert size={13} />}
                      <i><strong>Git</strong><small>{repositoryReadiness?.gitVersion ?? t("common.checkNeeded")}</small></i>
                    </span>
                    <span className={repositoryReadiness?.remoteReachable ? "ready" : "warning"}>
                      {repositoryReadiness?.remoteReachable ? <Check size={13} /> : <GitBranch size={13} />}
                      <i><strong>origin</strong><small>{repositoryReadiness?.remote ?? t("onboarding.remoteMissing")}</small></i>
                    </span>
                    <span className={repositoryReadiness?.pushAccess ? "ready" : "warning"}>
                      {repositoryReadiness?.pushAccess ? <Check size={13} /> : <UploadCloud size={13} />}
                      <i><strong>push</strong><small>{repositoryReadiness?.pushAccess ? t("onboarding.pushReady") : t("onboarding.pushCheckNeeded")}</small></i>
                    </span>
                  </div>
                ) : null}
                {repositoryError ? (
                  <p className="repository-readiness-error" role="alert">
                    <CircleAlert size={13} />
                    {repositoryError}
                  </p>
                ) : null}
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
                      <NativeSelect
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
                  <label className="native-switch">
                    <input
                      aria-label={t("onboarding.linear")}
                      checked={linearEnabled}
                      disabled={!velen}
                      onChange={(event) => setLinearEnabled(event.currentTarget.checked)}
                      type="checkbox"
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>
                {linearEnabled ? (
                  <div className="settings-fields">
                    <label>
                      <span>{t("onboarding.linearSource")}</span>
                      <NativeSelect
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

            {error ? <div className="login-error" role="alert">{error}</div> : null}
            <button
              className="onboarding-primary-action"
              disabled={loading || selectingRepository || !repositoryReadiness?.gitReady || !velen || !velenOrg || (linearEnabled && !linearSource)}
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
              {error ? <div className="login-error" role="alert">{error}</div> : null}
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
      </main>
    </div>
  );
}
