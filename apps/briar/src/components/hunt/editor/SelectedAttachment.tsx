import { CircleAlert, Trash2, Video } from "lucide-react";
import { useMemo } from "react";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { formatAttachmentBytes, isIssueAttachmentImage } from "@/lib/issue-attachments";
import type { IssueAttachment } from "@/types";
import { useI18n } from "@/i18n";
import { SelectedAttachmentSource } from "./model";
export function SelectedAttachment({
  onLoadAttachment,
  onRemove,
  source
}: {
  onLoadAttachment?: (attachment: IssueAttachment) => Promise<Blob>;
  onRemove: () => void;
  source: SelectedAttachmentSource;
}) {
  const {
    t
  } = useI18n();
  const previewSource = source.type === "new" ? source.file : source.attachment.url;
  const loadPreview = useMemo(() => {
    if (source.type === "new") {
      return () => source.file;
    }
    return onLoadAttachment ? () => onLoadAttachment(source.attachment) : null;
  }, [onLoadAttachment, previewSource]);
  const {
    failed,
    source: previewUrl
  } = useObjectUrl(loadPreview);
  const name = source.type === "new" ? source.file.name : source.attachment.filename;
  const bytes = source.type === "new" ? source.file.size : source.attachment.byteSize;
  const isImage = source.type === "new" ? source.file.type.startsWith("image/") : isIssueAttachmentImage(source.attachment.contentType, name);
  return <figure className="issue-attachment-item">
      <div className="issue-attachment-preview">
        {previewUrl && isImage ? <img alt={name} src={previewUrl} /> : previewUrl ? <video controls muted playsInline preload="metadata" src={previewUrl} /> : failed ? <CircleAlert size={22} /> : <Video size={22} />}
      </div>
      <figcaption>
        <span>
          <strong>{name}</strong>
          <small>{failed ? t("run.loadFailed") : formatAttachmentBytes(bytes)}</small>
        </span>
        <button aria-label={t("issue.remove", {
        name
      })} onClick={onRemove} type="button">
          <Trash2 size={14} />
        </button>
      </figcaption>
    </figure>;
}
