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
  return <figure className="run-evidence-image min-w-0 overflow-hidden rounded-lg border border-border bg-muted">
      {source ? <ImageLightbox alt={image.filename} className="run-evidence-image-trigger flex min-h-[120px] w-full items-center justify-center bg-black/20" filename={image.filename} loading="eager" source={source} /> : <button aria-label={t("run.enlargeScreenshot", {
      name: image.filename
    })} className="run-evidence-image-trigger flex min-h-[120px] w-full items-center justify-center border-0 bg-black/20 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled type="button">
          {!failed ? <Spinner size={20} /> : null}
          {failed ? <CircleAlert size={20} /> : null}
        </button>}
      <figcaption className="flex min-w-0 items-center justify-between gap-2 bg-card px-2 py-1.5 text-2xs text-muted-foreground">
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{image.filename}</span>
        {failed ? <small className="text-destructive">{t("run.loadFailed")}</small> : null}
      </figcaption>
    </figure>;
}
