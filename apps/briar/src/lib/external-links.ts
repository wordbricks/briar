import { openExternalUrl } from "./auth-session";
import { parseIssueLink, type IssueLinkTarget } from "./issue-links";

const externalHttpUrlPattern = /^https?:\/\//iu;
export const briarIssueLinkClickEvent = "briar:issue-link-click";

function linkHrefFromClick(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (!(event.target instanceof Element)) return null;

  const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor || anchor.hasAttribute("download")) return null;

  return anchor.getAttribute("href")?.trim() || null;
}

export function externalHttpUrlFromClick(event: MouseEvent) {
  const href = linkHrefFromClick(event);
  if (!href || !externalHttpUrlPattern.test(href)) return null;

  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function issueLinkTargetFromClick(
  event: MouseEvent,
  trustedOrigin?: string,
): IssueLinkTarget | null {
  const href = linkHrefFromClick(event);
  return href ? parseIssueLink(href, trustedOrigin) : null;
}

export function listenForClickedIssueLinks(
  onLink: (target: IssueLinkTarget) => void,
  eventTarget: EventTarget = window,
): () => void {
  const handleLink = (event: Event) => {
    if (!(event instanceof CustomEvent) || typeof event.detail !== "string") {
      return;
    }
    const target = parseIssueLink(event.detail);
    if (target) onLink(target);
  };
  eventTarget.addEventListener(briarIssueLinkClickEvent, handleLink);
  return () =>
    eventTarget.removeEventListener(briarIssueLinkClickEvent, handleLink);
}

export function installExternalLinkHandler(
  documentTarget: Document = document,
  eventTarget: EventTarget = window,
  opener: (url: string) => Promise<void> = openExternalUrl,
) {
  const handleClick = (event: MouseEvent) => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    const issueTarget = issueLinkTargetFromClick(event);
    if (issueTarget) {
      const href = linkHrefFromClick(event);
      if (!href) return;
      event.preventDefault();
      eventTarget.dispatchEvent(
        new CustomEvent(briarIssueLinkClickEvent, { detail: href }),
      );
      return;
    }

    const url = externalHttpUrlFromClick(event);
    if (!url) return;

    event.preventDefault();
    void opener(url).catch((error: unknown) => {
      console.error("Failed to open external link", error);
    });
  };

  documentTarget.addEventListener("click", handleClick);
  return () => documentTarget.removeEventListener("click", handleClick);
}
