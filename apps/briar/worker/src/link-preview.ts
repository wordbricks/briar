import type { ChannelLinkPreview } from "../../src/lib/channels-contract";

const maxUrlLength = 2_048;
const maxHtmlBytes = 256 * 1_024;
const maxRedirects = 3;
const fetchTimeoutMs = 5_000;
const redirectStatuses = new Set([300, 301, 302, 303, 307, 308]);

const htmlEntityNames = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
} as const satisfies Record<string, string>;

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) {
    return null;
  }
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  return octets as [number, number, number, number];
}

function parseIpv6(hostname: string): number[] | null {
  const address = hostname.replace(/^\[/u, "").replace(/\]$/u, "");
  if (address.includes("%")) return null;
  const halves = address.split("::");
  if (halves.length > 2) return null;

  const parseSide = (side: string) => {
    if (!side) return [];
    const groups = side.split(":");
    const result: number[] = [];
    for (const group of groups) {
      if (group.includes(".")) {
        const ipv4 = parseIpv4(group);
        if (!ipv4 || result.length > 0 && result.length !== 6) return null;
        result.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/iu.test(group)) return null;
      result.push(Number.parseInt(group, 16));
    }
    return result;
  };

  const left = parseSide(halves[0] ?? "");
  const right = parseSide(halves[1] ?? "");
  if (!left || !right) return null;
  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }
  const zeroCount = 8 - left.length - right.length;
  if (zeroCount < 1) return null;
  return [...left, ...Array.from({ length: zeroCount }, () => 0), ...right];
}

function isPrivateIpv4(hostname: string) {
  const octets = parseIpv4(hostname);
  if (!octets) return false;
  const [first, second, third] = octets;
  return first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224;
}

function isPrivateIpv6(hostname: string) {
  const groups = parseIpv6(hostname);
  if (!groups) return hostname.includes(":");
  const first = groups[0] ?? 0;
  const isEmbeddedIpv4 = groups.slice(0, 6).every((group) => group === 0) ||
    (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff);
  if (isEmbeddedIpv4) {
    const mapped = [
      groups[6] === undefined ? 0 : groups[6] >> 8,
      groups[6] === undefined ? 0 : groups[6] & 0xff,
      groups[7] === undefined ? 0 : groups[7] >> 8,
      groups[7] === undefined ? 0 : groups[7] & 0xff,
    ].join(".");
    return isPrivateIpv4(mapped);
  }
  return groups.slice(0, 7).every((group) => group === 0) ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first === 0x2001 && groups[1] === 0x0db8);
}

const isLocalHostname = (hostname: string) =>
  hostname === "localhost" ||
  hostname.endsWith(".localhost") ||
  hostname.endsWith(".local") ||
  hostname.endsWith(".internal") ||
  hostname.endsWith(".home.arpa") ||
  hostname.endsWith(".test") ||
  hostname.endsWith(".invalid") ||
  hostname.endsWith(".example");

/** Returns a URL that is safe to request from the link-preview worker. */
export function safeExternalUrl(input: string | URL): URL | null {
  let parsed: URL;
  try {
    parsed = typeof input === "string" ? new URL(input) : new URL(input.href);
  } catch {
    return null;
  }
  if (parsed.href.length > maxUrlLength) return null;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") return null;

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, "");
  if (!hostname || isLocalHostname(hostname)) return null;
  if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) return null;
  if (/^(?:0x[0-9a-f]+|0[0-7]+|\d+)$/iu.test(hostname)) return null;
  return parsed;
}

function decodeHtmlEntities(value: string) {
  const codePoint = (number: number) =>
    Number.isSafeInteger(number) && number >= 0 && number <= 0x10ffff
      ? String.fromCodePoint(number)
      : "";
  return value
    .replace(/&#x([0-9a-f]+);?/giu, (_, code: string) =>
      codePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);?/gu, (_, code: string) =>
      codePoint(Number.parseInt(code, 10)))
    .replace(/&([a-z]+);?/giu, (match, name: string) => {
      const normalizedName = name.toLowerCase();
      return normalizedName in htmlEntityNames
        ? htmlEntityNames[normalizedName as keyof typeof htmlEntityNames]
        : match;
    });
}

function cleanText(value: string | undefined, maxLength: number) {
  if (!value) return null;
  const text = decodeHtmlEntities(value.replace(/<[^>]*>/gu, ""))
    .replace(/\s+/gu, " ")
    .trim();
  return text ? text.slice(0, maxLength) : null;
}

