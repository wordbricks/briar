/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { AppVersionStatus } from "./AppVersionStatus";

describe("AppVersionStatus", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.setItem("briar.locale.v1", "en");
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    container.remove();
    localStorage.removeItem("briar.locale.v1");
  });

  it("shows the app version in the status bar label", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <I18nProvider>
          <AppVersionStatus version="1.1.8" />
        </I18nProvider>,
      );
    });

    expect(container.textContent).toContain("v1.1.8");
    expect(
      container.querySelector(".app-version-status")?.getAttribute("aria-label"),
    ).toContain("v1.1.8");

    await act(async () => root.unmount());
  });
});
