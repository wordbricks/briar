/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { SessionLoadingScreen } from "./SessionLoadingScreen";

describe("SessionLoadingScreen", () => {
  it("renders the restoring-session logo as an accessible busy status", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<SessionLoadingScreen />));

    const status = container.querySelector<HTMLElement>('[role="status"]');
    expect(status?.dataset.testid).toBe("session-loading-screen");
    expect(status?.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(status?.getAttribute("aria-busy")).toBe("true");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.textContent).toContain("로그인 정보를 확인하는 중입니다");

    const logo = status?.querySelector<HTMLElement>(".session-loading-logo");
    const lightImage = logo?.querySelector<HTMLImageElement>(
      ".session-loading-logo-light",
    );
    const darkImage = logo?.querySelector<HTMLImageElement>(
      ".session-loading-logo-dark",
    );
    expect(lightImage?.getAttribute("aria-hidden")).toBe("true");
    expect(lightImage?.getAttribute("alt")).toBe("");
    expect(lightImage?.src).toContain("briar-mark-light.png");
    expect(darkImage?.getAttribute("alt")).toBe("");
    expect(darkImage?.src).toContain("briar-mark-dark.png");
    expect(
      logo?.style.getPropertyValue("--session-loading-logo-light"),
    ).toContain("briar-mark-light.png");
    expect(
      logo?.style.getPropertyValue("--session-loading-logo-dark"),
    ).toContain("briar-mark-dark.png");

    await act(async () => root.unmount());
  });
});
