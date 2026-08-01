const issueLinkPathPattern =
  /^\/open\/issues\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/?$/iu;
const issueDeepLinkScheme = "briar-companion:";
const briarIssueSourceKeyPrefix = "briar-issue:";

export type IssueLinkTarget = {
  projectId: string;
  runId: string;
};

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

export function issueDeepLinkUrl(projectId: string, runId: string): string {
  return `briar-companion://issues/${encodeURIComponent(projectId)}/${encodeURIComponent(runId)}`;
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

export function issueIdFromSourceKey(sourceKey: string): string {
  return sourceKey.startsWith(briarIssueSourceKeyPrefix)
    ? sourceKey.slice(briarIssueSourceKeyPrefix.length)
    : sourceKey;
}

export async function copyIssueId(sourceKey: string): Promise<void> {
  await copyText(issueIdFromSourceKey(sourceKey));
}

export async function copyIssueShareLink(input: {
  projectId: string;
  runId: string;
}): Promise<void> {
  await copyText(issueShareUrl(input.projectId, input.runId));
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

export function listenForIssueLinks(
  onIssueLink: (target: IssueLinkTarget) => void,
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
      const target = parseIssueLink(url);
      if (target) onIssueLink(target);
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
      console.error("Failed to listen for Briar issue links", error);
    });

  return () => {
    disposed = true;
    stopListening?.();
  };
}
