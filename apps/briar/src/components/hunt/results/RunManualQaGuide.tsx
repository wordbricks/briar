import { ArrowUp, CircleAlert, Link2, ListChecks, RefreshCw } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useMemo } from "react";
import type { HuntRun, RunEvidence } from "@/types";
import { useI18n } from "@/i18n";
import { deploymentQaTargets } from "./model";
export function RunManualQaGuide({
  evidence,
  loadError,
  loading,
  onRetry,
  run
}: {
  evidence: RunEvidence[];
  loadError: string | null;
  loading: boolean;
  onRetry: () => Promise<void>;
  run: HuntRun;
}) {
  const {
    t
  } = useI18n();
  const deploymentTargets = useMemo(() => deploymentQaTargets(evidence, run.workflow), [evidence, run.workflow]);
  const localChecks = useMemo(() => Array.from(new Set(run.workflow.stages.filter(stage => stage.id === "local_qa").flatMap(stage => stage.checks ?? []).map(check => check.trim()).filter(Boolean))), [run.workflow.stages]);
  const revisionTarget = run.commitSha?.trim() || run.branch?.trim() || t("run.revision", {
    count: run.currentRevision
  });
  const showLocalGuide = !loading && deploymentTargets.length === 0;
  return <section aria-label={t("run.manualQaTitle")} className="run-manual-qa">
      <header>
        <span>
          <ListChecks aria-hidden="true" size={17} />
          <strong>{t("run.manualQaTitle")}</strong>
        </span>
        <p>{t("run.manualQaDescription")}</p>
      </header>
      {loading ? <div className="run-manual-qa-state">
          <Spinner aria-hidden="true" size={15} />
          {t("run.manualQaLoading")}
        </div> : loadError ? <>
          <button className="run-manual-qa-state error" onClick={() => void onRetry()} type="button">
            <CircleAlert aria-hidden="true" size={15} />
            <span>{t("run.manualQaLoadFailed")}</span>
            <RefreshCw aria-hidden="true" size={13} />
          </button>
          <p className="run-manual-qa-deployment-note unknown">
            {t("run.manualQaDeploymentUnknown")}
          </p>
        </> : deploymentTargets.length > 0 ? <>
          <div className="run-manual-qa-deployments">
            {deploymentTargets.map(target => <article key={target.url}>
                <div>
                  <small>{t("run.manualQaDeploymentReady")}</small>
                  <strong>{target.environment}</strong>
                  <span>
                    {t("run.manualQaTargetRevision", {
                revision: target.revision
              })}
                  </span>
                </div>
                <a href={target.url} rel="noreferrer" target="_blank">
                  <Link2 aria-hidden="true" size={14} />
                  {t("run.manualQaOpenTarget")}
                  <ArrowUp aria-hidden="true" size={13} />
                </a>
              </article>)}
          </div>
          <div className="run-manual-qa-steps compact">
            <div>
              <strong>{t("run.manualQaProcedureTitle")}</strong>
              <p>{t("run.manualQaDeploymentProcedure")}</p>
            </div>
            <div>
              <strong>{t("run.manualQaExpectedTitle")}</strong>
              <p>{t("run.manualQaExpected")}</p>
            </div>
          </div>
        </> : null}
      {showLocalGuide ? <>
          {!loadError ? <p className="run-manual-qa-deployment-note">
              <CircleAlert aria-hidden="true" size={14} />
              {t("run.manualQaNoDeployment")}
            </p> : null}
          <strong className="run-manual-qa-local-title">
            {t("run.manualQaLocalTitle")}
          </strong>
          <div className="run-manual-qa-steps">
            <div>
              <strong>{t("run.manualQaPrepareTitle")}</strong>
              <p>{t("run.manualQaPrepare", {
              target: revisionTarget
            })}</p>
            </div>
            <div>
              <strong>{t("run.manualQaProcedureTitle")}</strong>
              <p>{t("run.manualQaLocalProcedure")}</p>
              {localChecks.length > 0 ? <div className="run-manual-qa-checks">
                  {localChecks.map(check => <code key={check}>{check}</code>)}
                </div> : null}
            </div>
            <div>
              <strong>{t("run.manualQaExpectedTitle")}</strong>
              <p>{t("run.manualQaExpected")}</p>
            </div>
          </div>
        </> : null}
      <div className="run-manual-qa-next-action">
        <strong>{t("run.manualQaNextActionTitle")}</strong>
        <p>
          {t(run.status === "paused" ? "run.manualQaPausedNextAction" : "run.manualQaCompletedNextAction")}
        </p>
      </div>
    </section>;
}
