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
  return <section aria-label={t("run.manualQaTitle")} className="run-manual-qa mt-3 grid gap-3 rounded-xl border border-border bg-card p-3.5">
      <header className="grid gap-1">
        <span className="flex items-center gap-1.5">
          <ListChecks aria-hidden="true" size={17} />
          <strong>{t("run.manualQaTitle")}</strong>
        </span>
        <p className="m-0 text-2xs leading-relaxed text-muted-foreground">{t("run.manualQaDescription")}</p>
      </header>
      {loading ? <div className="run-manual-qa-state flex min-h-16 items-center justify-center gap-2 text-2xs text-muted-foreground">
          <Spinner aria-hidden="true" size={15} />
          {t("run.manualQaLoading")}
        </div> : loadError ? <>
          <button className="run-manual-qa-state error flex min-h-16 w-full items-center justify-center gap-2 rounded-lg border-0 bg-destructive/10 text-foreground" onClick={() => void onRetry()} type="button">
            <CircleAlert aria-hidden="true" size={15} />
            <span>{t("run.manualQaLoadFailed")}</span>
            <RefreshCw aria-hidden="true" size={13} />
          </button>
          <p className="run-manual-qa-deployment-note unknown m-0 flex items-start gap-2 rounded-lg bg-muted px-2.5 py-2 text-2xs leading-relaxed text-muted-foreground">
            {t("run.manualQaDeploymentUnknown")}
          </p>
        </> : deploymentTargets.length > 0 ? <>
          <div className="run-manual-qa-deployments grid gap-2">
            {deploymentTargets.map(target => <article className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border bg-muted p-2.5" key={target.url}>
                <div className="grid min-w-0 gap-0.5">
                  <small className="text-2xs font-bold text-[var(--status-success-foreground)]">{t("run.manualQaDeploymentReady")}</small>
                  <strong className="truncate text-xs">{target.environment}</strong>
                  <span className="font-mono text-2xs text-muted-foreground">
                    {t("run.manualQaTargetRevision", {
                revision: target.revision
              })}
                  </span>
                </div>
                <a className="inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-lg border border-primary bg-primary px-2.5 text-2xs font-bold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring" href={target.url} rel="noreferrer" target="_blank">
                  <Link2 aria-hidden="true" size={14} />
                  {t("run.manualQaOpenTarget")}
                  <ArrowUp aria-hidden="true" size={13} />
                </a>
              </article>)}
          </div>
          <div className="run-manual-qa-steps compact grid grid-cols-2 gap-2 max-[560px]:grid-cols-1">
            <div className="min-w-0 rounded-lg border border-border bg-card p-2.5">
              <strong className="text-2xs">{t("run.manualQaProcedureTitle")}</strong>
              <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{t("run.manualQaDeploymentProcedure")}</p>
            </div>
            <div className="min-w-0 rounded-lg border border-border bg-card p-2.5">
              <strong className="text-2xs">{t("run.manualQaExpectedTitle")}</strong>
              <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{t("run.manualQaExpected")}</p>
            </div>
          </div>
        </> : null}
      {showLocalGuide ? <>
          {!loadError ? <p className="run-manual-qa-deployment-note m-0 flex items-start gap-2 rounded-lg bg-[var(--status-warning-surface)] px-2.5 py-2 text-2xs leading-relaxed text-[var(--status-warning-foreground)]">
              <CircleAlert aria-hidden="true" size={14} />
              {t("run.manualQaNoDeployment")}
            </p> : null}
          <strong className="run-manual-qa-local-title text-xs">
            {t("run.manualQaLocalTitle")}
          </strong>
          <div className="run-manual-qa-steps grid grid-cols-3 gap-2 max-[760px]:grid-cols-1">
            <div className="min-w-0 rounded-lg border border-border bg-card p-2.5">
              <strong className="text-2xs">{t("run.manualQaPrepareTitle")}</strong>
              <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{t("run.manualQaPrepare", {
              target: revisionTarget
            })}</p>
            </div>
            <div className="min-w-0 rounded-lg border border-border bg-card p-2.5">
              <strong className="text-2xs">{t("run.manualQaProcedureTitle")}</strong>
              <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{t("run.manualQaLocalProcedure")}</p>
              {localChecks.length > 0 ? <div className="run-manual-qa-checks mt-2 grid gap-1">
                  {localChecks.map(check => <pre className="m-0 w-full overflow-x-auto rounded-md bg-muted px-2 py-1.5 font-mono text-3xs text-foreground" key={check} tabIndex={0}><code>{check}</code></pre>)}
                </div> : null}
            </div>
            <div className="min-w-0 rounded-lg border border-border bg-card p-2.5">
              <strong className="text-2xs">{t("run.manualQaExpectedTitle")}</strong>
              <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{t("run.manualQaExpected")}</p>
            </div>
          </div>
        </> : null}
      <div className="run-manual-qa-next-action border-t border-primary/20 pt-2.5">
        <strong className="text-2xs">{t("run.manualQaNextActionTitle")}</strong>
        <p className="mt-1 text-2xs leading-relaxed text-foreground">
          {t(run.status === "paused" ? "run.manualQaPausedNextAction" : "run.manualQaCompletedNextAction")}
        </p>
      </div>
    </section>;
}
