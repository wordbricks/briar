import {
  Check,
  Download,
  Link2,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import {
  autoHuntWorkflowStageCatalog,
  type AutoHuntWorkflow,
} from "../lib/auto-hunt-contract";
import {
  buildDefaultStatusMapping,
  isCompleteStatusMapping,
  parsePlacementKey,
  placementKey,
  type LinearImportConnectResult,
  type LinearImportResult,
  type LinearImportStatesResult,
  type LinearStatusMapping,
  type LinearTeamSummary,
  type LinearWorkflowStateSummary,
} from "../lib/linear-import";
import { SelectMenu } from "./SelectMenu";

type Step = "apiKey" | "teams" | "mapping" | "done";

const builtInStageIds = new Set<string>(
  autoHuntWorkflowStageCatalog.map((stage) => stage.id),
);

function localizeStageLabel(
  t: (key: MessageKey, variables?: Record<string, string | number>) => string,
  stageId: string,
  fallback: string,
) {
  if (!builtInStageIds.has(stageId)) return fallback;
  return t(`stage.${stageId}` as MessageKey);
}

export function LinearIssueImport({
  projectId,
  workflow,
  repositoryConnected,
  onConnect,
  onLoadStates,
  onImport,
}: {
  projectId: string;
  workflow: AutoHuntWorkflow | null;
  /** Briar board statuses exist only after a repository is connected. */
  repositoryConnected: boolean;
  onConnect: (apiKey: string) => Promise<LinearImportConnectResult>;
  onLoadStates: (input: {
    apiKey: string;
    teamIds: string[];
  }) => Promise<LinearImportStatesResult>;
  onImport: (input: {
    apiKey: string;
    teamIds: string[];
    statusMapping: Record<string, string>;
  }) => Promise<LinearImportResult>;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("apiKey");
  const [apiKey, setApiKey] = useState("");
  const [viewer, setViewer] = useState<LinearImportConnectResult["viewer"] | null>(
    null,
  );
  const [teams, setTeams] = useState<LinearTeamSummary[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [states, setStates] = useState<LinearWorkflowStateSummary[]>([]);
  const [statusMapping, setStatusMapping] = useState<LinearStatusMapping>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LinearImportResult | null>(null);

  const firstStageId = workflow?.stages[0]?.id ?? null;
  const hasProjectStatuses = Boolean(
    repositoryConnected && workflow && workflow.stages.length > 0,
  );
  const placementOptions = useMemo(() => {
    const stages = workflow?.stages ?? [];
    return [
      { label: t("status.backlog"), value: "status:backlog" },
      { label: t("status.queued"), value: "status:queued" },
      ...stages.map((stage) => ({
        label: localizeStageLabel(t, stage.id, stage.label),
        value: `stage:${stage.id}`,
      })),
      { label: t("status.blocked"), value: "status:blocked" },
      { label: t("status.failed"), value: "status:failed" },
      { label: t("status.completed"), value: "status:completed" },
      { label: t("status.cancelled"), value: "status:cancelled" },
    ];
  }, [t, workflow?.stages]);

  const mappingComplete = isCompleteStatusMapping(states, statusMapping);
  const selectedCount = selectedTeamIds.length;

  const reset = () => {
    setStep("apiKey");
    setApiKey("");
    setViewer(null);
    setTeams([]);
    setSelectedTeamIds([]);
    setStates([]);
    setStatusMapping({});
    setBusy(false);
    setError(null);
    setResult(null);
  };

  const connect = async () => {
    if (!hasProjectStatuses) {
      setError(t("settings.linearImportNeedsRepository"));
      return;
    }
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError(t("settings.linearImportApiKeyRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const connected = await onConnect(trimmed);
      setApiKey(trimmed);
      setViewer(connected.viewer);
      setTeams(connected.teams);
      setSelectedTeamIds(connected.teams.map((team) => team.id));
      setStep("teams");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const loadStates = async () => {
    if (!hasProjectStatuses) {
      setError(t("settings.linearImportNeedsRepository"));
      return;
    }
    if (selectedTeamIds.length === 0) {
      setError(t("settings.linearImportSelectTeams"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const loaded = await onLoadStates({
        apiKey,
        teamIds: selectedTeamIds,
      });
      setStates(loaded.states);
      setStatusMapping(buildDefaultStatusMapping(loaded.states, firstStageId));
      setStep("mapping");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!hasProjectStatuses) {
      setError(t("settings.linearImportNeedsRepository"));
      return;
    }
    if (!mappingComplete) {
      setError(t("settings.linearImportMappingRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const serialized: Record<string, string> = {};
      for (const [stateId, placement] of Object.entries(statusMapping)) {
        serialized[stateId] = placementKey(placement);
      }
      const imported = await onImport({
        apiKey,
        teamIds: selectedTeamIds,
        statusMapping: serialized,
      });
      setResult(imported);
      setStep("done");
      // Drop the one-time API key from memory after a successful import.
      setApiKey("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const toggleTeam = (teamId: string) => {
    setSelectedTeamIds((current) =>
      current.includes(teamId)
        ? current.filter((id) => id !== teamId)
        : [...current, teamId],
    );
  };

  return (
    <section className="project-settings-linear-import">
      <header>
        <span className="project-settings-linear-icon">
          <Download size={18} strokeWidth={1.8} />
        </span>
        <span>
          <strong>{t("settings.linearImportTitle")}</strong>
          <small>{t("settings.linearImportDescription")}</small>
        </span>
      </header>

      {!hasProjectStatuses ? (
        <div className="project-settings-linear-import-body">
          <p className="project-settings-linear-import-blocked">
            {t("settings.linearImportNeedsRepository")}
          </p>
          <p>{t("settings.linearImportNeedsRepositoryHelp")}</p>
        </div>
      ) : null}

      {hasProjectStatuses && step === "apiKey" ? (
        <div className="project-settings-linear-import-body">
          <p>{t("settings.linearImportApiKeyHelp")}</p>
          <label>
            <span>{t("settings.linearImportApiKey")}</span>
            <input
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setApiKey(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void connect();
              }}
              placeholder="lin_api_..."
              spellCheck={false}
              type="password"
              value={apiKey}
            />
          </label>
          <footer>
            <p>{t("settings.linearImportOneTimeNote")}</p>
            <button disabled={busy || !apiKey.trim()} onClick={() => void connect()} type="button">
              {busy ? <LoaderCircle className="spin" size={14} /> : <Link2 size={14} />}
              {busy
                ? t("settings.linearImportConnecting")
                : t("settings.linearImportConnect")}
            </button>
          </footer>
        </div>
      ) : null}

      {hasProjectStatuses && step === "teams" ? (
        <div className="project-settings-linear-import-body">
          {viewer ? (
            <p className="project-settings-linear-import-viewer">
              {t("settings.linearImportConnectedAs", {
                name: viewer.name,
                org: viewer.organizationName,
              })}
            </p>
          ) : null}
          <div className="project-settings-linear-import-teams-header">
            <strong>{t("settings.linearImportTeams")}</strong>
            <button
              disabled={busy || teams.length === 0}
              onClick={() =>
                setSelectedTeamIds(
                  selectedTeamIds.length === teams.length
                    ? []
                    : teams.map((team) => team.id),
                )
              }
              type="button"
            >
              {selectedTeamIds.length === teams.length
                ? t("settings.linearImportDeselectAll")
                : t("settings.linearImportSelectAll")}
            </button>
          </div>
          {teams.length === 0 ? (
            <p className="project-settings-empty">{t("settings.linearImportNoTeams")}</p>
          ) : (
            <ul className="project-settings-linear-import-teams">
              {teams.map((team) => {
                const checked = selectedTeamIds.includes(team.id);
                return (
                  <li key={team.id}>
                    <label>
                      <input
                        checked={checked}
                        disabled={busy}
                        onChange={() => toggleTeam(team.id)}
                        type="checkbox"
                      />
                      <span>
                        <strong>{team.name}</strong>
                        <small>{team.key}</small>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <footer>
            <button disabled={busy} onClick={reset} type="button">
              {t("common.cancel")}
            </button>
            <button
              disabled={busy || selectedCount === 0}
              onClick={() => void loadStates()}
              type="button"
            >
              {busy ? <LoaderCircle className="spin" size={14} /> : null}
              {busy
                ? t("settings.linearImportLoadingStates")
                : t("settings.linearImportContinueMapping", {
                    count: selectedCount,
                  })}
            </button>
          </footer>
        </div>
      ) : null}

      {hasProjectStatuses && step === "mapping" ? (
        <div className="project-settings-linear-import-body">
          <p>{t("settings.linearImportMappingHelp")}</p>
          {states.length === 0 ? (
            <p className="project-settings-empty">
              {t("settings.linearImportNoStates")}
            </p>
          ) : (
            <div className="project-settings-linear-import-mapping">
              <div className="project-settings-linear-import-mapping-head">
                <span>{t("settings.linearImportLinearStatus")}</span>
                <span>{t("settings.linearImportBriarStatus")}</span>
              </div>
              {states.map((state) => {
                const current = statusMapping[state.id];
                const value = current ? placementKey(current) : "";
                return (
                  <div className="project-settings-linear-import-mapping-row" key={state.id}>
                    <div className="project-settings-linear-import-state">
                      <span
                        aria-hidden
                        className="project-settings-linear-import-state-dot"
                        style={{ background: state.color || "#9ca3af" }}
                      />
                      <span>
                        <strong>{state.name}</strong>
                        <small>
                          {state.teamKey} · {state.type}
                        </small>
                      </span>
                    </div>
                    <SelectMenu
                      disabled={busy}
                      label={t("settings.linearImportBriarStatus")}
                      onValueChange={(next) => {
                        const placement = parsePlacementKey(next);
                        if (!placement) return;
                        setStatusMapping((map) => ({
                          ...map,
                          [state.id]: placement,
                        }));
                      }}
                      options={placementOptions}
                      size="small"
                      value={value}
                    />
                  </div>
                );
              })}
            </div>
          )}
          <footer>
            <button
              disabled={busy}
              onClick={() => {
                setStep("teams");
                setError(null);
              }}
              type="button"
            >
              {t("settings.linearImportBack")}
            </button>
            <button
              disabled={busy || !mappingComplete}
              onClick={() => void runImport()}
              type="button"
            >
              {busy ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <Download size={14} />
              )}
              {busy
                ? t("settings.linearImportImporting")
                : t("settings.linearImportConfirm")}
            </button>
          </footer>
        </div>
      ) : null}

      {hasProjectStatuses && step === "done" && result ? (
        <div className="project-settings-linear-import-body">
          <p className="project-settings-linear-import-success">
            <Check size={14} />
            {t("settings.linearImportResult", {
              imported: result.imported,
              skipped: result.skipped,
              failed: result.failed,
              total: result.total,
            })}
          </p>
          {result.truncated ? (
            <p className="project-settings-linear-import-truncated">
              {t("settings.linearImportTruncated")}
            </p>
          ) : null}
          <footer>
            <button onClick={reset} type="button">
              <RefreshCw size={14} />
              {t("settings.linearImportAgain")}
            </button>
          </footer>
        </div>
      ) : null}

      {error ? (
        <p className="project-settings-linear-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="project-settings-linear-import-footnote" data-project-id={projectId}>
        {t("settings.linearImportProjectNote")}
      </p>
    </section>
  );
}
