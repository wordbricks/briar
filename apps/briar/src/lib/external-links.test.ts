/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  externalHttpUrlFromClick,
  installExternalLinkHandler,
  issueLinkTargetFromClick,
  listenForClickedIssueLinks,
} from "./external-links";

const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const tauriWindow = window as Window & { __TAURI_INTERNALS__?: unknown };

function clickLink(href: string): MouseEvent {
  const anchor = document.createElement("a");
  anchor.href = href;
  const child = document.createElement("span");
  anchor.append(child);
  document.body.append(anchor);
  const event = new MouseEvent("click", {
    bubbles: true,
    button: 0,
    cancelable: true,
  });
  child.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  tauriWindow.__TAURI_INTERNALS__ = {};
});

afterEach(() => {
  delete tauriWindow.__TAURI_INTERNALS__;
  document.body.replaceChildren();
});

describe("external link handling", () => {
  it("routes trusted HTTPS and custom-scheme issue links without calling the opener", () => {
    const opener = vi.fn(async () => undefined);
    const onIssueLink = vi.fn();
    const stopListening = listenForClickedIssueLinks(onIssueLink);
    const uninstall = installExternalLinkHandler(document, window, opener);

    const httpsClick = clickLink(
      `http://127.0.0.1:8787/open/issues/${projectId}/${runId}`,
    );
    const schemeClick = clickLink(
      `briar-companion://issues/${projectId}/${runId}`,
    );

    expect(httpsClick.defaultPrevented).toBe(true);
    expect(schemeClick.defaultPrevented).toBe(true);
    expect(onIssueLink).toHaveBeenNthCalledWith(1, { projectId, runId });
    expect(onIssueLink).toHaveBeenNthCalledWith(2, { projectId, runId });
    expect(opener).not.toHaveBeenCalled();

    uninstall();
    stopListening();
  });

  it("keeps ordinary and lookalike HTTP links external", () => {
    const opener = vi.fn(async () => undefined);
    const onIssueLink = vi.fn();
    const stopListening = listenForClickedIssueLinks(onIssueLink);
    const uninstall = installExternalLinkHandler(document, window, opener);

    const externalClick = clickLink("https://example.com/docs");
    const lookalikeClick = clickLink(
      `https://attacker.example/open/issues/${projectId}/${runId}`,
    );

    expect(externalClick.defaultPrevented).toBe(true);
    expect(lookalikeClick.defaultPrevented).toBe(true);
    expect(opener).toHaveBeenNthCalledWith(1, "https://example.com/docs");
    expect(opener).toHaveBeenNthCalledWith(
      2,
      `https://attacker.example/open/issues/${projectId}/${runId}`,
    );
    expect(onIssueLink).not.toHaveBeenCalled();

    uninstall();
    stopListening();
  });

  it("leaves download links to the WebView", () => {
    const anchor = document.createElement("a");
    anchor.href = "https://example.com/archive.zip";
    anchor.setAttribute("download", "archive.zip");
    const click = new MouseEvent("click", { button: 0, cancelable: true });
    Object.defineProperty(click, "target", { value: anchor });

    expect(externalHttpUrlFromClick(click)).toBeNull();
    expect(issueLinkTargetFromClick(click)).toBeNull();
  });
});
