import { Globe2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { loadChannelLinkPreview } from "../lib/api";
import { channelMessageLinkPreviewUrl } from "../lib/channel-link-preview";
import type { ChannelLinkPreview as ChannelLinkPreviewData, ChannelMessage } from "../lib/channels-contract";

const cacheTtlMs = 15 * 60 * 1_000;
const failedCacheTtlMs = 2 * 60 * 1_000;
const cacheLimit = 100;

type CacheEntry = {
  expiresAt: number;
  pending?: Promise<ChannelLinkPreviewData | null>;
  preview: ChannelLinkPreviewData | null;
};

const previewCache = new Map<string, CacheEntry>();

function storePreview(
  url: string,
  preview: ChannelLinkPreviewData | null,
  ttl: number,
  pending?: Promise<ChannelLinkPreviewData | null>,
) {
  if (!previewCache.has(url) && previewCache.size >= cacheLimit) {
    const oldest = previewCache.keys().next().value;
    if (typeof oldest === "string") previewCache.delete(oldest);
  }
  previewCache.set(url, { expiresAt: Date.now() + ttl, pending, preview });
}

function readPreviewCache(url: string) {
  const entry = previewCache.get(url);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    previewCache.delete(url);
    return undefined;
  }
  return entry;
}

function loadCachedPreview(
  token: string,
  organizationId: string,
  channelId: string,
  url: string,
) {
  const cached = readPreviewCache(url);
  if (cached?.pending) return cached.pending;
  if (cached) return Promise.resolve(cached.preview);

  const pending = loadChannelLinkPreview(token, organizationId, channelId, url)
    .then(({ preview }) => {
      storePreview(url, preview, cacheTtlMs);
      return preview;
    })
    .catch((error: unknown) => {
      storePreview(url, null, failedCacheTtlMs);
      throw error;
    });
  storePreview(url, null, cacheTtlMs, pending);
  return pending;
}

function safeHttpUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
        !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function previewText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizePreview(
  value: ChannelLinkPreviewData | null,
  requestedUrl: string,
): ChannelLinkPreviewData | null {
  if (!value) return null;
  const url = safeHttpUrl(value.url) ?? safeHttpUrl(requestedUrl);
  if (!url) return null;
  const imageWidth = typeof value.imageWidth === "number" && value.imageWidth > 0
    ? value.imageWidth
    : null;
  const imageHeight = typeof value.imageHeight === "number" && value.imageHeight > 0
    ? value.imageHeight
    : null;
  return {
    url,
    title: previewText(value.title, 240),
    description: previewText(value.description, 1_000),
    imageUrl: safeHttpUrl(value.imageUrl),
    faviconUrl: safeHttpUrl(value.faviconUrl),
    siteName: previewText(value.siteName, 120),
    imageWidth,
    imageHeight,
  };
}

export function ChannelLinkPreview({
  channelId,
  message,
  organizationId,
  token,
}: {
  channelId: string;
  message: Pick<ChannelMessage, "body" | "blocks" | "deletedAt" | "optimistic">;
  organizationId: string;
  token: string;
}) {
  const { t } = useI18n();
  const targetUrl = useMemo(() => {
    if (message.deletedAt || message.optimistic) return null;
    return channelMessageLinkPreviewUrl(message);
  }, [message.blocks, message.body, message.deletedAt, message.optimistic]);
  const [state, setState] = useState<{
    loading: boolean;
    preview: ChannelLinkPreviewData | null;
    url: string | null;
  }>({ loading: false, preview: null, url: null });
  const [faviconFailed, setFaviconFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFaviconFailed(false);
    setImageFailed(false);
    if (!targetUrl) {
      setState({ loading: false, preview: null, url: null });
      return () => {
        active = false;
      };
    }

    const cached = readPreviewCache(targetUrl);
    if (cached && !cached.pending) {
      setState({
        loading: false,
        preview: normalizePreview(cached.preview, targetUrl),
        url: targetUrl,
      });
      return () => {
        active = false;
      };
    }

    setState({ loading: true, preview: null, url: targetUrl });
    void loadCachedPreview(token, organizationId, channelId, targetUrl)
      .then((preview) => {
        if (!active) return;
        setState({
          loading: false,
          preview: normalizePreview(preview, targetUrl),
          url: targetUrl,
        });
      })
      .catch(() => {
        if (active) setState({ loading: false, preview: null, url: targetUrl });
      });
    return () => {
      active = false;
    };
  }, [channelId, organizationId, targetUrl, token]);

  if (!targetUrl || state.url !== targetUrl) return null;
  if (state.loading) {
    return (
      <div
        aria-label={t("channel.linkPreviewLoading")}
        className="channel-link-preview-loading"
        role="status"
      >
        <span />
        <span />
        <span />
      </div>
    );
  }
  const preview = state.preview;
  if (!preview) return null;

  let hostname = preview.url;
  try {
    hostname = new URL(preview.url).hostname.replace(/^www\./iu, "");
  } catch {
    // normalizePreview already validates the URL; keep the URL as a final fallback.
  }
  const siteName = preview.siteName ?? hostname;
  const title = preview.title ?? siteName;
  const imageUrl = imageFailed ? null : preview.imageUrl;
  const faviconUrl = faviconFailed ? null : preview.faviconUrl;

  return (
    <a
      aria-label={t("channel.linkPreviewOpen", { title })}
      className="channel-link-preview"
      href={preview.url}
      rel="noreferrer noopener"
      target="_blank"
    >
      <span className="channel-link-preview-meta">
        <span aria-hidden="true" className="channel-link-preview-favicon">
          {faviconUrl ? (
            <img
              alt=""
              onError={() => setFaviconFailed(true)}
              src={faviconUrl}
            />
          ) : (
            <Globe2 size={15} />
          )}
        </span>
        <span className="channel-link-preview-site" title={siteName}>
          {siteName}
        </span>
      </span>
      <span className="channel-link-preview-copy">
        <strong>{title}</strong>
        {preview.description ? <span>{preview.description}</span> : null}
      </span>
      {imageUrl ? (
        <img
          alt=""
          className="channel-link-preview-image"
          loading="lazy"
          onError={() => setImageFailed(true)}
          src={imageUrl}
          style={
            preview.imageWidth && preview.imageHeight
              ? { aspectRatio: `${preview.imageWidth} / ${preview.imageHeight}` }
              : undefined
          }
        />
      ) : null}
    </a>
  );
}
