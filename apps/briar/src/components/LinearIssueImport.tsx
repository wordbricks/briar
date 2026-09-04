import {
  Check,
  Download,
  Link2,
  RefreshCw,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import {
  autoHuntWorkflowStageCatalog,
  type AutoHuntWorkflow,
} from "../lib/auto-hunt-contract";
import {
  buildDefaultStatusMapping,
  canImportLinearIssues,
  isCompleteStatusMapping,
  placementKey,
  type LinearImportConnectResult,
  type LinearImportPlacement,
  type LinearImportResult,
  type LinearImportStatesResult,
  type LinearStatusMapping,
  type LinearTeamSummary,
  type LinearWorkflowStateSummary,
} from "../lib/linear-import";
import { MacSecurePasswordInput } from "./MacSecurePasswordInput";
import { SelectMenu } from "./SelectMenu";
import { SettingsAlert } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { StatusPanel } from "@/components/ui/status-panel";
import { Typography } from "@/components/ui/typography";

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
  active,
  projectId,
  workflow,
  repositoryConnected,
  onConnect,
  onLoadStates,
  onImport,
}: {
  /** Whether the containing settings panel is currently visible. */
  active: boolean;
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
    statusMapping: LinearStatusMapping;
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
  const hasProjectStatuses = canImportLinearIssues({
    repositoryConnected,
    workflowStageCount: workflow?.stages.length ?? 0,
  });
  const placementOptions = useMemo(() => {
    const stages = workflow?.stages ?? [];
    const options: Array<{
      label: string;
      placement: LinearImportPlacement;
      value: string;
    }> = [
      {
        label: t("status.backlog"),
        placement: { status: "backlog", workflowStage: null },
        value: "status:backlog",
      },
      {
        label: t("status.queued"),
        placement: { status: "queued", workflowStage: null },
        value: "status:queued",
      },
      ...stages.map((stage) => ({
        label: localizeStageLabel(t, stage.id, stage.label),
        placement: { status: "running" as const, workflowStage: stage.id },
        value: `stage:${stage.id}`,
      })),
      {
        label: t("status.blocked"),
        placement: { status: "blocked", workflowStage: null },
        value: "status:blocked",
      },
      {
        label: t("status.failed"),
        placement: { status: "failed", workflowStage: null },
        value: "status:failed",
      },
      {
        label: t("status.completed"),
        placement: { status: "completed", workflowStage: null },
        value: "status:completed",
      },
      {
        label: t("status.cancelled"),
        placement: { status: "cancelled", workflowStage: null },
        value: "status:cancelled",
      },
    ];
    return options;
  }, [t, workflow?.stages]);

  const mappingComplete = isCompleteStatusMapping(states, statusMapping);
  const selectedCount = selectedTeamIds.length;
  const apiKeyFieldAcceptsInput =
    active && hasProjectStatuses && step === "apiKey" && !busy;

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
      const imported = await onImport({
        apiKey,
        teamIds: selectedTeamIds,
        statusMapping,
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
    <section className="mt-4 rounded-xl border border-border bg-card p-5 shadow-xs">
      <header className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Download size={18} strokeWidth={1.8} />
        </span>
        <span className="grid min-w-0 gap-1">
          <Typography as="strong" variant="bodySm">
            {t("settings.linearImportTitle")}
          </Typography>
          <Typography as="small" tone="muted" variant="caption">
            {t("settings.linearImportDescription")}
          </Typography>
        </span>
      </header>

      {!hasProjectStatuses ? (
        <div className="mt-4 grid gap-3">
          <StatusPanel density="compact" tone="warning">
            {t("settings.linearImportNeedsRepository")}
          </StatusPanel>
          <Typography tone="muted" variant="caption">
            {t("settings.linearImportNeedsRepositoryHelp")}
          </Typography>
        </div>
      ) : null}

      {hasProjectStatuses && step === "apiKey" ? (
        <div className="mt-4 grid gap-3">
          <Typography tone="muted" variant="caption">
            {t("settings.linearImportApiKeyHelp")}
          </Typography>
          <label className="grid gap-1.5 text-xs font-semibold text-foreground">
            <span>{t("settings.linearImportApiKey")}</span>
            <MacSecurePasswordInput
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              className="font-mono"
              disabled={busy}
              onChange={(event) => setApiKey(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void connect();
              }}
              placeholder="lin_api_..."
              secureInputEligible={apiKeyFieldAcceptsInput}
              spellCheck={false}
              value={apiKey}
            />
          </label>
          <footer className="flex flex-wrap items-center justify-between gap-3 max-[760px]:items-stretch max-[760px]:[&>button]:w-full">
            <Typography className="min-w-44 flex-1" tone="muted" variant="caption">
              {t("settings.linearImportOneTimeNote")}
            </Typography>
            <Button disabled={busy || !apiKey.trim()} onClick={() => void connect()} type="button">
              {busy ? <Spinner className="size-[14px]" /> : <Link2 size={14} />}
              {busy
                ? t("settings.linearImportConnecting")
                : t("settings.linearImportConnect")}
            </Button>
          </footer>
        </div>
      ) : null}

      {hasProjectStatuses && step === "teams" ? (
        <div className="mt-4 grid gap-3">
          {viewer ? (
            <p className="rounded-lg bg-accent px-2.5 py-2 text-2xs font-semibold text-accent-foreground">
              {t("settings.linearImportConnectedAs", {
                name: viewer.name,
                org: viewer.organizationName,
              })}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2.5">
            <Typography as="strong" variant="caption">
              {t("settings.linearImportTeams")}
            </Typography>
            <Button
              disabled={busy || teams.length === 0}
              onClick={() =>
                setSelectedTeamIds(
                  selectedTeamIds.length === teams.length
                    ? []
                    : teams.map((team) => team.id),
                )
              }
              size="sm"
              type="button"
              variant="outline"
            >
              {selectedTeamIds.length === teams.length
                ? t("settings.linearImportDeselectAll")
                : t("settings.linearImportSelectAll")}
            </Button>
          </div>
          {teams.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted p-4 text-center text-2xs text-muted-foreground">
              {t("settings.linearImportNoTeams")}
            </p>
          ) : (
            <ul className="scrollbar-subtle grid max-h-56 list-none gap-1.5 overflow-auto p-0">
              {teams.map((team) => {
                const checked = selectedTeamIds.includes(team.id);
                return (
                  <li key={team.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 hover:bg-muted">
                      <input
                        checked={checked}
                        className="size-4 accent-primary"
                        disabled={busy}
                        onChange={() => toggleTeam(team.id)}
                        type="checkbox"
                      />
                      <span className="grid min-w-0 gap-0.5">
                        <Typography as="strong" variant="caption">
                          {team.name}
                        </Typography>
                        <Typography as="small" className="font-mono" tone="muted" variant="micro">
                          {team.key}
                        </Typography>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <footer className="flex flex-wrap items-center justify-between gap-3 max-[760px]:flex-col max-[760px]:items-stretch max-[760px]:[&>button]:w-full">
            <Button disabled={busy} onClick={reset} type="button" variant="outline">
              {t("common.cancel")}
            </Button>
            <Button
              disabled={busy || selectedCount === 0}
              onClick={() => void loadStates()}
              type="button"
            >
              {busy ? <Spinner className="size-[14px]" /> : null}
              {busy
                ? t("settings.linearImportLoadingStates")
                : t("settings.linearImportContinueMapping", {
                    count: selectedCount,
                  })}
            </Button>
          </footer>
        </div>
      ) : null}

      {hasProjectStatuses && step === "mapping" ? (
        <div className="mt-4 grid gap-3">
          <Typography tone="muted" variant="caption">
            {t("settings.linearImportMappingHelp")}
          </Typography>
          {states.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted p-4 text-center text-2xs text-muted-foreground">
              {t("settings.linearImportNoStates")}
            </p>
          ) : (
            <div className="grid gap-2">
              <div className="grid items-center gap-2.5 px-1 text-2xs font-semibold tracking-wide text-muted-foreground uppercase min-[761px]:grid-cols-[minmax(0,1.2fr)_minmax(160px,1fr)]">
                <span>{t("settings.linearImportLinearStatus")}</span>
                <span>{t("settings.linearImportBriarStatus")}</span>
              </div>
              {states.map((state) => {
                const current = statusMapping[state.id];
                const value = current ? placementKey(current) : "";
                return (
                  <div
                    className="grid items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2 min-[761px]:grid-cols-[minmax(0,1.2fr)_minmax(160px,1fr)]"
                    key={state.id}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: state.color || "#9ca3af" }}
                      />
                      <span className="grid min-w-0 gap-0.5">
                        <Typography as="strong" variant="caption">
                          {state.name}
                        </Typography>
                        <Typography as="small" tone="muted" variant="micro">
                          {state.teamKey} · {state.type}
                        </Typography>
                      </span>
                    </div>
                    <SelectMenu
                      disabled={busy}
                      label={t("settings.linearImportBriarStatus")}
                      onValueChange={(next) => {
                        const placement = placementOptions.find(
                          (option) => option.value === next,
                        )?.placement;
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
          <footer className="flex flex-wrap items-center justify-between gap-3 max-[760px]:flex-col max-[760px]:items-stretch max-[760px]:[&>button]:w-full">
            <Button
              disabled={busy}
              onClick={() => {
                setStep("teams");
                setError(null);
              }}
              type="button"
              variant="outline"
            >
              {t("settings.linearImportBack")}
            </Button>
            <Button
              disabled={busy || !mappingComplete}
              onClick={() => void runImport()}
              type="button"
            >
              {busy ? (
                <Spinner className="size-[14px]" />
              ) : (
                <Download size={14} />
              )}
              {busy
                ? t("settings.linearImportImporting")
                : t("settings.linearImportConfirm")}
            </Button>
          </footer>
        </div>
      ) : null}

      {hasProjectStatuses && step === "done" && result ? (
        <div className="mt-4 grid gap-3">
          <StatusPanel
            className="items-center text-2xs font-semibold"
            density="compact"
            role="status"
            tone="success"
          >
            <Check size={14} />
            {t("settings.linearImportResult", {
              imported: result.imported,
              skipped: result.skipped,
              failed: result.failed,
              total: result.total,
            })}
          </StatusPanel>
          {result.truncated ? (
            <p className="text-2xs text-[var(--status-warning-foreground)]">
              {t("settings.linearImportTruncated")}
            </p>
          ) : null}
          <ul className="grid gap-1 text-2xs text-muted-foreground">
            <li>{t("settings.linearImportHierarchyResult", result.relations.hierarchy)}</li>
            <li>{t("settings.linearImportRelatedResult", result.relations.related)}</li>
            <li>{t("settings.linearImportDependenciesResult", result.relations.dependencies)}</li>
            <li>{t("settings.linearImportUnsupportedResult", result.relations.unsupported)}</li>
          </ul>
          <footer className="flex justify-end max-[760px]:[&>button]:w-full">
            <Button onClick={reset} type="button">
              <RefreshCw size={14} />
              {t("settings.linearImportAgain")}
            </Button>
          </footer>
        </div>
      ) : null}

      {error ? (
        <SettingsAlert>
          {error}
        </SettingsAlert>
      ) : null}
      <Typography
        className="mt-3"
        data-project-id={projectId}
        tone="muted"
        variant="micro"
      >
        {t("settings.linearImportProjectNote")}
      </Typography>
    </section>
  );
}
