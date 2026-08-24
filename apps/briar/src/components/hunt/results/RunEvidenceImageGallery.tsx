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
  return <section aria-label={t("run.resultScreenshots")} className="run-evidence-images">
      <strong>
        <ImageIcon aria-hidden="true" size={14} />
        {t("run.resultScreenshots")}
        <span>{images.length}</span>
      </strong>
      <div>
        {images.map(image => <RunEvidenceImagePreview image={image} key={image.id} onLoadImage={onLoadImage} />)}
      </div>
    </section>;
}
