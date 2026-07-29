/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSlackInstallUrl,
  loadSlackIntegration,
  updateSlackInstallation,
} from "../lib/api";
import { openExternalUrl } from "../lib/auth-session";
import { SlackIntegrationSettings } from "./SlackIntegrationSettings";

vi.mock("../lib/api", () => ({
  createSlackInstallUrl: vi.fn(),
  disconnectSlackInstallation: vi.fn(),
  loadSlackIntegration: vi.fn(),
  updateSlackInstallation: vi.fn(),
}));
vi.mock("../lib/auth-session", () => ({
  openExternalUrl: vi.fn(),
}));

describe("SlackIntegrationSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadSlackIntegration).mockResolvedValue({
      configured: true,
      canManage: true,
      projects: [
        { id: "project-1", name: "Web" },
        { id: "project-2", name: "API" },
      ],
      installations: [
        {
          teamId: "T123",
          teamName: "Briar Labs",
          botUserId: "U123",
          defaultProjectId: "project-1",
          defaultProjectName: "Web",
          createdAt: "2026-07-29T00:00:00.000Z",
          updatedAt: "2026-07-29T00:00:00.000Z",
        },
      ],
    });
    vi.mocked(createSlackInstallUrl).mockResolvedValue({
      installUrl: "https://slack.com/oauth/v2/authorize?state=state",
    });
    vi.mocked(openExternalUrl).mockResolvedValue();
    vi.mocked(updateSlackInstallation).mockResolvedValue({
      installation: {
        teamId: "T123",
        teamName: "Briar Labs",
        botUserId: "U123",
        defaultProjectId: "project-2",
        defaultProjectName: "API",
        createdAt: "2026-07-29T00:00:00.000Z",
        updatedAt: "2026-07-29T00:01:00.000Z",
      },
    });
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("loads a workspace and starts OAuth with the selected project", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <SlackIntegrationSettings
          organizationId="organization-1"
          token="token"
        />,
      );
    });

    expect(loadSlackIntegration).toHaveBeenCalledWith(
      "token",
      "organization-1",
    );
    expect(container.textContent).toContain("Briar Labs");
    expect(container.textContent).toContain("연결됨");

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("Slack 워크스페이스 추가"))
        ?.click();
    });

    expect(createSlackInstallUrl).toHaveBeenCalledWith(
      "token",
      "organization-1",
      "project-1",
    );
    expect(openExternalUrl).toHaveBeenCalledWith(
      "https://slack.com/oauth/v2/authorize?state=state",
    );
    expect(container.textContent).toContain(
      "브라우저에서 Slack 설치를 완료한 뒤",
    );

    await act(async () => root.unmount());
    container.remove();
  });
});
