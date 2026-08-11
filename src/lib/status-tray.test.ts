import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildStatusTrayItems,
  buildStatusTraySnapshot,
  statusLabelForRun,
  syncStatusTray,
} from "./status-tray";
import type { StatusTrayRun } from "../types";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

vi.mock("./platform", () => ({
  isMacDesktopTauri: () => true,
}));

afterEach(() => {
  invoke.mockReset();
  vi.unstubAllGlobals();
});

function run(
  partial: Partial<StatusTrayRun> & Pick<StatusTrayRun, "id" | "title">,
): StatusTrayRun {
  return {
    projectId: "project-1",
    projectName: "Briar",
    status: "running",
    workflowStage: partial.workflowStage ?? "implementing",
    workflowStageLabel: partial.workflowStageLabel ?? "구현",
    startedAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T01:00:00.000Z",
    lastEventAt: "2026-08-03T01:00:00.000Z",
    ...partial,
  };
}

describe("status tray snapshot builders", () => {
  it("sorts running issue projections by most recent activity", () => {
    const items = buildStatusTrayItems([
      run({
        id: "older",
        title: "Older running",
        updatedAt: "2026-08-03T01:00:00.000Z",
      }),
      run({
        id: "newer",
        title: "Newer running",
        workflowStage: "analyzing",
        workflowStageLabel: "분석",
        updatedAt: "2026-08-03T02:00:00.000Z",
      }),
    ]);

    expect(items.map((item) => item.runId)).toEqual(["newer", "older"]);
    expect(items[0]).toMatchObject({
      projectId: "project-1",
      projectName: "Briar",
      title: "Newer running",
      statusLabel: "분석",
    });
  });

  it("includes running issues from every project and keeps project groups separate", () => {
    const items = buildStatusTrayItems([
      run({ id: "briar-run", title: "Briar issue" }),
      run({
        id: "crane-run",
        title: "Crane issue",
        projectId: "project-2",
        projectName: "Crane",
      }),
    ]);

    expect(
      items.map(({ projectId, projectName, runId }) => ({
        projectId,
        projectName,
        runId,
      })),
    ).toEqual([
      { projectId: "project-1", projectName: "Briar", runId: "briar-run" },
      { projectId: "project-2", projectName: "Crane", runId: "crane-run" },
    ]);
  });

  it("uses workflow stage labels for running issues", () => {
    expect(
      statusLabelForRun(
        run({
          id: "r1",
          title: "t",
          workflowStage: "implementing",
          workflowStageLabel: "구현",
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
          workflowStage: "implementing",
          workflowStageLabel: "구현",
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
