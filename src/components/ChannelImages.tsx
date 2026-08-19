import { CircleAlert, LoaderCircle, X } from "lucide-react";
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
import { issueAttachmentMarkdown } from "../lib/issue-markdown";
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
