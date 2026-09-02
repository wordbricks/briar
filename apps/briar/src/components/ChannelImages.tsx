import { CircleAlert, ExternalLink, FileText, X } from "lucide-react";
import { Spinner } from "./ui/spinner";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useObjectUrl } from "../hooks/useObjectUrl";
import type { ChannelMessageAttachment } from "../lib/channels-contract";
import { loadChannelMessageAttachment } from "../lib/api";
import { formatAttachmentBytes } from "../lib/issue-attachments";
import {
  channelPdfContentType,
  isChannelPdfAttachment,
} from "../lib/channel-attachments";
import { isHtmlArtifactAttachment } from "../lib/agent-reply-attachments";
import { issueAttachmentMarkdown } from "../lib/issue-markdown";
import { useI18n } from "../i18n";
import { HtmlArtifactPreview } from "./HtmlArtifactPreview";
import { ImageLightbox } from "./ImageLightbox";

export type DraftChannelImage = { file: File; reference: string };

type ChannelMessageImageCacheEntry = {
  promise: Promise<string> | null;
  source: string | null;
};

export type ChannelMessageImageCache = {
  disposed: boolean;
  entries: Map<string, ChannelMessageImageCacheEntry>;
};

const ChannelMessageImageCacheContext =
  createContext<ChannelMessageImageCache | null>(null);

export function useChannelMessageImageCache(identity: string) {
  const cache = useMemo<ChannelMessageImageCache>(() => ({
    disposed: false,
    entries: new Map(),
  }), [identity]);

  useEffect(() => () => {
    cache.disposed = true;
    for (const entry of cache.entries.values()) {
      if (entry.source) URL.revokeObjectURL(entry.source);
    }
    cache.entries.clear();
  }, [cache]);

  return cache;
}

export function ChannelMessageImageCacheProvider({
  cache,
  children,
}: {
  cache: ChannelMessageImageCache;
  children: ReactNode;
}) {
  return (
    <ChannelMessageImageCacheContext.Provider value={cache}>
      {children}
    </ChannelMessageImageCacheContext.Provider>
  );
}

function loadCachedChannelMessageImage(
  cache: ChannelMessageImageCache,
  key: string,
  loader: () => Blob | Promise<Blob>,
) {
  const cached = cache.entries.get(key);
  if (cached?.source) return Promise.resolve(cached.source);
  if (cached?.promise) return cached.promise;

  const entry: ChannelMessageImageCacheEntry = {
    promise: null,
    source: null,
  };
  const promise = Promise.resolve().then(loader).then((blob) => {
    if (cache.disposed) throw new Error("Image cache disposed");
    const source = URL.createObjectURL(blob);
    if (cache.disposed) {
      URL.revokeObjectURL(source);
      throw new Error("Image cache disposed");
    }
    entry.promise = null;
    entry.source = source;
    return source;
  }).catch((cause) => {
    if (cache.entries.get(key) === entry) cache.entries.delete(key);
    throw cause;
  });
  entry.promise = promise;
  cache.entries.set(key, entry);
  return promise;
}

function useChannelMessageImageSource(
  cache: ChannelMessageImageCache | null,
  key: string,
  loader: (() => Blob | Promise<Blob>) | null,
) {
  const cachedSource = cache?.entries.get(key)?.source ?? null;
  const [state, setState] = useState({
    failed: false,
    key,
    source: cachedSource,
  });
  const current = state.key === key
    ? state
    : { failed: false, key, source: cachedSource };

  useEffect(() => {
    let active = true;
    let localSource: string | null = null;
    const setSource = (source: string) => {
      if (active) setState({ failed: false, key, source });
    };
    const fail = () => {
      if (active) setState({ failed: true, key, source: null });
    };

    const existing = cache?.entries.get(key)?.source ?? null;
    if (existing) {
      setSource(existing);
      return () => {
        active = false;
      };
    }
    setState({ failed: false, key, source: null });
    if (!loader) {
      return () => {
        active = false;
      };
    }

    if (cache) {
      void loadCachedChannelMessageImage(cache, key, loader).then(setSource, fail);
    } else {
      try {
        const blob = loader();
        void Promise.resolve(blob).then((loaded) => {
          if (!active) return;
          try {
            localSource = URL.createObjectURL(loaded);
            setSource(localSource);
          } catch {
            fail();
          }
        }, fail);
      } catch {
        fail();
      }
    }

    return () => {
      active = false;
      if (localSource) URL.revokeObjectURL(localSource);
    };
  }, [cache, key, loader]);

  return { failed: current.failed, source: current.source };
}

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
  const isPdf = isChannelPdfAttachment(image.file.type, image.file.name);
  const loadImage = useCallback(() => image.file, [image.file]);
  const { source } = useObjectUrl(isPdf ? null : loadImage);
  return (
    <figure className={`channel-image-draft${isPdf ? " is-pdf" : ""}`}>
      <span className="channel-image-draft-preview">
        {isPdf
          ? <FileText aria-hidden="true" size={22} />
          : source
          ? <img alt="" src={source} />
          : null}
      </span>
      <figcaption>
        <strong title={image.file.name}>{image.file.name}</strong>
        <small>{formatAttachmentBytes(image.file.size)}</small>
      </figcaption>
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
  if (isHtmlArtifactAttachment(attachment.contentType, attachment.filename)) {
    return (
      <ChannelMessageHtmlArtifact
        attachment={attachment}
        interactive={interactive}
        token={token}
      />
    );
  }
  if (isChannelPdfAttachment(attachment.contentType, attachment.filename)) {
    return (
      <ChannelMessagePdfAttachment
        attachment={attachment}
        interactive={interactive}
        token={token}
      />
    );
  }
  return (
    <ChannelMessageMediaAttachment
      attachment={attachment}
      interactive={interactive}
      token={token}
    />
  );
}

