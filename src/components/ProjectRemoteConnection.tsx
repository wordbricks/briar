import {
  ArrowUp,
  Check,
  CircleAlert,
  Folder,
  GitBranch,
  Globe2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Server,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../i18n";
import {
  addSshHost,
  listExecutionHosts,
  listRemoteDirectory,
  loadProjectExecutionConnection,
  updateProjectExecutionConnection,
  type ExecutionHost,
  type ProjectExecutionConnection,
  type RemoteDirectoryListing,
} from "../lib/project-connection";
import { SelectMenu } from "./SelectMenu";

export function ProjectRemoteConnection({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [hosts, setHosts] = useState<ExecutionHost[]>([]);
  const [connection, setConnection] =
    useState<ProjectExecutionConnection | null>(null);
  const [executionHostId, setExecutionHostId] = useState("");
  const [path, setPath] = useState("");
  const [listing, setListing] = useState<RemoteDirectoryListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [browsing, setBrowsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddHost, setShowAddHost] = useState(false);
  const [sshAlias, setSshAlias] = useState("");
  const [sshLabel, setSshLabel] = useState("");
  const [addingHost, setAddingHost] = useState(false);

  const browse = useCallback(async (hostId: string, nextPath?: string) => {
    if (!hostId) return;
    setBrowsing(true);
    setError(null);
    setSaved(false);
    try {
      const next = await listRemoteDirectory(hostId, nextPath);
      setPath(next.path);
      setListing(next);
    } catch (caught) {
      setListing(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBrowsing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([
      listExecutionHosts(),
      loadProjectExecutionConnection(projectId),
    ])
      .then(async ([availableHosts, currentConnection]) => {
        if (cancelled) return;
        const sshHosts = availableHosts.filter((host) => host.kind === "ssh");
        setHosts(sshHosts);
        setConnection(currentConnection);
        const selectedHostId =
          (currentConnection?.executionHostId.startsWith("ssh:")
            ? currentConnection.executionHostId
            : sshHosts[0]?.id) ?? "";
        setExecutionHostId(selectedHostId);
        const initialPath =
          currentConnection?.executionHostId === selectedHostId
            ? currentConnection.repositoryPath
            : undefined;
        if (selectedHostId) await browse(selectedHostId, initialPath);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [browse, projectId]);

  const addHost = async () => {
    if (!sshAlias.trim()) return;
    setAddingHost(true);
    setError(null);
    try {
      const host = await addSshHost(sshAlias, sshLabel);
      setHosts((current) => [
        ...current.filter((candidate) => candidate.id !== host.id),
        host,
      ]);
      setExecutionHostId(host.id);
      setSshAlias("");
      setSshLabel("");
      setShowAddHost(false);
      await browse(host.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAddingHost(false);
    }
  };

  const save = async () => {
    if (!executionHostId || !listing?.gitRepository || listing.path !== path) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const next = await updateProjectExecutionConnection({
        projectId,
        executionHostId,
        repositoryPath: path,
      });
      setConnection(next);
      setPath(next.repositoryPath);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setSaved(false);
    setError(null);
    if (connection?.executionHostId.startsWith("ssh:")) {
      setExecutionHostId(connection.executionHostId);
      void browse(connection.executionHostId, connection.repositoryPath);
      return;
    }
    const firstHost = hosts[0];
    setExecutionHostId(firstHost?.id ?? "");
    setPath("");
    setListing(null);
    if (firstHost) void browse(firstHost.id);
  };

  const connectionUnchanged =
    connection?.executionHostId === executionHostId &&
    connection.repositoryPath === listing?.path;
  const canConnect =
    Boolean(executionHostId) &&
    listing?.gitRepository === true &&
    listing.path === path &&
    !saving &&
    !browsing &&
    !connectionUnchanged;

  return (
    <section
      aria-busy={loading}
      className="project-remote-connection"
      data-project-remote-connection
    >
      <header>
        <span className="project-remote-connection-icon">
          <Server size={18} strokeWidth={1.8} />
        </span>
        <span>
          <strong>{t("settings.remoteTitle")}</strong>
          <small>{t("settings.remoteDescription")}</small>
        </span>
        <button
          aria-label={t("settings.remoteRefresh")}
          disabled={loading || browsing}
          onClick={() => void browse(executionHostId, path || undefined)}
          type="button"
        >
          <RefreshCw
            className={loading || browsing ? "spin" : undefined}
            size={14}
          />
        </button>
      </header>

      {loading ? (
        <div className="project-remote-loading">
          <LoaderCircle className="spin" size={16} />
          {t("settings.remoteLoading")}
        </div>
      ) : (
        <>
          <div className="project-remote-host-row">
            <label>
              <span>{t("settings.remoteHost")}</span>
              <SelectMenu
                disabled={browsing || hosts.length === 0}
                label={t("settings.remoteHost")}
                onValueChange={(hostId) => {
                  setExecutionHostId(hostId);
                  setPath("");
                  setListing(null);
                  void browse(hostId);
                }}
                options={hosts.map((host) => ({
                  description: host.alias ?? host.hostname,
                  label: host.label,
                  value: host.id,
                }))}
                placeholder={t("settings.remoteNoHosts")}
                size="large"
                value={executionHostId}
              />
            </label>
            <button
              aria-expanded={showAddHost}
              className="project-remote-add-host"
              onClick={() => setShowAddHost((current) => !current)}
              type="button"
            >
              <Plus size={14} />
              {t("settings.remoteAddHost")}
            </button>
          </div>

          {showAddHost || hosts.length === 0 ? (
            <div className="project-remote-add-host-form">
              <label>
                <span>{t("settings.remoteSshAlias")}</span>
                <input
                  aria-label={t("settings.remoteSshAlias")}
                  disabled={addingHost}
                  onChange={(event) => setSshAlias(event.currentTarget.value)}
                  placeholder="kiwi"
                  value={sshAlias}
                />
              </label>
              <label>
                <span>{t("settings.remoteHostLabel")}</span>
                <input
                  aria-label={t("settings.remoteHostLabel")}
                  disabled={addingHost}
                  onChange={(event) => setSshLabel(event.currentTarget.value)}
                  placeholder={t("settings.remoteHostLabelPlaceholder")}
                  value={sshLabel}
                />
              </label>
              <button
                disabled={addingHost || !sshAlias.trim()}
                onClick={() => void addHost()}
                type="button"
              >
                {addingHost ? <LoaderCircle className="spin" size={14} /> : <Globe2 size={14} />}
                {t("settings.remoteAdd")}
              </button>
            </div>
          ) : null}

          {executionHostId ? (
            <div className="project-remote-browser">
              <label htmlFor="project-remote-path">
                {t("settings.remoteFolderPath")}
              </label>
              <form
                className="project-remote-path"
                onSubmit={(event) => {
                  event.preventDefault();
                  void browse(executionHostId, path);
                }}
              >
                <button
                  aria-label={t("settings.remoteParentFolder")}
                  disabled={browsing || !listing?.parentPath}
                  onClick={() =>
                    void browse(executionHostId, listing?.parentPath)
                  }
                  type="button"
                >
                  <ArrowUp size={15} />
                </button>
                <input
                  autoComplete="off"
                  id="project-remote-path"
                  onChange={(event) => {
                    setPath(event.currentTarget.value);
                    setSaved(false);
                  }}
                  spellCheck={false}
                  value={path}
                />
                <button disabled={browsing || !path.trim()} type="submit">
                  {browsing ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    t("settings.remoteOpen")
                  )}
                </button>
              </form>

              <ul
                aria-label={t("settings.remoteFolderList")}
                className="project-remote-folders"
              >
                {listing?.entries.map((entry) => (
                  <li key={entry.path}>
                    <button
                      onClick={() => void browse(executionHostId, entry.path)}
                      type="button"
                    >
                      <Folder size={14} strokeWidth={1.55} />
                      <span>{entry.name}</span>
                    </button>
                  </li>
                ))}
                {!browsing && listing?.entries.length === 0 ? (
                  <li className="project-remote-folder-empty">
                    {t("settings.remoteFolderEmpty")}
                  </li>
                ) : null}
              </ul>

              <div
                className={`project-remote-repository-status${
                  listing?.gitRepository ? " ready" : ""
                }`}
              >
                {listing?.gitRepository ? (
                  <Check size={14} />
                ) : (
                  <GitBranch size={14} />
                )}
                <span>
                  <strong>
                    {listing?.gitRepository
                      ? t("settings.remoteRepositoryReady")
                      : t("settings.remoteRepositoryNeeded")}
                  </strong>
                  <small>
                    {listing?.repositoryRemote ??
                      t("settings.remoteRepositoryHint")}
                  </small>
                </span>
              </div>
            </div>
          ) : (
            <div className="project-remote-empty">
              <Globe2 size={20} />
              <strong>{t("settings.remoteNoHosts")}</strong>
              <span>{t("settings.remoteNoHostsDescription")}</span>
            </div>
          )}

          {error ? (
            <p className="project-remote-error" role="alert">
              <CircleAlert size={14} />
              {error}
            </p>
          ) : null}
          {saved ? (
            <p className="project-remote-success" role="status">
              <Check size={14} />
              {t("settings.remoteSaved")}
            </p>
          ) : null}

          <footer>
            <p>{t("settings.remoteNotice")}</p>
            <div>
              <button
                disabled={saving || browsing}
                onClick={reset}
                type="button"
              >
                {t("common.cancel")}
              </button>
              <button
                className="project-remote-connect"
                disabled={!canConnect}
                onClick={() => void save()}
                type="button"
              >
                {saving ? (
                  <LoaderCircle className="spin" size={14} />
                ) : connectionUnchanged ? (
                  <Check size={14} />
                ) : null}
                {saving
                  ? t("settings.remoteConnecting")
                  : connectionUnchanged
                    ? t("common.saved")
                    : t("settings.remoteConnect")}
              </button>
            </div>
          </footer>
        </>
      )}
    </section>
  );
}
