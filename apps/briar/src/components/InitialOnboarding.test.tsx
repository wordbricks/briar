/** @vitest-environment jsdom */

import { act } from "react";
import type { Root } from "react-dom/client";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readInboxNotificationPreferences } from "../lib/inbox-notifications";
import { InitialOnboarding } from "./InitialOnboarding";

const createProps = () => ({
  authenticated: false,
  error: null,
  loading: false,
  loginCode: null,
  onCancelLogin: vi.fn(),
  onComplete: vi.fn(),
  onLogin: vi.fn(),
  openSystemSettings: vi.fn().mockResolvedValue(true),
  readPermissionStatus: vi.fn().mockResolvedValue("not_determined" as const),
  requestPermission: vi.fn().mockResolvedValue(true),
});

function buttonWithText(container: HTMLElement, text: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.includes(text),
  );
}

describe("InitialOnboarding", () => {
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
    ({ cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    }));
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  it("starts email verification from the primary second-step action", async () => {
    const props = createProps();
    await renderReactTestRoot(root, <InitialOnboarding {...props} />);
    await act(async () => {
      container.querySelector<HTMLButtonElement>("main section button")?.click();
    });

    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>("button")[0]?.click();
    });

    expect(props.onLogin).toHaveBeenCalledOnce();
    expect(props.onLogin).toHaveBeenCalledWith("email");
  });

  it("cancels an in-progress login before returning to the introduction", async () => {
    const props = {
      ...createProps(),
      loading: true,
      loginCode: "RZEHG4T5",
    };
    await renderReactTestRoot(root, <InitialOnboarding {...props} />);
    await act(async () => {
      container.querySelector<HTMLButtonElement>("main section button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("main > section > button")?.click();
    });

    expect(props.onCancelLogin).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Briar에 오신 것을 환영해요.");
  });

  it("keeps onboarding open and advances to notifications after login", async () => {
    const props = createProps();
    await renderReactTestRoot(root, <InitialOnboarding {...props} />);
    await act(async () => {
      buttonWithText(container, "시작하기")?.click();
    });

    await renderReactTestRoot(
      root,
      <InitialOnboarding {...props} authenticated />,
    );

    expect(container.textContent).toContain("필요한 순간에 바로 알려드릴까요?");
    expect(props.requestPermission).not.toHaveBeenCalled();
    expect(props.onComplete).not.toHaveBeenCalled();
  });

  it("recognizes existing permission without opening the macOS prompt", async () => {
    const props = {
      ...createProps(),
      authenticated: true,
      readPermissionStatus: vi.fn().mockResolvedValue("authorized" as const),
    };
    await renderReactTestRoot(root, <InitialOnboarding {...props} />);

    expect(container.textContent).toContain("알림을 받을 준비가 됐어요.");
    expect(props.requestPermission).not.toHaveBeenCalled();
    expect(readInboxNotificationPreferences()).toEqual({
      urgent: true,
      action_required: true,
      important: true,
      activity: false,
    });
    expect(props.onComplete).not.toHaveBeenCalled();

    await act(async () => {
      buttonWithText(container, "Briar 시작하기")?.click();
    });
    expect(props.onComplete).toHaveBeenCalledOnce();
  });

  it("requests permission only from the enable action and saves recommendations", async () => {
    const props = { ...createProps(), authenticated: true };
    await renderReactTestRoot(root, <InitialOnboarding {...props} />);

    expect(props.requestPermission).not.toHaveBeenCalled();
    expect(buttonWithText(container, "알림 켜기")?.getAttribute("aria-label"))
      .toBe("Briar의 macOS 알림 권한 요청하기");
    expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"))
      .toBe("3");
    await act(async () => {
      buttonWithText(container, "알림 켜기")?.click();
    });

    expect(props.requestPermission).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("알림을 받을 준비가 됐어요.");
    expect(readInboxNotificationPreferences()).toEqual({
      urgent: true,
      action_required: true,
      important: true,
      activity: false,
    });
  });

  it("keeps preferences off after denial and rechecks permission on app focus", async () => {
    const readPermissionStatus = vi.fn()
      .mockResolvedValueOnce("not_determined" as const)
      .mockResolvedValueOnce("denied" as const)
      .mockResolvedValueOnce("authorized" as const);
    const props = {
      ...createProps(),
      authenticated: true,
      readPermissionStatus,
      requestPermission: vi.fn().mockResolvedValue(false),
    };
    await renderReactTestRoot(root, <InitialOnboarding {...props} />);

    await act(async () => {
      buttonWithText(container, "알림 켜기")?.click();
    });
    expect(container.textContent).toContain("시스템 설정에서 알림을 허용해 주세요.");
    expect(readInboxNotificationPreferences()).toEqual({
      urgent: false,
      action_required: false,
      important: false,
      activity: false,
    });

    await act(async () => {
      buttonWithText(container, "시스템 설정 열기")?.click();
    });
    expect(props.openSystemSettings).toHaveBeenCalledOnce();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(container.textContent).toContain("알림을 받을 준비가 됐어요.");
    expect(readInboxNotificationPreferences().urgent).toBe(true);
  });

  it("shows a recoverable error while keeping notification preferences off", async () => {
    const props = {
      ...createProps(),
      authenticated: true,
      readPermissionStatus: vi.fn()
        .mockRejectedValueOnce(new Error("bridge unavailable"))
        .mockResolvedValueOnce("not_determined" as const),
    };
    await renderReactTestRoot(root, <InitialOnboarding {...props} />);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "알림 권한을 확인하지 못했습니다.",
    );
    expect(readInboxNotificationPreferences().urgent).toBe(false);

    await act(async () => {
      buttonWithText(container, "권한 다시 확인")?.click();
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("필요한 순간에 바로 알려드릴까요?");
  });

  it("allows later setup without enabling preferences", async () => {
    const props = { ...createProps(), authenticated: true };
    await renderReactTestRoot(root, <InitialOnboarding {...props} />);

    await act(async () => {
      buttonWithText(container, "나중에")?.click();
    });

    expect(props.onComplete).toHaveBeenCalledOnce();
    expect(props.requestPermission).not.toHaveBeenCalled();
    expect(readInboxNotificationPreferences()).toEqual({
      urgent: false,
      action_required: false,
      important: false,
      activity: false,
    });
  });
});
