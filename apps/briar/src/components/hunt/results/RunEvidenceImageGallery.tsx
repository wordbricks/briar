import { Image as ImageIcon } from "lucide-react";
import type { RunEvidenceImage } from "@/types";
import { useI18n } from "@/i18n";
import { RunEvidenceImagePreview } from "./RunEvidenceImagePreview";
export function RunEvidenceImageGallery({
  images,
  onLoadImage
}: {
  images: RunEvidenceImage[];
  onLoadImage: (image: RunEvidenceImage) => Promise<Blob>;
}) {
  const {
    t
  } = useI18n();
  return <section aria-label={t("run.resultScreenshots")} className="run-evidence-images mt-2.5 grid gap-1.5">
      <strong className="flex items-center gap-1.5 text-2xs font-semibold text-foreground">
        <ImageIcon aria-hidden="true" size={14} />
        {t("run.resultScreenshots")}
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">{images.length}</span>
      </strong>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2">
        {images.map(image => <RunEvidenceImagePreview image={image} key={image.id} onLoadImage={onLoadImage} />)}
      </div>
    </section>;
}
