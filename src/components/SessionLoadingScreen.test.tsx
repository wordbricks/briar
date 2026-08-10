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
    expect(status?.getAttribute("aria-busy")).toBe("true");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.textContent).toContain("로그인 정보를 확인하는 중입니다");

    const logo = status?.querySelector<HTMLElement>(".session-loading-logo");
    const image = logo?.querySelector<HTMLImageElement>("img");
    expect(image?.getAttribute("aria-hidden")).toBe("true");
    expect(image?.getAttribute("alt")).toBe("");
    expect(image?.src).toContain("briar-outline-gray.png");
    expect(logo?.style.getPropertyValue("--session-loading-logo")).toContain(
      "briar-outline-gray.png",
    );

    await act(async () => root.unmount());
  });
});
