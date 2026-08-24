import type { HuntRun, RunEvidence, RunEvidenceImage } from "@/types";
import { useI18n } from "@/i18n";
import { RunManualQaGuide } from "./RunManualQaGuide";
import { RunResultScreenshotsContent } from "./RunResultScreenshotsContent";
import { useRunEvidenceLoader } from "./useRunEvidenceLoader";
export function RunResultArtifacts({
  onLoad,
  onLoadImage,
  run
}: {
  onLoad: () => Promise<RunEvidence[]>;
  onLoadImage?: (image: RunEvidenceImage) => Promise<Blob>;
  run: HuntRun;
}) {
  const {
    t
  } = useI18n();
  const {
    evidence,
    loading,
    loadError,
    reload
  } = useRunEvidenceLoader(run.id, onLoad, true, t("run.evidenceLoadFailed"));
  return <>
      <RunManualQaGuide evidence={evidence} loadError={loadError} loading={loading} onRetry={reload} run={run} />
      <RunResultScreenshotsContent evidence={evidence} loadError={loadError} loading={loading} onLoadImage={onLoadImage} onRetry={reload} />
    </>;
}
