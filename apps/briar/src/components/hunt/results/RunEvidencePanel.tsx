import { CircleAlert, Link2, ListChecks, RefreshCw } from "lucide-react";
import { LoadingState } from "@/components/ui/loading-state";
import { useMemo } from "react";
import type { HuntRun, RunEvidence, RunEvidenceImage } from "@/types";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import { formatDate, localizeWorkflowStage } from "../model/formatters";
import { RunEvidenceImageGallery } from "./RunEvidenceImageGallery";
import { useRunEvidenceLoader } from "./useRunEvidenceLoader";
import { cn } from "@/lib/utils";
export function RunEvidencePanel({
  id,
  labelledBy,
  onLoad,
  onLoadImage,
  run
}: {
  id: string;
  labelledBy: string;
  onLoad: () => Promise<RunEvidence[]>;
  onLoadImage?: (image: RunEvidenceImage) => Promise<Blob>;
  run: HuntRun;
}) {
  const {
    localeTag,
    t
  } = useI18n();
  const {
    evidence,
    loading,
    loadError,
    reload: loadEvidence
  } = useRunEvidenceLoader(run.id, onLoad, true, t("run.evidenceLoadFailed"));
  const stageGroups = useMemo(() => {
    const knownStageIds = new Set(run.workflow.stages.map(stage => stage.id));
    const configured = run.workflow.stages.map(stage => ({
      id: stage.id,
      label: localizeWorkflowStage(t, stage.id, stage.label),
      requirements: stage.evidence ?? [],
      evidence: evidence.filter(item => item.stage === stage.id)
    })).filter(stage => stage.requirements.length > 0 || stage.evidence.length > 0);
    const unknownStageIds = Array.from(new Set(evidence.filter(item => !knownStageIds.has(item.stage)).map(item => item.stage)));
    return [...configured, ...unknownStageIds.map(stageId => ({
      id: stageId,
      label: stageId,
      requirements: [] as string[],
      evidence: evidence.filter(item => item.stage === stageId)
    }))];
  }, [evidence, run.workflow.stages, t]);
  return <div aria-labelledby={labelledBy} className="run-evidence-panel min-h-0 w-full flex-1 overflow-y-auto px-0.5 pb-3 pt-2" id={id} role="tabpanel">
      {loading ? <div className="run-evidence-state flex min-h-[120px] items-center justify-center gap-2 text-2xs text-muted-foreground">
          <LoadingState label={t("run.evidenceLoading")} />
        </div> : loadError ? <button className="run-evidence-state error flex min-h-[120px] w-full items-center justify-center gap-2 rounded-lg border-0 bg-[var(--status-destructive-surface)] text-foreground" onClick={() => void loadEvidence()} type="button">
          <CircleAlert size={15} />
          <span>{loadError}</span>
          <RefreshCw size={13} />
        </button> : stageGroups.length === 0 ? <div className="run-evidence-empty flex min-h-[120px] flex-col items-center justify-center gap-2 text-center text-muted-foreground">
          <ListChecks aria-hidden="true" size={22} />
          <strong>{t("run.evidenceEmpty")}</strong>
        </div> : <div className="run-evidence-groups grid gap-3.5">
          {stageGroups.map(stage => {
        const satisfiedTypes = new Set(stage.evidence.filter(item => item.canonical && (item.status === "passed" || item.status === "skipped")).map(item => item.type));
        const unrecorded = stage.requirements.filter(type => !stage.evidence.some(item => item.type === type));
        return <section className="run-evidence-stage min-w-0" key={stage.id}>
                <header className="flex min-h-7 items-center justify-between gap-2.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <strong className="text-xs font-semibold text-foreground">{stage.label}</strong>
                    <code className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded bg-accent px-1.5 py-0.5 font-mono text-2xs text-accent-foreground">{stage.id}</code>
                  </span>
                  <small className="min-w-7 text-right font-mono text-2xs font-semibold text-muted-foreground">
                    {stage.requirements.length > 0 ? `${satisfiedTypes.size}/${stage.requirements.length}` : stage.evidence.length}
                  </small>
                </header>
                <div className="grid gap-1.5">
                  {stage.evidence.map(item => <article className={cn("run-evidence-item min-w-0 rounded-lg border border-border border-l-[3px] bg-card px-2.5 py-2.5", item.status === "passed" && "border-l-[#4baa86]", item.status === "pending" && "border-l-[#d49a42]", item.status === "failed" && "border-l-[#cf5367] bg-destructive/5", item.status === "skipped" && "border-l-muted-foreground", !item.canonical && "stale opacity-65")} key={`${item.attempt}:${item.key}`}>
                      <header className="flex items-start justify-between gap-2.5">
                        <strong className="min-w-0 break-words font-mono text-2xs font-semibold text-foreground">{item.type}</strong>
                        <span className="flex shrink-0 items-center gap-1">
                          {!item.canonical && <em className="rounded-full bg-[#f0ecfa] px-1.5 py-0.5 text-2xs font-semibold not-italic text-[#7c6aaf]">{t("run.evidenceStale")}</em>}
                          <i className={cn("rounded-full px-1.5 py-0.5 text-2xs font-semibold not-italic", item.status === "passed" && "bg-[var(--status-success-surface)] text-[var(--status-success-foreground)]", item.status === "pending" && "bg-[var(--status-warning-surface)] text-[var(--status-warning-foreground)]", item.status === "failed" && "bg-[var(--status-destructive-surface)] text-[var(--status-destructive-foreground)]", item.status === "skipped" && "bg-muted text-muted-foreground", !["passed", "pending", "failed", "skipped"].includes(item.status) && "bg-muted text-muted-foreground")}>
                            {t(`run.evidenceStatus.${item.status}` as MessageKey)}
                          </i>
                        </span>
                      </header>
                      {item.detail && <p className="my-2 break-words whitespace-pre-wrap text-2xs leading-relaxed text-muted-foreground">{item.detail}</p>}
                      {(item.images?.length ?? 0) > 0 && onLoadImage ? <RunEvidenceImageGallery images={item.images ?? []} onLoadImage={onLoadImage} /> : null}
                      {item.command && <div className="run-evidence-command mt-2 grid gap-1">
                          <small className="text-2xs text-muted-foreground">{t("run.evidenceCommand")}</small>
                          <code className="overflow-x-auto rounded-md border border-border bg-muted px-2 py-1.5 font-mono text-2xs leading-relaxed text-foreground">{item.command}</code>
                        </div>}
                      {item.url && <a className="mt-2 inline-flex w-fit max-w-full items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap text-2xs font-semibold text-accent-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring" href={item.url} rel="noreferrer" target="_blank">
                          <Link2 aria-hidden="true" size={13} />
                          {t("common.open")}
                        </a>}
                      {item.metadata && <details className="run-evidence-metadata mt-2 text-2xs text-muted-foreground">
                          <summary>{t("run.evidenceMetadata")}</summary>
                          <pre className="mt-1.5 max-h-44 overflow-auto rounded-md bg-muted p-2 font-mono text-2xs leading-relaxed text-foreground">{JSON.stringify(item.metadata, null, 2)}</pre>
                        </details>}
                      <footer className="mt-2 flex items-center justify-between gap-2.5 border-t border-border pt-2 font-mono text-2xs text-muted-foreground">
                        <span>
                          {t("run.attempt", {
                    count: item.attempt
                  })} ·{" "}
                          {t("run.revision", {
                    count: item.revision
                  })}
                        </span>
                        <span>
                          {item.actor} · {formatDate(item.observedAt, localeTag)}
                        </span>
                      </footer>
                    </article>)}
                  {unrecorded.map(type => <article className="run-evidence-item unrecorded" key={`unrecorded:${type}`}>
                      <header>
                        <strong>{type}</strong>
                        <span>
                          <i>{t("run.evidenceNotRecorded")}</i>
                        </span>
                      </header>
                    </article>)}
                </div>
              </section>;
      })}
        </div>}
    </div>;
}
