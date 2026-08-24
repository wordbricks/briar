import type { RunEvidence, RunEvidenceImage } from "@/types";
import { useI18n } from "@/i18n";
import { RunResultScreenshotsContent } from "./RunResultScreenshotsContent";
import { useRunEvidenceLoader } from "./useRunEvidenceLoader";
export function RunResultScreenshots({
  onLoad,
  onLoadImage,
  runId
}: {
  onLoad: () => Promise<RunEvidence[]>;
  onLoadImage?: (image: RunEvidenceImage) => Promise<Blob>;
  runId: string;
}) {
  const {
    t
  } = useI18n();
  const {
    evidence,
    loading,
    loadError,
    reload: loadScreenshots
  } = useRunEvidenceLoader(runId, onLoad, Boolean(onLoadImage), t("run.evidenceLoadFailed"));
  return <RunResultScreenshotsContent evidence={evidence} loadError={loadError} loading={loading} onLoadImage={onLoadImage} onRetry={loadScreenshots} />;
}
