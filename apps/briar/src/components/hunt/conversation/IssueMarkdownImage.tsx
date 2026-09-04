import { CircleAlert } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useMemo } from "react";
import { ImageLightbox } from "@/components/ImageLightbox";
import { HtmlArtifactPreview } from "@/components/HtmlArtifactPreview";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { isHtmlArtifactAttachment } from "@/lib/agent-reply-attachments";
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
  const isHtmlArtifact = attachment ? isHtmlArtifactAttachment(attachment.contentType, attachment.filename) : false;
  const loadHtmlArtifact = useMemo(() => attachment ? () => onLoadAttachment(attachment) : () => Promise.reject(new Error("Attachment not found")), [attachment?.url, onLoadAttachment]);
  const loadImage = useMemo(() => {
    if (!reference || !attachment || localSource || isHtmlArtifact) return null;
    return () => onLoadAttachment(attachment);
  }, [attachment?.url, isHtmlArtifact, localSource, onLoadAttachment, reference]);
  const {
    failed,
    source: loadedSource
  } = useObjectUrl(loadImage);
  const source = localSource ?? loadedSource;
  if (!reference) {
    return src ? <ImageLightbox alt={alt} source={src} /> : null;
  }
  if (!attachment || failed) {
    return <span className="issue-markdown-image-state" role="img" aria-label={alt}>
        <CircleAlert aria-hidden="true" size={16} />
        {failed ? t("run.loadFailed") : alt}
      </span>;
  }
  if (isHtmlArtifact) {
    return <HtmlArtifactPreview byteSize={attachment.byteSize} className="issue-html-artifact" filename={attachment.filename} loadAttachment={loadHtmlArtifact} />;
  }
  if (!source) {
    return <span className="issue-markdown-image-state" role="img" aria-label={alt}>
        <Spinner aria-hidden="true" className="size-[16px]" />
        {alt}
      </span>;
  }
  return <ImageLightbox alt={alt || attachment.filename} filename={attachment.filename} source={source} />;
}
