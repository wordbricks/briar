import { Download } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n";

export function imageDownloadFilename(source: string, alt?: string) {
  const label = alt?.trim();
  if (label && /\.[a-z0-9]{2,8}$/iu.test(label)) return label;
  try {
    const base = typeof window === "undefined"
      ? "https://briar.invalid"
      : window.location.href;
    const pathname = new URL(source, base).pathname;
    const filename = decodeURIComponent(pathname.split("/").pop() ?? "").trim();
    if (filename) return filename;
  } catch {
    // Blob and data URLs do not always expose a useful path.
  }
  return label || "image";
}

export function ImageLightbox({
  alt,
  className,
  filename,
  loading = "lazy",
  source,
}: {
  alt: string;
  className?: string;
  filename?: string;
  loading?: "eager" | "lazy";
  source: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const downloadFilename = filename?.trim() || imageDownloadFilename(source, alt);

  return (
    <>
      <button
        aria-label={t("image.enlarge", { name: downloadFilename })}
        className={cn("image-lightbox-trigger", className)}
        onClick={() => setOpen(true)}
        type="button"
      >
        <img alt={alt} loading={loading} src={source} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="image-lightbox-dialog"
        >
          <header className="image-lightbox-toolbar">
            <DialogTitle>{downloadFilename}</DialogTitle>
            <a
              aria-label={t("image.download", { name: downloadFilename })}
              className="image-lightbox-download"
              download={downloadFilename}
              href={source}
              title={t("image.download", { name: downloadFilename })}
            >
              <Download aria-hidden="true" size={18} />
            </a>
          </header>
          <div className="image-lightbox-body">
            <img alt={alt} src={source} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
