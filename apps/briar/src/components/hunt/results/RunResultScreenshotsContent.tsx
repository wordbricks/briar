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
  return <section aria-label={t("run.resultScreenshots")} className="run-result-screenshots mt-3 rounded-xl border border-border bg-card p-3.5 [&_.run-evidence-images]:mt-0">
      {loading ? <div className="run-evidence-state flex min-h-[120px] items-center justify-center gap-2 text-2xs text-muted-foreground">
          <LoadingState label={t("run.evidenceLoading")} />
        </div> : loadError ? <button className="run-evidence-state error flex min-h-[120px] w-full items-center justify-center gap-2 rounded-lg border-0 bg-destructive/10 text-foreground" onClick={() => void onRetry()} type="button">
          <CircleAlert size={15} />
          <span>{loadError}</span>
          <RefreshCw size={13} />
        </button> : <RunEvidenceImageGallery images={images} onLoadImage={onLoadImage} />}
    </section>;
}
