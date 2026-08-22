/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { AppUpdateProvider } from "./AppUpdateProvider";
import { AppVersionStatus } from "./AppVersionStatus";
import { UpdateControl } from "./UpdateControl";

const { check } = vi.hoisted(() => ({
  check: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check }));

describe("AppVersionStatus", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.setItem("briar.locale.v1", "en");
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    container = document.createElement("div");
    document.body.append(container);
    check.mockReset();
    check.mockResolvedValue(null);
  });

  afterEach(() => {
    container.remove();
    localStorage.removeItem("briar.locale.v1");
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("checks from an upward menu and reveals the existing install control", async () => {
    const update = {
      version: "1.2.9",
      downloadAndInstall: vi.fn(),
    };
    check.mockResolvedValueOnce(null).mockResolvedValueOnce(update);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <I18nProvider>
          <AppUpdateProvider>
            <AppVersionStatus version="1.2.8" />
            <UpdateControl />
          </AppUpdateProvider>
        </I18nProvider>,
      );
      await Promise.resolve();
    });

    const versionButton = container.querySelector<HTMLButtonElement>(
      ".app-version-trigger",
    );
    await act(async () => versionButton?.click());
    const checkButton = container.querySelector<HTMLButtonElement>(
      ".app-version-popover [role='menuitem']",
    );
    expect(checkButton?.textContent).toContain("Check for updates");
    expect(versionButton?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      checkButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(check).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".app-version-popover")).toBeNull();
    expect(
      container
        .querySelector(".sidebar-update-trigger")
        ?.getAttribute("aria-label"),
    ).toContain("v1.2.9");

    await act(async () => root.unmount());
  });
});
