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

type ChannelLinkPreviewState = {
  loading: boolean;
  preview: ChannelLinkPreviewData | null;
  url: string | null;
};

/*
  Resolving the cache during render, instead of inside an effect, keeps a link
  that was already fetched at its final height from the very first frame. The
  effect-only version painted an empty row first, which moved every message
  below it once the cached card appeared.
*/
function resolveChannelLinkPreviewState(
  targetUrl: string | null,
): ChannelLinkPreviewState {
  if (!targetUrl) return { loading: false, preview: null, url: null };
  const cached = readPreviewCache(targetUrl);
  if (cached && !cached.pending) {
    return {
      loading: false,
      preview: normalizePreview(cached.preview, targetUrl),
      url: targetUrl,
    };
  }
  return { loading: true, preview: null, url: targetUrl };
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
  const [state, setState] = useState(() =>
    resolveChannelLinkPreviewState(targetUrl)
  );
  const [faviconFailed, setFaviconFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const current = state.url === targetUrl
    ? state
    : resolveChannelLinkPreviewState(targetUrl);

  useEffect(() => {
    let active = true;
    setFaviconFailed(false);
    setImageFailed(false);
    const resolved = resolveChannelLinkPreviewState(targetUrl);
    /*
      The render pass already resolved this URL, so replacing an equivalent
      state here would only cost every mounted preview an extra commit while a
      channel loads.
    */
    setState((existing) =>
      existing.url === resolved.url && existing.loading === resolved.loading
        ? existing
        : resolved
    );
    if (!targetUrl || !resolved.loading) {
      return () => {
        active = false;
      };
    }

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

  if (!targetUrl) return null;
  if (current.loading) {
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
  const preview = current.preview;
  if (!preview) return null;

  let hostname = preview.url;
  try {
    hostname = new URL(preview.url).hostname.replace(/^www\./iu, "");
  } catch {
    // normalizePreview already validates the URL; keep the URL as a final fallback.
  }
  const siteName = preview.siteName ?? hostname;
  const title = preview.title ?? siteName;
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
      {/*
        The reservation lives on the frame, not the picture, so a banner that
        never arrives leaves the card exactly as tall as it was. Sites that
        publish no dimensions keep the 1.91:1 Open Graph default declared in
        CSS, which the worker replaces once it can read the real size.
      */}
      {preview.imageUrl ? (
        <span
          className="channel-link-preview-image"
          style={
            preview.imageWidth && preview.imageHeight
              ? { aspectRatio: `${preview.imageWidth} / ${preview.imageHeight}` }
              : undefined
          }
        >
          {imageFailed ? null : (
            <img
              alt=""
              loading="lazy"
              onError={() => setImageFailed(true)}
              src={preview.imageUrl}
            />
          )}
        </span>
      ) : null}
    </a>
  );
}
