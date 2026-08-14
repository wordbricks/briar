import { CircleAlert, LoaderCircle, X } from "lucide-react";
import { useCallback } from "react";
import { useObjectUrl } from "../hooks/useObjectUrl";
import type { ChannelMessageAttachment } from "../lib/channels-contract";
import { loadChannelMessageAttachment } from "../lib/api";
import { issueAttachmentMarkdown } from "../lib/issue-markdown";
import { ImageLightbox } from "./ImageLightbox";

export type DraftChannelImage = { file: File; reference: string };

export function draftChannelImage(file: File): DraftChannelImage {
  return {
    file,
    reference:
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
}

export function channelBodyWithImages(
  body: string,
  images: readonly DraftChannelImage[],
) {
  return [
    body.trim(),
    ...images.map(({ file, reference }) =>
      issueAttachmentMarkdown(reference, file.name)
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function channelBodyWithoutImages(body: string) {
  return body
    .replace(/!\[[^\]]*\]\(briar-attachment:\/\/[0-9a-z-]+\)/giu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function ChannelDraftImages({
  images,
  onRemove,
}: {
  images: readonly DraftChannelImage[];
  onRemove: (reference: string) => void;
}) {
  if (images.length === 0) return null;
  return (
    <div className="channel-image-drafts">
      {images.map((image) => (
        <ChannelDraftImage
          image={image}
          key={image.reference}
          onRemove={() => onRemove(image.reference)}
        />
      ))}
    </div>
  );
}

function ChannelDraftImage({
  image,
  onRemove,
}: {
  image: DraftChannelImage;
  onRemove: () => void;
}) {
  const loadImage = useCallback(() => image.file, [image.file]);
  const { source } = useObjectUrl(loadImage);
  return (
    <figure className="channel-image-draft">
      {source ? <img alt={image.file.name} src={source} /> : null}
      <button aria-label={`Remove ${image.file.name}`} onClick={onRemove} type="button">
        <X aria-hidden="true" size={13} />
      </button>
    </figure>
  );
}

export function ChannelMessageImages({
  attachments,
  interactive = true,
  token,
}: {
  attachments: readonly ChannelMessageAttachment[];
  interactive?: boolean;
  token: string;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className={`channel-message-images count-${Math.min(attachments.length, 4)}`}>
      {attachments.map((attachment) => (
        <ChannelMessageImage
          attachment={attachment}
          interactive={interactive}
          key={attachment.id}
          token={token}
        />
      ))}
    </div>
  );
}

function ChannelMessageImage({
  attachment,
  interactive,
  token,
}: {
  attachment: ChannelMessageAttachment;
  interactive: boolean;
  token: string;
}) {
  const loadImage = useCallback(
    () => loadChannelMessageAttachment(token, attachment),
    [attachment.url, token],
  );
  const { failed, source } = useObjectUrl(loadImage);

  if (failed) {
    return (
      <span className="channel-message-image-state" title={attachment.filename}>
        <CircleAlert aria-hidden="true" size={18} />
      </span>
    );
  }
  if (!source) {
    return (
      <span className="channel-message-image-state" title={attachment.filename}>
        <LoaderCircle aria-hidden="true" className="spin" size={18} />
      </span>
    );
  }
  return interactive ? (
    <ImageLightbox
      alt={attachment.filename}
      className="channel-message-image-trigger"
      filename={attachment.filename}
      source={source}
    />
  ) : (
    <span className="channel-message-image-static">
      <img alt={attachment.filename} loading="lazy" src={source} />
    </span>
  );
}