function ChannelMessagePdfAttachment({
  attachment,
  interactive,
  token,
}: {
  attachment: ChannelMessageAttachment;
  interactive: boolean;
  token: string;
}) {
  const { t } = useI18n();
  const loadAttachment = useCallback(async () => {
    const blob = await loadChannelMessageAttachment(token, attachment);
    if (blob.type !== channelPdfContentType) {
      throw new Error("PDF attachment content type changed during download");
    }
    return blob;
  }, [attachment.url, token]);
  const { failed, source } = useObjectUrl(interactive ? loadAttachment : null);

  return (
    <article className="channel-message-file-card">
      <span className="channel-message-file-icon">
        <FileText aria-hidden="true" size={24} />
      </span>
      <span className="channel-message-file-copy">
        <strong title={attachment.filename}>{attachment.filename}</strong>
        <small>{formatAttachmentBytes(attachment.byteSize)} · PDF</small>
      </span>
      {interactive
        ? failed
          ? <CircleAlert aria-label={t("run.loadFailed")} size={18} />
          : source
          ? (
              <a
                aria-label={`${t("common.open")} ${attachment.filename}`}
                href={source}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink aria-hidden="true" size={16} />
                <span>{t("common.open")}</span>
              </a>
            )
          : <Spinner aria-label={t("loading.churning")} size={18} />
        : <span className="channel-message-file-kind">PDF</span>}
    </article>
  );
}

function ChannelMessageHtmlArtifact({
  attachment,
  interactive,
  token,
}: {
  attachment: ChannelMessageAttachment;
  interactive: boolean;
  token: string;
}) {
  const loadAttachment = useCallback(
    () => loadChannelMessageAttachment(token, attachment),
    [attachment.url, token],
  );
  if (!interactive) {
    return (
      <span className="html-artifact-card channel-html-artifact is-static">
        <span className="html-artifact-card-copy">
          <strong title={attachment.filename}>{attachment.filename}</strong>
          <small>{formatAttachmentBytes(attachment.byteSize)}</small>
        </span>
        <span className="html-artifact-card-action">HTML</span>
      </span>
    );
  }
  return (
    <HtmlArtifactPreview
      byteSize={attachment.byteSize}
      className="channel-html-artifact"
      filename={attachment.filename}
      loadAttachment={loadAttachment}
    />
  );
}

function ChannelMessageMediaAttachment({
  attachment,
  interactive,
  token,
}: {
  attachment: ChannelMessageAttachment;
  interactive: boolean;
  token: string;
}) {
  const imageCache = useContext(ChannelMessageImageCacheContext);
  const localSource = attachment.url.startsWith("blob:")
    ? attachment.url
    : null;
  const loadImage = useMemo(
    () => localSource
      ? null
      : () => loadChannelMessageAttachment(token, attachment),
    [attachment.url, localSource, token],
  );
  const { failed, source: loadedSource } = useChannelMessageImageSource(
    imageCache,
    `${attachment.id}:${attachment.url}`,
    loadImage,
  );
  const source = localSource ?? loadedSource;

  let preview;
  if (failed) {
    preview = (
      <span className="channel-message-image-state" title={attachment.filename}>
        <CircleAlert aria-hidden="true" size={18} />
      </span>
    );
  } else if (!source) {
    preview = (
      <span className="channel-message-image-state" title={attachment.filename}>
        <Spinner aria-hidden="true" size={18} />
      </span>
    );
  } else {
    preview = interactive ? (
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

  return (
    <figure className="channel-message-attachment-card">
      <div className="channel-message-image-preview">{preview}</div>
      <figcaption>
        <strong title={attachment.filename}>{attachment.filename}</strong>
        <small>{formatAttachmentBytes(attachment.byteSize)}</small>
      </figcaption>
    </figure>
  );
}
