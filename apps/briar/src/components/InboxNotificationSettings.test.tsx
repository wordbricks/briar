/** @vitest-environment jsdom */

import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { I18nProvider } from "../i18n";

const notificationMocks = {
  openSystemSettings: vi.fn(async () => true),
  readPermissionStatus: vi.fn<
    () => Promise<"authorized" | "denied" | "not_determined" | "unsupported">
  >(async () => "authorized"),
  requestPermission: vi.fn(async () => true),
};

import { InboxNotificationSettings } from "./InboxNotificationSettings";

describe("InboxNotificationSettings on macOS", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
    window.localStorage.setItem("briar.locale.v1", "en");
    notificationMocks.openSystemSettings.mockClear();
    notificationMocks.readPermissionStatus.mockClear();
    notificationMocks.readPermissionStatus.mockResolvedValue("authorized");
    notificationMocks.requestPermission.mockClear();
    notificationMocks.requestPermission.mockResolvedValue(true);
  });

  it("uses a master switch and enables the recommended categories", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <InboxNotificationSettings
          macDesktop
          openSystemSettings={notificationMocks.openSystemSettings}
          readPermissionStatus={notificationMocks.readPermissionStatus}
          requestPermission={notificationMocks.requestPermission}
        />
      </I18nProvider>,
    );

    const master = switchWithLabel(container, "System notifications");
    expect(master.getAttribute("data-state")).toBe("unchecked");
    expect(switchWithLabel(container, "Urgent").disabled).toBe(true);
    expect(switchWithLabel(container, "Play sound").disabled).toBe(true);
    expect(container.textContent).toContain("aren't remote push notifications");

    await act(async () => master.click());

    expect(notificationMocks.requestPermission).toHaveBeenCalledOnce();
    expect(switchWithLabel(container, "System notifications").getAttribute("data-state"))
      .toBe("checked");
    expect(switchWithLabel(container, "Urgent").getAttribute("data-state"))
      .toBe("checked");
    expect(switchWithLabel(container, "Needs review").getAttribute("data-state"))
      .toBe("checked");
    expect(switchWithLabel(container, "Important changes").getAttribute("data-state"))
      .toBe("checked");
    expect(switchWithLabel(container, "Recent activity").getAttribute("data-state"))
      .toBe("unchecked");
    expect(switchWithLabel(container, "Play sound").disabled).toBe(false);

    await cleanup();
  });

  it("shows the current macOS permission and opens its system settings", async () => {
    notificationMocks.readPermissionStatus.mockResolvedValue("denied");
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <InboxNotificationSettings
          macDesktop
          openSystemSettings={notificationMocks.openSystemSettings}
          readPermissionStatus={notificationMocks.readPermissionStatus}
          requestPermission={notificationMocks.requestPermission}
        />
      </I18nProvider>,
    );

    expect(container.textContent).toContain(
      "macOS is blocking notifications from Briar.",
    );
    const openSettings = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Open System Settings",
    );
    expect(openSettings).toBeTruthy();

    await act(async () => openSettings?.click());
    expect(notificationMocks.openSystemSettings).toHaveBeenCalledOnce();

    await cleanup();
  });
});

function switchWithLabel(container: HTMLElement, label: string) {
  const element = container.querySelector<HTMLButtonElement>(
    `button[role="switch"][aria-label="${label}"]`,
  );
  if (!element) throw new Error(`Missing switch: ${label}`);
  return element;
}
