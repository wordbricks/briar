import { openExternalUrl } from "./auth-session";

const externalHttpUrlPattern = /^https?:\/\//iu;

export function externalHttpUrlFromClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (!(event.target instanceof Element)) return null;

  const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor || anchor.hasAttribute("download")) return null;

  const href = anchor.getAttribute("href")?.trim();
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

export function installExternalLinkHandler(documentTarget: Document = document) {
  const handleClick = (event: MouseEvent) => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    const url = externalHttpUrlFromClick(event);
    if (!url) return;

    event.preventDefault();
    void openExternalUrl(url).catch((error: unknown) => {
      console.error("Failed to open external link", error);
    });
  };

  documentTarget.addEventListener("click", handleClick);
  return () => documentTarget.removeEventListener("click", handleClick);
}
