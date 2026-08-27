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
  return <figure className="issue-attachment-item grid min-h-[132px] w-[min(320px,60vw)] min-w-[220px] shrink-0 grid-rows-[96px_36px] overflow-hidden rounded-lg border border-border bg-card">
      <div className="issue-attachment-preview grid h-24 w-full place-items-center overflow-hidden border-b border-border bg-muted text-accent-foreground [&>img]:block [&>img]:size-full [&>img]:object-contain [&>video]:block [&>video]:size-full [&>video]:object-contain">
        {previewUrl && isImage ? <img alt={name} src={previewUrl} /> : previewUrl ? <video controls muted playsInline preload="metadata" src={previewUrl} /> : failed ? <CircleAlert size={22} /> : <Video size={22} />}
      </div>
      <figcaption className="grid min-w-0 grid-cols-[minmax(0,1fr)_30px] items-center gap-1.5 px-2 py-1">
        <span className="grid min-w-0 gap-px">
          <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-2xs">{name}</strong>
          <small className="font-mono text-2xs text-muted-foreground">{failed ? t("run.loadFailed") : formatAttachmentBytes(bytes)}</small>
        </span>
        <button aria-label={t("issue.remove", {
        name
        })} className="grid size-[30px] place-items-center rounded-lg border-0 bg-transparent text-destructive outline-none hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring" onClick={onRemove} type="button">
          <Trash2 size={14} />
        </button>
      </figcaption>
    </figure>;
}
