import { CircleAlert, FileCode2, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n";
import {
  formatAttachmentBytes,
} from "@/lib/issue-attachments";
import { sandboxHtmlArtifactDocument } from "@/lib/agent-reply-attachments";
import { cn } from "@/lib/utils";

function readBlobText(blob: Blob) {
  if (typeof blob.text === "function") return blob.text();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read HTML"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(blob);
  });
}

export function HtmlArtifactPreview({
  byteSize,
  className,
  filename,
  loadAttachment,
}: {
  byteSize: number;
  className?: string;
  filename: string;
  loadAttachment: () => Blob | Promise<Blob>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [document, setDocument] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const blob = await loadAttachment();
      setDocument(sandboxHtmlArtifactDocument(await readBlobText(blob)));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [loadAttachment]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen && !document && !loading) void load();
  };

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-label={t("htmlArtifact.open", { name: filename })}
        className={cn("html-artifact-card", className)}
        onClick={() => handleOpenChange(true)}
        type="button"
      >
        <span className="html-artifact-card-icon">
          <FileCode2 aria-hidden="true" size={24} />
          <span>HTML</span>
        </span>
        <span className="html-artifact-card-copy">
          <strong title={filename}>{filename}</strong>
          <small>{formatAttachmentBytes(byteSize)}</small>
        </span>
        <span className="html-artifact-card-action">
          {t("htmlArtifact.preview")}
        </span>
      </button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="html-artifact-dialog"
          closeLabel={t("common.close")}
        >
          <DialogHeader className="html-artifact-dialog-header">
            <DialogTitle>{filename}</DialogTitle>
            <DialogDescription>
              {t("htmlArtifact.sandboxDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="html-artifact-dialog-body">
            {loading ? (
              <div className="html-artifact-state" role="status">
                <Spinner aria-hidden="true" size={20} />
                {t("htmlArtifact.loading")}
              </div>
            ) : failed ? (
              <div className="html-artifact-state is-error" role="alert">
                <CircleAlert aria-hidden="true" size={20} />
                <p>{t("htmlArtifact.loadFailed")}</p>
                <button onClick={() => void load()} type="button">
                  <RefreshCw aria-hidden="true" size={15} />
                  {t("htmlArtifact.retry")}
                </button>
              </div>
            ) : document ? (
              <iframe
                referrerPolicy="no-referrer"
                sandbox="allow-scripts"
                srcDoc={document}
                title={t("htmlArtifact.frameTitle", { name: filename })}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
