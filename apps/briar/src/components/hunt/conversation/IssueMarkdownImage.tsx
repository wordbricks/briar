import { CircleAlert } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useMemo } from "react";
import { ImageLightbox } from "@/components/ImageLightbox";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { issueAttachmentReference } from "@/lib/issue-markdown";
import type { IssueAttachment } from "@/types";
import { useI18n } from "@/i18n";
export function IssueMarkdownImage({
  alt,
  attachments,
  onLoadAttachment,
  src
}: {
  alt: string;
  attachments: IssueAttachment[];
  onLoadAttachment: (attachment: IssueAttachment) => Promise<Blob>;
  src?: string;
}) {
  const {
    t
  } = useI18n();
  const reference = issueAttachmentReference(src);
  const attachment = reference ? attachments.find(candidate => candidate.id === reference) ?? null : null;
  const localSource = attachment?.url.startsWith("blob:") ? attachment.url : null;
  const loadImage = useMemo(() => {
    if (!reference || !attachment || localSource) return null;
    return () => onLoadAttachment(attachment);
  }, [attachment?.url, localSource, onLoadAttachment, reference]);
  const {
    failed,
    source: loadedSource
  } = useObjectUrl(loadImage);
  const source = localSource ?? loadedSource;
  if (!reference) {
    return src ? <ImageLightbox alt={alt} source={src} /> : null;
  }
  if (!attachment || failed) {
    return <span className="issue-markdown-image-state my-2 flex min-h-10 max-w-full items-center gap-2 rounded-lg border border-border bg-muted px-2.5 text-2xs text-muted-foreground" role="img" aria-label={alt}>
        <CircleAlert aria-hidden="true" size={16} />
        {failed ? t("run.loadFailed") : alt}
      </span>;
  }
  if (!source) {
    return <span className="issue-markdown-image-state my-2 flex min-h-10 max-w-full items-center gap-2 rounded-lg border border-border bg-muted px-2.5 text-2xs text-muted-foreground" role="img" aria-label={alt}>
        <Spinner aria-hidden="true" size={16} />
        {alt}
      </span>;
  }
  return <ImageLightbox alt={alt || attachment.filename} filename={attachment.filename} source={source} />;
}
