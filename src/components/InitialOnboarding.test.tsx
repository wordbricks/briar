/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspectOnboardingPrerequisites } from "../lib/initial-onboarding";
import { InitialOnboarding } from "./InitialOnboarding";

vi.mock("../lib/initial-onboarding", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../lib/initial-onboarding")>();
  return {
    ...original,
    inspectOnboardingPrerequisites: vi.fn().mockResolvedValue({
      git: {
        installed: true,
        version: "git version 2.50.1",
        authenticated: true,
      },
      codex: {
        installed: true,
        version: "codex-cli 1.0.0",
        authenticated: true,
      },
      claude: {
        installed: false,
        version: null,
        authenticated: false,
      },
      grok: {
        installed: false,
        version: null,
        authenticated: false,
      },
    }),
    installOnboardingPrerequisite: vi.fn(),
  };
});

const createProps = () => ({
  error: null,
  loading: false,
  loginCode: null,
  onCancelLogin: vi.fn(),
  onLogin: vi.fn(),
});

describe("InitialOnboarding", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("starts with a welcome screen and advances to prerequisite checks", async () => {
    await act(async () =>
      root.render(<InitialOnboarding {...createProps()} />),
    );
    expect(container.textContent).toContain("Briar에 오신 것을 환영해요.");
    expect(container.querySelector(".brand")).toBeNull();
    expect(container.querySelector(".initial-onboarding-header")).toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".initial-welcome-copy button")
        ?.click();
    });

    expect(container.textContent).toContain("먼저, 작업 환경을 준비할게요.");
    expect(container.textContent).not.toContain("git version 2.50.1");
    expect(container.textContent).not.toContain("codex-cli 1.0.0");
    expect(container.textContent?.match(/설치됨/g)).toHaveLength(2);
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    expect(
      container.querySelectorAll(".initial-prerequisite-check.checked"),
    ).toHaveLength(2);
    expect(container.textContent).not.toContain(
      "코드를 이해하고 작업을 실행하는 에이전트",
    );
    expect(container.textContent?.match(/선택/g)).toHaveLength(4);
    expect(container.textContent).not.toContain("Velen");
    expect(
      container.querySelectorAll(
        ".initial-prerequisites-list .initial-prerequisite-row",
      ),
    ).toHaveLength(4);
    expect(
      container.querySelector(
        ".initial-prerequisites-content .initial-prerequisites-progress",
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        ".initial-prerequisites-layout > .initial-prerequisites-visual img",
      ),
    ).not.toBeNull();
  });

  it("shows next when at least one tool is installed", async () => {
    const props = createProps();
    await act(async () => root.render(<InitialOnboarding {...props} />));
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".initial-welcome-copy button")
        ?.click();
    });

    const continueButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("다음"));
    expect(continueButton?.disabled).toBe(false);

    await act(async () => continueButton?.click());
    expect(container.querySelector(".embedded-login-shell")).not.toBeNull();
    expect(container.textContent).toContain("Google로 계속하기");
    expect(
      container
        .querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow"),
    ).toBe("3");

    const googleButton =
      container.querySelector<HTMLButtonElement>(".google-button");
    await act(async () => googleButton?.click());
    expect(props.onLogin).toHaveBeenCalledOnce();
  });

  it("accepts Claude as the installed coding agent", async () => {
    vi.mocked(inspectOnboardingPrerequisites).mockResolvedValueOnce({
      git: {
        installed: true,
        version: "git version 2.50.1",
        authenticated: true,
      },
      codex: {
        installed: false,
        version: null,
        authenticated: false,
      },
      claude: {
        installed: true,
        version: "2.1.218",
        authenticated: true,
      },
      grok: {
        installed: false,
        version: null,
        authenticated: false,
      },
    });
    await act(async () =>
      root.render(<InitialOnboarding {...createProps()} />),
    );
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".initial-welcome-copy button")
        ?.click();
    });

    const continueButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("다음"));
    expect(container.textContent).toContain("Claude Code");
    expect(continueButton?.disabled).toBe(false);
  });

  it("allows installing later when no tools are installed", async () => {
    vi.mocked(inspectOnboardingPrerequisites).mockResolvedValueOnce({
      git: { installed: false, version: null, authenticated: false },
      codex: { installed: false, version: null, authenticated: false },
      claude: { installed: false, version: null, authenticated: false },
      grok: { installed: false, version: null, authenticated: false },
    });
    const props = createProps();
    await act(async () => root.render(<InitialOnboarding {...props} />));
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".initial-welcome-copy button")
        ?.click();
    });

    const installLaterButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("나중에 설치하기"));
    expect(installLaterButton?.disabled).toBe(false);

    await act(async () => installLaterButton?.click());
    expect(container.querySelector(".embedded-login-shell")).not.toBeNull();
    expect(container.textContent).toContain("Google로 계속하기");
  });

  it("cancels an in-progress login before returning to prerequisites", async () => {
    const props = {
      ...createProps(),
      loading: true,
      loginCode: "RZEHG4T5",
    };
    await act(async () => root.render(<InitialOnboarding {...props} />));
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".initial-welcome-copy button")
        ?.click();
    });
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("다음"))
        ?.click();
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".initial-login-back")
        ?.click();
    });
    expect(props.onCancelLogin).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("먼저, 작업 환경을 준비할게요.");
  });
});
