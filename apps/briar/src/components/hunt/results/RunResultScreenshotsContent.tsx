import { CircleAlert, RefreshCw } from "lucide-react";
import { LoadingState } from "@/components/ui/loading-state";
import { useMemo } from "react";
import type { RunEvidence, RunEvidenceImage } from "@/types";
import { useI18n } from "@/i18n";
import { RunEvidenceImageGallery } from "./RunEvidenceImageGallery";
export function RunResultScreenshotsContent({
  evidence,
  loadError,
  loading,
  onLoadImage,
  onRetry
}: {
  evidence: RunEvidence[];
  loadError: string | null;
  loading: boolean;
  onLoadImage?: (image: RunEvidenceImage) => Promise<Blob>;
  onRetry: () => Promise<void>;
}) {
  const {
    t
  } = useI18n();
  const images = useMemo(() => evidence.filter(item => item.canonical && item.status === "passed").flatMap(item => item.images ?? []), [evidence]);
  if (!onLoadImage) return null;
  if (!loading && !loadError && images.length === 0) return null;
  return <section aria-label={t("run.resultScreenshots")} className="run-result-screenshots">
      {loading ? <div className="run-evidence-state">
          <LoadingState label={t("run.evidenceLoading")} />
        </div> : loadError ? <button className="run-evidence-state error" onClick={() => void onRetry()} type="button">
          <CircleAlert size={15} />
          <span>{loadError}</span>
          <RefreshCw size={13} />
        </button> : <RunEvidenceImageGallery images={images} onLoadImage={onLoadImage} />}
    </section>;
}
