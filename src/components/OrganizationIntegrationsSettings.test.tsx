/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGithubInstallUrl,
  loadGithubIntegration,
  type GithubIntegration,
} from "../lib/api";
import { openExternalUrl } from "../lib/auth-session";
import { OrganizationIntegrationsSettings } from "./OrganizationIntegrationsSettings";

vi.mock("../lib/api", () => ({
  createGithubInstallUrl: vi.fn(),
  loadGithubIntegration: vi.fn(),
}));
vi.mock("../lib/auth-session", () => ({
  openExternalUrl: vi.fn(),
}));

const disconnected: GithubIntegration = {
  configured: true,
  canManage: true,
  connected: false,
  installationId: null,
  accountLogin: null,
  accountAvatarUrl: null,
  repositories: [],
  connectedAt: null,
};

const connected: GithubIntegration = {
  configured: true,
  canManage: true,
  connected: true,
  installationId: "1234",
  accountLogin: "briar-labs",
  accountAvatarUrl: "https://avatars.githubusercontent.com/u/1",
  repositories: [
    {
      id: "repository-1",
      owner: "briar-labs",
      name: "briar",
      fullName: "briar-labs/briar",
    },
  ],
  connectedAt: "2026-08-05T00:00:00.000Z",
};

describe("OrganizationIntegrationsSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadGithubIntegration).mockResolvedValue(disconnected);
    vi.mocked(createGithubInstallUrl).mockResolvedValue({
      installUrl: "https://github.com/apps/briar/installations/new?state=state",
    });
    vi.mocked(openExternalUrl).mockResolvedValue();
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("shows only GitHub and refreshes its status after browser authorization", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <OrganizationIntegrationsSettings
          organizationId="organization-1"
          token="token"
        />,
      );
    });

    expect(loadGithubIntegration).toHaveBeenCalledWith(
      "token",
      "organization-1",
    );
    expect(container.textContent).toContain("GitHub");
    expect(container.textContent).not.toContain("Slack");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-integration="github"]')
        ?.click();
    });
    expect(container.textContent).toContain("개요");
    expect(container.textContent).toContain("Enable");

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "Enable")
        ?.click();
    });

    expect(createGithubInstallUrl).toHaveBeenCalledWith(
      "token",
      "organization-1",
    );
    expect(openExternalUrl).toHaveBeenCalledWith(
      "https://github.com/apps/briar/installations/new?state=state",
    );
    expect(container.textContent).toContain("브라우저에서 GitHub 인증");

    vi.mocked(loadGithubIntegration).mockResolvedValue(connected);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("briar-labs");
    expect(container.textContent).toContain("briar-labs/briar");
    expect(container.textContent).toContain("연결됨");
    expect(container.textContent).not.toContain("브라우저에서 GitHub 인증");

    await act(async () => root.unmount());
    container.remove();
  });

  it("offers a manual connection refresh", async () => {
    vi.mocked(loadGithubIntegration).mockResolvedValue(connected);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <OrganizationIntegrationsSettings
          organizationId="organization-1"
          token="token"
        />,
      );
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-integration="github"]')
        ?.click();
    });

    vi.mocked(loadGithubIntegration).mockClear();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="GitHub 연결 새로고침"]',
        )
        ?.click();
    });
    expect(loadGithubIntegration).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });

  it("does not let an older disconnected refresh overwrite OAuth completion", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <OrganizationIntegrationsSettings
          organizationId="organization-1"
          token="token"
        />,
      );
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-integration="github"]')
        ?.click();
    });
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "Enable")
        ?.click();
    });

    let resolveOlderRefresh!: (value: GithubIntegration) => void;
    const olderRefresh = new Promise<GithubIntegration>((resolve) => {
      resolveOlderRefresh = resolve;
    });
    vi.mocked(loadGithubIntegration)
      .mockImplementationOnce(() => olderRefresh)
      .mockResolvedValueOnce(connected);

    act(() => window.dispatchEvent(new Event("focus")));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(container.textContent).toContain("briar-labs");
    expect(container.textContent).toContain("연결됨");

    await act(async () => {
      resolveOlderRefresh(disconnected);
      await olderRefresh;
    });
    expect(container.textContent).toContain("briar-labs");
    expect(container.textContent).toContain("연결됨");

    await act(async () => root.unmount());
    container.remove();
  });
});
