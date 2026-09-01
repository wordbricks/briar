/** @vitest-environment jsdom */

import { act } from "react";
import type { Root } from "react-dom/client";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
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
  issueKeyPrefix: "BR",
  scheduleTabEnabled: true,
  icon: null,
  organizationId: "organization-1",
  organizationName: "Briar",
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
  validationCommands: ["bun run ci:local"],
  quietWindowMs: 300_000,
  maxBatchSize: 5,
  updatedAt: "2026-08-21T00:00:00.000Z",
};
const stages = [
  {
    id: "reviewing",
    label: "Review",
    required: true,
    evidence: [],
    checks: ["bun run check"],
  },
  {
    id: "ci_qa",
    label: "CI",
    required: true,
    evidence: [],
    checks: ["bun run ci:local"],
  },
];

describe("ProjectMergeQueueSettings", () => {
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let root: Root;
  let api: ProjectMergeQueueSettingsApi;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.setItem("briar.locale.v1", "ko");
    ({ cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    }));
    api = {
      load: vi.fn(async () => ({ profile })),
      loadStatus: vi.fn(async () => ({
        generatedAt: "2026-08-21T00:04:00.000Z",
        status: {
          batches: [{
            id: "33333333-3333-4333-8333-333333333333",
            state: "collecting" as const,
            candidateCount: 1,
            quietUntil: "2026-08-21T00:05:00.000Z",
            frozenAt: null,
            mergeGroupSha: null,
            failureCode: null,
            completedAt: null,
            createdAt: "2026-08-21T00:00:00.000Z",
            updatedAt: "2026-08-21T00:01:00.000Z",
          }],
          candidates: [{
            id: "candidate-1",
            batchId: null,
            runId: "run-1",
            pullRequestNumber: 1360,
            pullRequestUrl: "https://github.com/wordbricks/briar/pull/1360",
            state: "ready" as const,
            ordinal: null,
            readyAt: "2026-08-21T00:00:00.000Z",
            failureCode: null,
            updatedAt: "2026-08-21T00:01:00.000Z",
          }],
        },
      })),
      update: vi.fn(async () => ({
        profile: {
          ...profile,
          enabled: true,
          readinessStageId: "reviewing",
          validationCommands: ["bun run check"],
        },
      })),
    };
  });

  afterEach(async () => {
    await cleanup();
    localStorage.removeItem("briar.locale.v1");
    vi.clearAllMocks();
  });

  it("loads a profile and saves enabled plus the selected workflow stage", async () => {
    const onProfileChange = vi.fn();
    await renderReactTestRoot(
      root,
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

    expect(api.load).toHaveBeenCalledWith(
      "session-token",
      project.id,
    );
    expect(api.loadStatus).toHaveBeenCalledWith("session-token", project.id);
    expect(container.textContent).toContain("최근 batch");
    expect(container.textContent).toContain("수집 중");
    expect(container.textContent).toContain("PR #1360");
    expect(container.textContent).toContain("준비됨");
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

    const refresh = container.querySelector<HTMLButtonElement>(
      'button[aria-label="새로고침"]',
    )!;
    await act(async () => refresh.click());
    expect(api.loadStatus).toHaveBeenCalledTimes(2);

  });
});
