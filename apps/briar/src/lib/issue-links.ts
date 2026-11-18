import { briarApiUrl } from "./api-config";
import { formatIssueKey } from "./issue-key";
import type { ActivePage } from "./app-navigation";

const issueLinkPathPattern =
  /^\/open\/issues\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/?$/iu;
const webAppIssueLinkPathPattern =
  /^\/app\/open\/issues\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/?$/iu;
const webAppIssueKeyPathPattern =
  /^\/app\/issues\/([A-Za-z0-9]{1,3}-\d{1,9})\/?$/u;
const webAppPagePathPattern = /^\/app\/([a-z-]{1,32})\/?$/u;

const webAppPages: ReadonlySet<string> = new Set<ActivePage>([
  "lobby",
  "projects",
  "issues",
  "agents",
  "channels",
  "dms",
  "schedule",
  "inbox",
  "my-issues",
  "workspace-create",
  "settings",
]);
const sessionLinkPathPattern =
  /^\/open\/sessions\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/?$/iu;
const channelLinkPathPattern =
  /^\/open\/channels\/([0-9a-f-]{36})\/([0-9a-f-]{36})(?:\/([0-9a-f-]{36}))?\/?$/iu;
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
  workspaceId: string;
  channelId: string;
  messageId: string | null;
  rootMessageId: string | null;
};

export type IssueKeyLinkTarget = {
  issueKey: string;
};

export type WebPageLinkTarget = {
  page: ActivePage;
};

export type BriarLinkTarget =
  | ({ kind: "issue" } & IssueLinkTarget)
  | ({ kind: "issueKey" } & IssueKeyLinkTarget)
  | ({ kind: "session" } & SessionLinkTarget)
  | ({ kind: "channel" } & ChannelLinkTarget)
  | ({ kind: "page" } & WebPageLinkTarget);

export type IssueShareResult = "cancelled" | "copied" | "shared";

function configuredBriarOrigin(): string | null {
  if (briarApiUrl) return briarApiUrl;
  if (typeof window !== "undefined") return window.location.origin;
  return null;
}

function configuredShareOrigin(): string {
  const configured = configuredBriarOrigin();
  if (configured) return configured;
  throw new Error("Briar share URL is not configured");
}

function hasTrustedHttpOrigin(url: URL, trustedOrigin: string | null): boolean {
  if (!trustedOrigin) return false;
  try {
    return url.origin === new URL(trustedOrigin).origin;
  } catch {
    return false;
  }
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
    workspaceId: string;
    channelId: string;
    messageId?: string | null;
    rootMessageId?: string | null;
  },
  origin = configuredShareOrigin(),
): string {
  const url = new URL(origin);
  url.pathname =
    `/open/channels/${encodeURIComponent(input.workspaceId)}` +
    `/${encodeURIComponent(input.channelId)}` +
    (input.messageId?.trim()
      ? `/${encodeURIComponent(input.messageId.trim())}`
      : "");
  url.search = "";
  url.hash = "";
  const rootMessageId = input.rootMessageId?.trim();
  if (
    input.messageId?.trim() &&
    rootMessageId &&
    rootMessageId !== input.messageId
  ) {
    url.searchParams.set("root", rootMessageId);
  }
  return url.toString();
}

export function parseIssueLink(
  value: string,
  trustedOrigin = configuredBriarOrigin(),
): IssueLinkTarget | null {
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

  if (
    (url.protocol === "https:" || url.protocol === "http:") &&
    hasTrustedHttpOrigin(url, trustedOrigin)
  ) {
    const match = url.pathname.match(issueLinkPathPattern);
    return match ? { projectId: match[1], runId: match[2] } : null;
  }

  return null;
}

export function parseWebAppIssuePath(pathname: string): IssueLinkTarget | null {
  const match = pathname.match(webAppIssueLinkPathPattern);
  return match ? { projectId: match[1], runId: match[2] } : null;
}

export function parseWebAppIssueKeyPath(pathname: string): string | null {
  const match = pathname.match(webAppIssueKeyPathPattern);
  return match ? match[1].toUpperCase() : null;
}

export function parseWebAppPagePath(pathname: string): ActivePage | null {
  const match = pathname.match(webAppPagePathPattern);
  if (!match) return null;
  return webAppPages.has(match[1]) ? (match[1] as ActivePage) : null;
}

/**
 * The canonical, human-readable URL of an issue card on the web app, keyed by
 * the team's issue prefix and the run number ("BR-42") instead of internal
 * ids. Opening, copying or reloading it lands on the same card.
 */
export function webAppIssueKeyUrl(
  issueKey: string,
  origin = configuredShareOrigin(),
): string {
  const url = new URL(origin);
  url.pathname = `/app/issues/${encodeURIComponent(issueKey.toUpperCase())}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function parseSessionLink(
  value: string,
  trustedOrigin = configuredBriarOrigin(),
): SessionLinkTarget | null {
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

  if (
    (url.protocol === "https:" || url.protocol === "http:") &&
    hasTrustedHttpOrigin(url, trustedOrigin)
  ) {
    const match = url.pathname.match(sessionLinkPathPattern);
    return match ? { projectId: match[1], sessionId: match[2] } : null;
  }

  return null;
}

function channelLinkFromParts(
  workspaceId: string,
  channelId: string,
  messageId: string | null | undefined,
  rootMessageId?: string | null,
): ChannelLinkTarget {
  const normalizedMessageId = messageId ?? null;
  const root = rootMessageId?.trim();
  return {
    workspaceId,
    channelId,
    messageId: normalizedMessageId,
    rootMessageId: root || normalizedMessageId,
  };
}

export function parseChannelLink(
  value: string,
  trustedOrigin = configuredBriarOrigin(),
): ChannelLinkTarget | null {
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

  if (
    (url.protocol === "https:" || url.protocol === "http:") &&
    hasTrustedHttpOrigin(url, trustedOrigin)
  ) {
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

export function parseBriarLink(
  value: string,
  trustedOrigin = configuredBriarOrigin(),
): BriarLinkTarget | null {
  const issue = parseIssueLink(value, trustedOrigin);
  if (issue) return { kind: "issue", ...issue };
  const session = parseSessionLink(value, trustedOrigin);
  if (session) return { kind: "session", ...session };
  const channel = parseChannelLink(value, trustedOrigin);
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
  urlOverride?: string;
}): Promise<void> {
  await copyText(input.urlOverride ?? issueShareUrl(input.projectId, input.runId));
}

export async function copySessionShareLink(input: {
  projectId: string;
  sessionId: string;
}): Promise<void> {
  await copyText(sessionShareUrl(input.projectId, input.sessionId));
}

export async function copyChannelShareLink(input: {
  workspaceId: string;
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
  urlOverride?: string;
}): Promise<IssueShareResult> {
  const url = input.urlOverride ?? issueShareUrl(input.projectId, input.runId);
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