function parseAttributes(tag: string) {
  const attributes = new Map<string, string>();
  const attributePattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gu;
  for (const match of tag.matchAll(attributePattern)) {
    const name = match[1]?.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4];
    if (name && value !== undefined && !attributes.has(name)) {
      attributes.set(name, value);
    }
  }
  return attributes;
}

function parseHtmlPreview(html: string, pageUrl: URL): Omit<ChannelLinkPreview, "url"> | null {
  const metadata = new Map<string, string>();
  const metaTags = html.match(/<meta\b[^>]*>/giu) ?? [];
  for (const tag of metaTags) {
    const attributes = parseAttributes(tag);
    const key = (attributes.get("property") ?? attributes.get("name"))
      ?.trim()
      .toLowerCase();
    const value = cleanText(attributes.get("content"), 2_000);
    if (key && value && !metadata.has(key)) metadata.set(key, value);
  }

  const title = cleanText(
    html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1],
    240,
  );
  const firstValue = (...keys: string[]) => {
    for (const key of keys) {
      const value = metadata.get(key);
      if (value) return value;
    }
    return null;
  };
  const imageValue = firstValue(
    "og:image",
    "og:image:url",
    "og:image:secure_url",
    "twitter:image",
  );
  const faviconValue = (html.match(/<link\b[^>]*>/giu) ?? [])
    .map(parseAttributes)
    .find((attributes) => {
      const rel = attributes.get("rel")?.toLowerCase().split(/\s+/u) ?? [];
      return rel.includes("icon") || rel.includes("apple-touch-icon");
    })
    ?.get("href") ?? null;
  const resolveAsset = (value: string | null) => {
    if (!value) return null;
    try {
      const resolved = safeExternalUrl(new URL(value, pageUrl));
      return resolved?.href ?? null;
    } catch {
      return null;
    }
  };
  const preview = {
    title: firstValue("og:title", "twitter:title") ?? title,
    description: firstValue(
      "og:description",
      "twitter:description",
      "description",
    ),
    imageUrl: resolveAsset(imageValue),
    faviconUrl: resolveAsset(faviconValue),
    siteName: firstValue("og:site_name", "application-name"),
  } satisfies Omit<ChannelLinkPreview, "url">;
  return preview.title || preview.description || preview.imageUrl || preview.siteName
    ? preview
    : null;
}

async function readLimitedHtml(response: Response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxHtmlBytes) return null;
  if (!response.body) {
    const text = await response.text();
    return new TextEncoder().encode(text).byteLength <= maxHtmlBytes ? text : null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxHtmlBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function fetchWithTimeout(fetcher: Fetcher, url: URL) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    const response = await fetcher(url, {
      headers: {
        Accept: "text/html, application/xhtml+xml",
        "User-Agent": "BriarLinkPreview/1.0",
      },
      redirect: "manual",
      signal: controller.signal,
    });
    return { response, cancel: () => clearTimeout(timeout) };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

/** Fetches and parses a page's Open Graph metadata, returning null on failure. */
export async function fetchChannelLinkPreview(
  input: string,
  fetcher: Fetcher = fetch,
): Promise<ChannelLinkPreview | null> {
  const initialUrl = safeExternalUrl(input);
  if (!initialUrl) return null;
  let pageUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const timed = await fetchWithTimeout(fetcher, pageUrl);
    if (!timed) return null;
    const { response } = timed;
    try {
      if (redirectStatuses.has(response.status)) {
        if (redirectCount === maxRedirects) return null;
        const location = response.headers.get("location");
        if (!location) return null;
        try {
          const redirectedUrl = safeExternalUrl(new URL(location, pageUrl));
          if (!redirectedUrl) return null;
          pageUrl = redirectedUrl;
        } catch {
          return null;
        }
        continue;
      }
      if (!response.ok) return null;
      const contentType = response.headers.get("content-type")?.toLowerCase();
      if (contentType && !contentType.includes("text/html") &&
        !contentType.includes("application/xhtml+xml")) {
        return null;
      }
      let html: string | null;
      try {
        html = await readLimitedHtml(response);
      } catch {
        return null;
      }
      if (!html) return null;
      const parsed = parseHtmlPreview(html, pageUrl);
      return parsed ? { url: initialUrl.href, ...parsed } : null;
    } finally {
      timed.cancel();
    }
  }
  return null;
}
