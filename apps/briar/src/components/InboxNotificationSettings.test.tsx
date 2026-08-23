/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import { requestInboxNotificationPermission } from "../lib/inbox-notifications";
import { InboxNotificationSettings } from "./InboxNotificationSettings";

vi.mock("../lib/inbox-notifications", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../lib/inbox-notifications")>();
  return {
    ...original,
    requestInboxNotificationPermission: vi.fn(),
  };
});

describe("InboxNotificationSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("briar.locale.v1", "ko");
    vi.mocked(requestInboxNotificationPermission).mockReset();
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("enables an importance category after notification permission is granted", async () => {
    vi.mocked(requestInboxNotificationPermission).mockResolvedValue(true);
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <InboxNotificationSettings />
        </I18nProvider>,
      );
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="긴급"]')
        ?.click();
    });

    expect(requestInboxNotificationPermission).toHaveBeenCalledOnce();
    expect(
      JSON.parse(
        window.localStorage.getItem(
          "briar.settings.inbox-notifications.v1",
        ) ?? "{}",
      ),
    ).toEqual({
      urgent: true,
      action_required: false,
      important: false,
      activity: false,
    });

    await act(async () => root.unmount());
  });

  it("keeps a category off when notification permission is denied", async () => {
    vi.mocked(requestInboxNotificationPermission).mockResolvedValue(false);
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <InboxNotificationSettings />
        </I18nProvider>,
      );
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="긴급"]')
        ?.click();
    });

    expect(container.textContent).toContain(
      "시스템에서 알림 권한을 허용해야",
    );
    expect(
      window.localStorage.getItem(
        "briar.settings.inbox-notifications.v1",
      ),
    ).toBeNull();

    await act(async () => root.unmount());
  });
});
