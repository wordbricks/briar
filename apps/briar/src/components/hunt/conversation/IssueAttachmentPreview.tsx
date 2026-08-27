import { CircleAlert, Image as ImageIcon, Video } from "lucide-react";
import { useCallback } from "react";
import { ImageLightbox } from "@/components/ImageLightbox";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { formatAttachmentBytes, isIssueAttachmentImage } from "@/lib/issue-attachments";
import type { IssueAttachment } from "@/types";
import { useI18n } from "@/i18n";
export function IssueAttachmentPreview({
  attachment,
  onLoadAttachment
}: {
  attachment: IssueAttachment;
  onLoadAttachment: (attachment: IssueAttachment) => Promise<Blob>;
}) {
  const {
    t
  } = useI18n();
  const loadAttachment = useCallback(() => onLoadAttachment(attachment), [attachment.url, onLoadAttachment]);
  const {
    failed,
    source
  } = useObjectUrl(loadAttachment);
  const isImage = isIssueAttachmentImage(attachment.contentType, attachment.filename);
  return <article className="run-attachment">
      <div className="run-attachment-media">
        {source && isImage && <ImageLightbox alt={attachment.filename} filename={attachment.filename} loading="eager" source={source} />}
        {source && !isImage && <video controls preload="metadata" src={source} />}
        {!source && !failed && (isImage ? <ImageIcon size={22} /> : <Video size={22} />)}
        {failed && <CircleAlert size={20} />}
      </div>
      <span><strong>{attachment.filename}</strong><small>{failed ? t("run.loadFailed") : formatAttachmentBytes(attachment.byteSize)}</small></span>
      {source && <a download={attachment.filename} href={source}>{t("common.open")}</a>}
    </article>;
}
