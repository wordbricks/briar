import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildStatusTrayItems,
  buildStatusTraySnapshot,
  statusLabelForRun,
  syncStatusTray,
} from "./status-tray";
import type { HuntRun } from "../types";
import { repositoryWorkflowBootstrap } from "./auto-hunt-contract";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

vi.mock("./platform", () => ({
  isMacDesktopTauri: () => true,
}));

afterEach(() => {
  invoke.mockReset();
  vi.unstubAllGlobals();
});

function run(partial: Partial<HuntRun> & Pick<HuntRun, "id" | "title" | "status">): HuntRun {
  return {
    runNumber: 1,
    currentAttempt: 1,
    currentRevision: 1,
    source: "issue",
    sourceKey: `issue:${partial.id}`,
    workflowStage: partial.workflowStage ?? "implementing",
    workflow: partial.workflow ?? {
      ...repositoryWorkflowBootstrap,
      stages: [
        { id: "analyzing", label: "분석", required: true },
        { id: "implementing", label: "구현", required: true },
      ],
      execution: { pauseAfterStage: "implementing" },
      completion: { requiredStages: ["analyzing", "implementing"] },
    },
    progress: 0.4,
    detail: null,
    priority: null,
    repository: "briar",
    branch: null,
    commitSha: null,
    tracker: null,
    issueDescription: null,
    attachments: [],
    resultSummary: null,
    structuredResult: null,
    pullRequestUrls: [],
    targetSha: null,
    sourceCreatedAt: null,
    stagingQaStatus: null,
    productionQaStatus: null,
    stagingQaDetail: null,
    productionQaDetail: null,
    context: null,
    claimedBy: null,
    claimedAt: null,
    leaseExpiresAt: null,
    claimAttempts: 0,
    startedAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T01:00:00.000Z",
    completedAt: null,
    lastEventAt: "2026-08-03T01:00:00.000Z",
    eventCount: 1,
    ...partial,
  };
}

describe("status tray snapshot builders", () => {
  it("keeps only running issues sorted by most recent activity", () => {
    const items = buildStatusTrayItems(
      [
        run({
          id: "older",
          title: "Older running",
          status: "running",
          updatedAt: "2026-08-03T01:00:00.000Z",
        }),
        run({
          id: "done",
          title: "Completed",
          status: "completed",
          workflowStage: null,
          updatedAt: "2026-08-03T03:00:00.000Z",
        }),
        run({
          id: "newer",
          title: "Newer running",
          status: "running",
          workflowStage: "analyzing",
          updatedAt: "2026-08-03T02:00:00.000Z",
        }),
      ],
      { id: "project-1", name: "briar" },
    );

    expect(items.map((item) => item.runId)).toEqual(["newer", "older"]);
    expect(items[0]).toMatchObject({
      projectId: "project-1",
      projectName: "briar",
      title: "Newer running",
      statusLabel: "분석",
    });
  });

  it("uses workflow stage labels for running issues", () => {
    expect(
      statusLabelForRun(
        run({
          id: "r1",
          title: "t",
          status: "running",
          workflowStage: "implementing",
        }),
      ),
    ).toBe("구현");
  });

  it("prefers localized status labels when provided", () => {
    expect(
      statusLabelForRun(
        run({
          id: "r1",
          title: "t",
          status: "running",
          workflowStage: "implementing",
        }),
        () => "Implement",
      ),
    ).toBe("Implement");
  });

  it("builds a snapshot payload for the native tray command", () => {
    const snapshot = buildStatusTraySnapshot(
      [
        {
          projectId: "p",
          runId: "r",
          title: "Issue",
          statusLabel: "리뷰",
          projectName: "briar",
        },
      ],
      {
        runningLabel: "실행 중",
        emptyLabel: "실행 중인 이슈 없음",
        openLabel: "Briar 열기",
        quitLabel: "Briar 종료",
        moreLabel: "Briar에서 +{count}개 더 보기",
      },
    );

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.runningLabel).toBe("실행 중");
  });

  it("invokes the native sync command on macOS desktop", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const snapshot = buildStatusTraySnapshot([], {
      runningLabel: "Running",
      emptyLabel: "None",
      openLabel: "Open",
      quitLabel: "Quit",
      moreLabel: "+{count} more in Briar",
    });

    await syncStatusTray(snapshot);

    expect(invoke).toHaveBeenCalledWith("sync_status_tray", { snapshot });
  });
});
