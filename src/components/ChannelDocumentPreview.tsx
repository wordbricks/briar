import { FileText, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "../i18n";
import { loadChannelMessageDocument } from "../lib/api";
import type {
  ChannelMessageDocument,
  ChannelMessageDocumentContent,
} from "../lib/channels-contract";
import { MarkdownContent } from "./MarkdownContent";

export function ChannelDocumentPreview({
  channelId,
  document,
  organizationId,
  token,
}: {
  channelId: string;
  document: ChannelMessageDocument;
  organizationId: string;
  token: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<ChannelMessageDocumentContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const response = await loadChannelMessageDocument(
        token,
        organizationId,
        channelId,
        document.messageId,
      );
      if (requestGeneration.current === generation) {
        setContent(response.document);
      }
    } catch (cause) {
      if (requestGeneration.current === generation) {
        setError(cause instanceof Error ? cause.message : t("channel.documentLoadFailed"));
      }
    } finally {
      if (requestGeneration.current === generation) setLoading(false);
    }
  }, [channelId, document.messageId, organizationId, t, token]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen && !content && !loading) void load();
  };

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-label={t("channel.openDocument", { title: document.title })}
        className="channel-document-card"
        onClick={() => handleOpenChange(true)}
        type="button"
      >
        <FileText aria-hidden="true" size={15} />
        <span className="channel-document-card-copy">
          <strong>{document.title}</strong>
          <span>
            {t("channel.planDocument")}
            {document.projectId ? "" : ` · ${t("channel.orgDocument")}`}
          </span>
        </span>
      </button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="channel-document-dialog">
          <DialogHeader className="channel-document-dialog-header">
            <DialogTitle>{content?.title ?? document.title}</DialogTitle>
            <DialogDescription>
              {document.projectId
                ? t("channel.planDocument")
                : `${t("channel.planDocument")} · ${t("channel.orgDocument")}`}
            </DialogDescription>
          </DialogHeader>
          <div className="channel-document-dialog-body">
            {loading ? (
              <div className="channel-document-state" role="status">
                <LoaderCircle aria-hidden="true" className="animate-spin" size={20} />
                {t("channel.documentLoading")}
              </div>
            ) : error ? (
              <div className="channel-document-state is-error" role="alert">
                <p>{t("channel.documentLoadFailed")}</p>
                <button onClick={() => void load()} type="button">
                  <RefreshCw aria-hidden="true" size={15} />
                  {t("channel.documentRetry")}
                </button>
              </div>
            ) : content ? (
              <MarkdownContent className="issue-description-markdown channel-document-markdown">
                {content.markdown}
              </MarkdownContent>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
