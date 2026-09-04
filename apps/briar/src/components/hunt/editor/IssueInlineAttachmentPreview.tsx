import { CircleAlert, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useMemo } from "react";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import type { IssueAttachment } from "@/types";
import { IssueDraftInlineAttachment, draftInlineAttachmentFile } from "./model";
export function IssueInlineAttachmentPreview({
  attachment,
  onLoadAttachment,
  onRemove,
  removeLabel
}: {
  attachment: IssueDraftInlineAttachment;
  onLoadAttachment?: (attachment: IssueAttachment) => Promise<Blob>;
  onRemove: () => void;
  removeLabel: string;
}) {
  const file = draftInlineAttachmentFile(attachment);
  const previewSource = attachment.type === "new" ? attachment.file : attachment.attachment.url;
  const loadPreview = useMemo(() => {
    if (attachment.type === "new") {
      return () => attachment.file;
    }
    return onLoadAttachment ? () => onLoadAttachment(attachment.attachment) : null;
  }, [onLoadAttachment, previewSource]);
  const {
    failed,
    source: previewUrl
  } = useObjectUrl(loadPreview);
  const alt = attachment.type === "new" ? attachment.file.name : attachment.attachment.filename;
  return <figure className="issue-inline-attachment">
      {previewUrl && <img alt={alt} src={previewUrl} />}
      {!previewUrl && failed && <span className="issue-inline-attachment-state">
          <CircleAlert aria-hidden="true" size={14} />
          {alt}
        </span>}
      {!previewUrl && !failed && file && <Spinner aria-hidden="true" className="size-[14px]" />}
      <button aria-label={removeLabel} onClick={onRemove} type="button">
        <Trash2 size={14} />
      </button>
    </figure>;
}
