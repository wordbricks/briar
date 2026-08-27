import { CircleAlert, Link2, ListChecks, RefreshCw } from "lucide-react";
import { LoadingState } from "@/components/ui/loading-state";
import { useMemo } from "react";
import type { HuntRun, RunEvidence, RunEvidenceImage } from "@/types";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import { formatDate, localizeWorkflowStage } from "../model/formatters";
import { RunEvidenceImageGallery } from "./RunEvidenceImageGallery";
import { useRunEvidenceLoader } from "./useRunEvidenceLoader";
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
  return <div aria-labelledby={labelledBy} className="run-evidence-panel" id={id} role="tabpanel">
      {loading ? <div className="run-evidence-state">
          <LoadingState label={t("run.evidenceLoading")} />
        </div> : loadError ? <button className="run-evidence-state error" onClick={() => void loadEvidence()} type="button">
          <CircleAlert size={15} />
          <span>{loadError}</span>
          <RefreshCw size={13} />
        </button> : stageGroups.length === 0 ? <div className="run-evidence-empty">
          <ListChecks aria-hidden="true" size={22} />
          <strong>{t("run.evidenceEmpty")}</strong>
        </div> : <div className="run-evidence-groups">
          {stageGroups.map(stage => {
        const satisfiedTypes = new Set(stage.evidence.filter(item => item.canonical && (item.status === "passed" || item.status === "skipped")).map(item => item.type));
        const unrecorded = stage.requirements.filter(type => !stage.evidence.some(item => item.type === type));
        return <section className="run-evidence-stage" key={stage.id}>
                <header>
                  <span>
                    <strong>{stage.label}</strong>
                    <code>{stage.id}</code>
                  </span>
                  <small>
                    {stage.requirements.length > 0 ? `${satisfiedTypes.size}/${stage.requirements.length}` : stage.evidence.length}
                  </small>
                </header>
                <div>
                  {stage.evidence.map(item => <article className={`run-evidence-item ${item.status}${item.canonical ? "" : " stale"}`} key={`${item.attempt}:${item.key}`}>
                      <header>
                        <strong>{item.type}</strong>
                        <span>
                          {!item.canonical && <em>{t("run.evidenceStale")}</em>}
                          <i className={item.status}>
                            {t(`run.evidenceStatus.${item.status}` as MessageKey)}
                          </i>
                        </span>
                      </header>
                      {item.detail && <p>{item.detail}</p>}
                      {(item.images?.length ?? 0) > 0 && onLoadImage ? <RunEvidenceImageGallery images={item.images ?? []} onLoadImage={onLoadImage} /> : null}
                      {item.command && <div className="run-evidence-command">
                          <small>{t("run.evidenceCommand")}</small>
                          <code>{item.command}</code>
                        </div>}
                      {item.url && <a href={item.url} rel="noreferrer" target="_blank">
                          <Link2 aria-hidden="true" size={13} />
                          {t("common.open")}
                        </a>}
                      {item.metadata && <details className="run-evidence-metadata">
                          <summary>{t("run.evidenceMetadata")}</summary>
                          <pre>{JSON.stringify(item.metadata, null, 2)}</pre>
                        </details>}
                      <footer>
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
