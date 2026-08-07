import { CircleAlert, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChannelMessageAttachment } from "../lib/channels-contract";
import { loadChannelMessageAttachment } from "../lib/api";
import { issueAttachmentMarkdown } from "../lib/issue-markdown";

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
  const [source, setSource] = useState("");
  useEffect(() => {
    const objectUrl = URL.createObjectURL(image.file);
    setSource(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [image.file]);
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
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setSource(null);
    setFailed(false);
    void loadChannelMessageAttachment(token, attachment)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.url, token]);

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
  const image = <img alt={attachment.filename} loading="lazy" src={source} />;
  return interactive ? (
    <a href={source} target="_blank" rel="noreferrer">
      {image}
    </a>
  ) : (
    <span className="channel-message-image-static">{image}</span>
  );
}
