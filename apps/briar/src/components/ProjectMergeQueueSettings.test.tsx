/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import type { MergeQueueProfile, Project } from "../types";
import {
  ProjectMergeQueueSettings,
  type ProjectMergeQueueSettingsApi,
} from "./ProjectMergeQueueSettings";

const project: Project = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Briar",
  role: "owner",
  createdAt: "2026-08-21T00:00:00.000Z",
};
const profile: MergeQueueProfile = {
  projectId: project.id,
  repositoryId: 701,
  repository: "wordbricks/briar",
  baseBranch: "main",
  enabled: false,
  readinessStageId: "ci_qa",
  quietWindowMs: 300_000,
  maxBatchSize: 5,
  updatedAt: "2026-08-21T00:00:00.000Z",
};
const stages = [
  { id: "reviewing", label: "Review", required: true, evidence: [] },
  { id: "ci_qa", label: "CI", required: true, evidence: [] },
];

describe("ProjectMergeQueueSettings", () => {
  let container: HTMLDivElement;
  let api: ProjectMergeQueueSettingsApi;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.setItem("briar.locale.v1", "ko");
    container = document.createElement("div");
    document.body.append(container);
    api = {
      load: vi.fn(async () => ({ profile })),
      update: vi.fn(async () => ({
        profile: {
          ...profile,
          enabled: true,
          readinessStageId: "reviewing",
        },
      })),
    };
  });

  afterEach(() => {
    container.remove();
    localStorage.removeItem("briar.locale.v1");
    vi.clearAllMocks();
  });

  it("loads a profile and saves enabled plus the selected workflow stage", async () => {
    const onProfileChange = vi.fn();
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <I18nProvider>
          <ProjectMergeQueueSettings
            api={api}
            githubRepositoryConnected
            onProfileChange={onProfileChange}
            project={project}
            stages={stages}
            token="session-token"
          />
        </I18nProvider>,
      );
    });

    expect(api.load).toHaveBeenCalledWith(
      "session-token",
      project.id,
    );
    const stage = container.querySelector<HTMLButtonElement>(
      '[role="combobox"][aria-label="병렬 작업 경계"]',
    )!;
    const toggle = container.querySelector<HTMLButtonElement>(
      '[role="switch"]',
    )!;
    expect(stage.textContent).toContain("CI");
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      stage.click();
    });
    const reviewOption = [...document.querySelectorAll<HTMLButtonElement>(
      '[role="option"]',
    )].find((option) => option.textContent?.includes("Review"))!;
    await act(async () => {
      reviewOption.click();
      toggle.click();
    });
    const save = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("저장"))!;
    expect(save.disabled).toBe(false);

    await act(async () => save.click());
    expect(api.update).toHaveBeenCalledWith(
      "session-token",
      project.id,
      { enabled: true, readinessStageId: "reviewing" },
    );
    expect(onProfileChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enabled: true,
        readinessStageId: "reviewing",
      }),
    );

    await act(async () => root.unmount());
  });
});
