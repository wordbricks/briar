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
  return <figure className="issue-inline-attachment group relative my-2 min-h-10 max-w-full overflow-hidden rounded-lg border border-border bg-muted [&>img]:block [&>img]:max-h-[min(520px,62vh)] [&>img]:max-w-full [&>img]:object-contain">
      {previewUrl && <img alt={alt} src={previewUrl} />}
      {!previewUrl && failed && <span className="issue-inline-attachment-state flex min-h-10 items-center gap-1.5 px-2.5 text-2xs text-muted-foreground">
          <CircleAlert aria-hidden="true" size={14} />
          {alt}
        </span>}
      {!previewUrl && !failed && file && <Spinner aria-hidden="true" size={14} />}
      <button aria-label={removeLabel} className="absolute right-1.5 top-1.5 grid size-[30px] place-items-center rounded-lg border border-destructive/25 bg-card/90 text-destructive opacity-0 shadow-sm outline-none transition-opacity hover:bg-card focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 [@media(hover:none)]:opacity-100" onClick={onRemove} type="button">
        <Trash2 size={14} />
      </button>
    </figure>;
}
