import { CircleAlert, FileCode2, RefreshCw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
import { briarApiUrl } from "@/lib/api-config";
import {
  htmlArtifactPreviewMaxBytes,
  htmlArtifactPreviewMessageType,
  htmlArtifactPreviewPath,
  htmlArtifactPreviewProtocolVersion,
  isHtmlArtifactPreviewMessage,
} from "@/lib/html-artifact-preview-contract";
import { cn } from "@/lib/utils";

const shellReadyTimeoutMs = 5_000;
const htmlArtifactPreviewUrl = `${briarApiUrl}${htmlArtifactPreviewPath}`;

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
  const [artifactDocument, setArtifactDocument] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const attachmentLoadId = useRef(0);
  const attachmentLoading = useRef(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const shellReady = useRef(false);
  const payloadSent = useRef(false);

  const startAttempt = useCallback(() => {
    shellReady.current = false;
    payloadSent.current = false;
    setStatus("loading");
    setAttempt((value) => value + 1);
  }, []);

  const load = useCallback(async () => {
    if (attachmentLoading.current) return;
    attachmentLoading.current = true;
    const loadId = ++attachmentLoadId.current;
    setStatus("loading");
    try {
      const blob = await loadAttachment();
      if (blob.size > htmlArtifactPreviewMaxBytes) {
        throw new Error("HTML artifact payload is too large");
      }
      const nextDocument = await readBlobText(blob);
      if (loadId === attachmentLoadId.current) {
        setArtifactDocument(nextDocument);
      }
    } catch {
      if (loadId === attachmentLoadId.current) setStatus("error");
    } finally {
      if (loadId === attachmentLoadId.current) attachmentLoading.current = false;
    }
  }, [loadAttachment]);

  const sendArtifact = useCallback(() => {
    if (!open || !shellReady.current || payloadSent.current || !artifactDocument) {
      return;
    }
    const target = frame.current?.contentWindow;
    if (!target) return;
    payloadSent.current = true;
    // sandbox without allow-same-origin has an opaque origin, so source identity
    // is verified on receipt and "*" is required as the target origin.
    target.postMessage({
      type: htmlArtifactPreviewMessageType.render,
      version: htmlArtifactPreviewProtocolVersion,
      html: artifactDocument,
    }, "*");
  }, [artifactDocument, open]);

  useEffect(() => {
    sendArtifact();
  }, [attempt, sendArtifact]);

  useLayoutEffect(() => {
    if (!open) return;
    const receiveMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== "null") {
        return;
      }
      if (
        isHtmlArtifactPreviewMessage(
          event.data,
          htmlArtifactPreviewMessageType.ready,
        )
      ) {
        shellReady.current = true;
        sendArtifact();
        return;
      }
      if (
        payloadSent.current &&
        isHtmlArtifactPreviewMessage(
          event.data,
          htmlArtifactPreviewMessageType.rendered,
        )
      ) {
        setStatus("ready");
        return;
      }
      if (
        payloadSent.current &&
        isHtmlArtifactPreviewMessage(
          event.data,
          htmlArtifactPreviewMessageType.error,
        )
      ) {
        setStatus("error");
      }
    };
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, [attempt, open, sendArtifact]);

  useEffect(() => {
    if (!open || status !== "loading") return;
    const timeout = window.setTimeout(() => {
      if (!shellReady.current) setStatus("error");
    }, shellReadyTimeoutMs);
    return () => window.clearTimeout(timeout);
  }, [attempt, open, status]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) return;
    startAttempt();
    if (!artifactDocument) void load();
  };

  const retry = () => {
    startAttempt();
    if (!artifactDocument) void load();
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
            {status !== "idle" ? (
              <iframe
                className={status === "ready" ? undefined : "is-pending"}
                key={attempt}
                onLoad={() => {
                  frame.current?.contentWindow?.postMessage({
                    type: htmlArtifactPreviewMessageType.probe,
                    version: htmlArtifactPreviewProtocolVersion,
                  }, "*");
                }}
                ref={frame}
                referrerPolicy="no-referrer"
                sandbox="allow-scripts"
                src={htmlArtifactPreviewUrl}
                title={t("htmlArtifact.frameTitle", { name: filename })}
              />
            ) : null}
            {status === "loading" ? (
              <div className="html-artifact-state" role="status">
                <Spinner aria-hidden="true" className="size-[20px]" />
                {t("htmlArtifact.loading")}
              </div>
            ) : status === "error" ? (
              <div className="html-artifact-state is-error" role="alert">
                <CircleAlert aria-hidden="true" size={20} />
                <p>{t("htmlArtifact.loadFailed")}</p>
                <button onClick={retry} type="button">
                  <RefreshCw aria-hidden="true" size={15} />
                  {t("htmlArtifact.retry")}
                </button>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
