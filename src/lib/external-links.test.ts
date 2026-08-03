// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { installExternalLinkHandler } from "./external-links";
import { openExternalUrl } from "./auth-session";

vi.mock("./auth-session", () => ({
  openExternalUrl: vi.fn(() => Promise.resolve()),
}));

const mockedOpenExternalUrl = vi.mocked(openExternalUrl);

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("native external link handling", () => {
  it.each([
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)",
    "Mozilla/5.0 (Linux; Android 15; Pixel 9)",
  ])("opens HTTP links in the system browser on %s", async (userAgent) => {
    vi.stubGlobal("navigator", { userAgent });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    const removeHandler = installExternalLinkHandler();
    document.body.innerHTML =
      '<a href="https://example.com/docs?q=1"><span>Docs</span></a>';
    const linkText = document.querySelector("span");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });

    linkText?.dispatchEvent(click);
    await Promise.resolve();

    expect(click.defaultPrevented).toBe(true);
    expect(mockedOpenExternalUrl).toHaveBeenCalledWith(
      "https://example.com/docs?q=1",
    );
    removeHandler();
  });

  it("leaves internal navigation and downloaded files inside the app", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    const removeHandler = installExternalLinkHandler();
    document.body.innerHTML = [
      '<a id="internal" href="#issues">Issues</a>',
      '<a id="download" href="https://example.com/report.pdf" download>Report</a>',
    ].join("");

    const internalClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    const downloadClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    document.querySelector("#internal")?.dispatchEvent(internalClick);
    document.querySelector("#download")?.dispatchEvent(downloadClick);

    expect(internalClick.defaultPrevented).toBe(false);
    expect(downloadClick.defaultPrevented).toBe(false);
    expect(mockedOpenExternalUrl).not.toHaveBeenCalled();
    removeHandler();
  });

  it("preserves normal browser navigation in the web app", () => {
    const removeHandler = installExternalLinkHandler();
    document.body.innerHTML = '<a href="https://example.com">Website</a>';
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });

    document.querySelector("a")?.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(false);
    expect(mockedOpenExternalUrl).not.toHaveBeenCalled();
    removeHandler();
  });
});
