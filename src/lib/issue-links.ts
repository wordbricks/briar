import { formatIssueKey } from "./issue-key";

const issueLinkPathPattern =
  /^\/open\/issues\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/?$/iu;
const sessionLinkPathPattern =
  /^\/open\/sessions\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/?$/iu;
const channelLinkPathPattern =
  /^\/open\/channels\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/?$/iu;
const issueDeepLinkScheme = "briar-companion:";

export type IssueLinkTarget = {
  projectId: string;
  runId: string;
};

export type SessionLinkTarget = {
  projectId: string;
  sessionId: string;
};

export type ChannelLinkTarget = {
  organizationId: string;
  channelId: string;
  messageId: string;
  rootMessageId: string;
};

export type BriarLinkTarget =
  | ({ kind: "issue" } & IssueLinkTarget)
  | ({ kind: "session" } & SessionLinkTarget)
  | ({ kind: "channel" } & ChannelLinkTarget);

export type IssueShareResult = "cancelled" | "copied" | "shared";

function configuredShareOrigin(): string {
  const configured = import.meta.env.VITE_BRIAR_API_URL?.trim();
  if (configured) return configured;
  if (typeof window !== "undefined") return window.location.origin;
  throw new Error("Briar share URL is not configured");
}

export function issueShareUrl(
  projectId: string,
  runId: string,
  origin = configuredShareOrigin(),
): string {
  const url = new URL(origin);
  url.pathname = `/open/issues/${encodeURIComponent(projectId)}/${encodeURIComponent(runId)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function sessionShareUrl(
  projectId: string,
  sessionId: string,
  origin = configuredShareOrigin(),
): string {
  const url = new URL(origin);
  url.pathname = `/open/sessions/${encodeURIComponent(projectId)}/${encodeURIComponent(sessionId)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function channelShareUrl(
  input: {
    organizationId: string;
    channelId: string;
    messageId: string;
    rootMessageId?: string | null;
  },
  origin = configuredShareOrigin(),
): string {
  const url = new URL(origin);
  url.pathname =
    `/open/channels/${encodeURIComponent(input.organizationId)}` +
    `/${encodeURIComponent(input.channelId)}` +
    `/${encodeURIComponent(input.messageId)}`;
  url.search = "";
  url.hash = "";
  const rootMessageId = input.rootMessageId?.trim();
  if (rootMessageId && rootMessageId !== input.messageId) {
    url.searchParams.set("root", rootMessageId);
  }
  return url.toString();
}

export function parseIssueLink(value: string): IssueLinkTarget | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol === issueDeepLinkScheme && url.hostname === "issues") {
    const match = `/open/issues${url.pathname}`.match(issueLinkPathPattern);
    return match ? { projectId: match[1], runId: match[2] } : null;
  }

  if (url.protocol === "https:" || url.protocol === "http:") {
    const match = url.pathname.match(issueLinkPathPattern);
    return match ? { projectId: match[1], runId: match[2] } : null;
  }

  return null;
}

export function parseSessionLink(value: string): SessionLinkTarget | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol === issueDeepLinkScheme && url.hostname === "sessions") {
    const match = `/open/sessions${url.pathname}`.match(sessionLinkPathPattern);
    return match ? { projectId: match[1], sessionId: match[2] } : null;
  }

  if (url.protocol === "https:" || url.protocol === "http:") {
    const match = url.pathname.match(sessionLinkPathPattern);
    return match ? { projectId: match[1], sessionId: match[2] } : null;
  }

  return null;
}

function channelLinkFromParts(
  organizationId: string,
  channelId: string,
  messageId: string,
  rootMessageId?: string | null,
): ChannelLinkTarget {
  const root = rootMessageId?.trim();
  return {
    organizationId,
    channelId,
    messageId,
    rootMessageId: root || messageId,
  };
}

export function parseChannelLink(value: string): ChannelLinkTarget | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol === issueDeepLinkScheme && url.hostname === "channels") {
    const match = `/open/channels${url.pathname}`.match(channelLinkPathPattern);
    return match
      ? channelLinkFromParts(
          match[1],
          match[2],
          match[3],
          url.searchParams.get("root"),
        )
      : null;
  }

  if (url.protocol === "https:" || url.protocol === "http:") {
    const match = url.pathname.match(channelLinkPathPattern);
    return match
      ? channelLinkFromParts(
          match[1],
          match[2],
          match[3],
          url.searchParams.get("root"),
        )
      : null;
  }

  return null;
}

export function parseBriarLink(value: string): BriarLinkTarget | null {
  const issue = parseIssueLink(value);
  if (issue) return { kind: "issue", ...issue };
  const session = parseSessionLink(value);
  if (session) return { kind: "session", ...session };
  const channel = parseChannelLink(value);
  return channel ? { kind: "channel", ...channel } : null;
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Unable to copy text");
}

export async function copyIssueId(
  runNumber: number,
  issueKeyPrefix?: string,
): Promise<void> {
  await copyText(formatIssueKey(issueKeyPrefix, runNumber));
}

export async function copyIssueShareLink(input: {
  projectId: string;
  runId: string;
}): Promise<void> {
  await copyText(issueShareUrl(input.projectId, input.runId));
}

export async function copySessionShareLink(input: {
  projectId: string;
  sessionId: string;
}): Promise<void> {
  await copyText(sessionShareUrl(input.projectId, input.sessionId));
}

export async function copyChannelShareLink(input: {
  organizationId: string;
  channelId: string;
  messageId: string;
  rootMessageId?: string | null;
}): Promise<void> {
  await copyText(channelShareUrl(input));
}

export async function copyChannelMessageText(value: string): Promise<void> {
  await copyText(value);
}

export async function shareIssueLink(input: {
  projectId: string;
  runId: string;
  title: string;
}): Promise<IssueShareResult> {
  const url = issueShareUrl(input.projectId, input.runId);
  if (navigator.share) {
    try {
      await navigator.share({ title: input.title, url });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "cancelled";
      }
      // WebViews without a native share implementation still get a copyable URL.
    }
  }

  await copyText(url);
  return "copied";
}

export function listenForLinks<T>(
  parseLink: (value: string) => T | null,
  onLink: (target: T) => void,
): () => void {
  if (
    typeof window === "undefined" ||
    !("__TAURI_INTERNALS__" in window)
  ) {
    return () => {};
  }

  let disposed = false;
  let stopListening: (() => void) | null = null;
  const acceptUrls = (urls: string[] | null) => {
    for (const url of urls ?? []) {
      const target = parseLink(url);
      if (target) onLink(target);
    }
  };

  void import("@tauri-apps/plugin-deep-link")
    .then(async ({ getCurrent, onOpenUrl }) => {
      acceptUrls(await getCurrent());
      const unlisten = await onOpenUrl(acceptUrls);
      if (disposed) {
        unlisten();
      } else {
        stopListening = unlisten;
      }
    })
    .catch((error) => {
      console.error("Failed to listen for Briar app links", error);
    });

  return () => {
    disposed = true;
    stopListening?.();
  };
}

export function listenForBriarLinks(
  onLink: (target: BriarLinkTarget) => void,
): () => void {
  return listenForLinks(parseBriarLink, onLink);
}
