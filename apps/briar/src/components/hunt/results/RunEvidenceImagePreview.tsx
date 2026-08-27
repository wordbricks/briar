import { CircleAlert } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useCallback } from "react";
import { ImageLightbox } from "@/components/ImageLightbox";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import type { RunEvidenceImage } from "@/types";
import { useI18n } from "@/i18n";
export function RunEvidenceImagePreview({
  image,
  onLoadImage
}: {
  image: RunEvidenceImage;
  onLoadImage: (image: RunEvidenceImage) => Promise<Blob>;
}) {
  const {
    t
  } = useI18n();
  const loadImage = useCallback(() => onLoadImage(image), [image, onLoadImage]);
  const {
    failed,
    source
  } = useObjectUrl(loadImage);
  return <figure className="run-evidence-image">
      {source ? <ImageLightbox alt={image.filename} className="run-evidence-image-trigger" filename={image.filename} loading="eager" source={source} /> : <button aria-label={t("run.enlargeScreenshot", {
      name: image.filename
    })} className="run-evidence-image-trigger" disabled type="button">
          {!failed ? <Spinner size={20} /> : null}
          {failed ? <CircleAlert size={20} /> : null}
        </button>}
      <figcaption>
        <span>{image.filename}</span>
        {failed ? <small>{t("run.loadFailed")}</small> : null}
      </figcaption>
    </figure>;
}
