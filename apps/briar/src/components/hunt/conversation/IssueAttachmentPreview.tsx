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
  return <article className="run-attachment grid min-w-0 grid-cols-[minmax(0,1fr)_auto] grid-rows-[minmax(96px,16vw)_34px] items-center overflow-hidden rounded-lg border border-border bg-muted">
      <div className="run-attachment-media col-span-full grid size-full place-items-center overflow-hidden bg-accent text-accent-foreground [&_.image-lightbox-trigger]:block [&_.image-lightbox-trigger]:size-full [&_.image-lightbox-trigger]:object-contain [&>img]:block [&>img]:size-full [&>img]:object-contain [&>video]:block [&>video]:size-full [&>video]:object-contain">
        {source && isImage && <ImageLightbox alt={attachment.filename} filename={attachment.filename} loading="eager" source={source} />}
        {source && !isImage && <video controls preload="metadata" src={source} />}
        {!source && !failed && (isImage ? <ImageIcon size={22} /> : <Video size={22} />)}
        {failed && <CircleAlert size={20} />}
      </div>
      <span className="grid min-w-0 gap-0.5 px-2.5"><strong className="overflow-hidden text-ellipsis whitespace-nowrap text-2xs text-foreground">{attachment.filename}</strong><small className="font-mono text-2xs text-muted-foreground">{failed ? t("run.loadFailed") : formatAttachmentBytes(attachment.byteSize)}</small></span>
      {source && <a className="mr-2 rounded-md bg-accent px-2 py-1 text-2xs text-accent-foreground no-underline hover:underline" download={attachment.filename} href={source}>{t("common.open")}</a>}
    </article>;
}
