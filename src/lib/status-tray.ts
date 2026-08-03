import { invoke } from "@tauri-apps/api/core";
import { isMacDesktopTauri } from "./platform";
import { runMeta } from "./stages";
import type { HuntRun } from "../types";

export type StatusTrayRunItem = {
  projectId: string;
  runId: string;
  title: string;
  statusLabel: string;
  projectName: string;
};

export type StatusTraySnapshot = {
  runningLabel: string;
  emptyLabel: string;
  openLabel: string;
  quitLabel: string;
  moreLabel: string;
  items: StatusTrayRunItem[];
};

export type StatusTrayOpenRunPayload = {
  projectId: string;
  runId: string;
};

export type StatusTrayProjectRuns = {
  project: { id: string; name: string };
  runs: readonly HuntRun[];
};

export const STATUS_TRAY_OPEN_RUN_EVENT = "status-tray-open-run";

export function statusLabelForRun(
  run: HuntRun,
  localize?: (fallback: string, run: HuntRun) => string,
): string {
  const fallback = runMeta(run.status, run.workflowStage, run.workflow).label;
  return localize ? localize(fallback, run) : fallback;
}

export function buildStatusTrayItems(
  projectRuns: readonly StatusTrayProjectRuns[],
  options?: {
    localizeStatus?: (fallback: string, run: HuntRun) => string;
    untitledTitle?: string;
  },
): StatusTrayRunItem[] {
  const untitledTitle = options?.untitledTitle ?? "Untitled issue";
  return projectRuns.flatMap(({ project, runs }) =>
    runs
      .filter((run) => run.status === "running")
      .slice()
      .sort((left, right) => {
        const leftAt = Date.parse(
          left.updatedAt || left.startedAt || left.lastEventAt,
        );
        const rightAt = Date.parse(
          right.updatedAt || right.startedAt || right.lastEventAt,
        );
        return (
          (Number.isFinite(rightAt) ? rightAt : 0) -
          (Number.isFinite(leftAt) ? leftAt : 0)
        );
      })
      .map((run) => ({
        projectId: project.id,
        runId: run.id,
        title: run.title?.trim() || untitledTitle,
        statusLabel: statusLabelForRun(run, options?.localizeStatus),
        projectName: project.name,
      })),
  );
}

export function buildStatusTraySnapshot(
  items: readonly StatusTrayRunItem[],
  labels: Omit<StatusTraySnapshot, "items">,
): StatusTraySnapshot {
  return {
    ...labels,
    items: [...items],
  };
}

export async function syncStatusTray(
  snapshot: StatusTraySnapshot,
): Promise<void> {
  if (typeof window === "undefined") return;
  if (!isMacDesktopTauri()) return;
  if (!window.__TAURI_INTERNALS__) return;
  await invoke("sync_status_tray", { snapshot });
}

export function listenForStatusTrayOpenRun(
  onOpen: (payload: StatusTrayOpenRunPayload) => void,
): () => void {
  if (typeof window === "undefined" || !isMacDesktopTauri()) {
    return () => undefined;
  }

  let cancelled = false;
  let unlisten: (() => void) | undefined;

  void import("@tauri-apps/api/event")
    .then(({ listen }) => {
      if (cancelled) return;
      return listen<StatusTrayOpenRunPayload>(STATUS_TRAY_OPEN_RUN_EVENT, (event) => {
        const payload = event.payload;
        if (
          !payload ||
          typeof payload.projectId !== "string" ||
          typeof payload.runId !== "string"
        ) {
          return;
        }
        onOpen(payload);
      });
    })
    .then((dispose) => {
      if (!dispose) return;
      if (cancelled) {
        dispose();
        return;
      }
      unlisten = dispose;
    })
    .catch(() => {
      // Non-desktop or missing event bridge must not break the UI.
    });

  return () => {
    cancelled = true;
    unlisten?.();
  };
}
