import { invoke } from "@tauri-apps/api/core";
import { isMacDesktopTauri } from "./platform";
import type { StatusTrayRun } from "../types";

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

export const STATUS_TRAY_OPEN_RUN_EVENT = "status-tray-open-run";

export function statusLabelForRun(
  run: StatusTrayRun,
  localize?: (fallback: string, run: StatusTrayRun) => string,
): string {
  const fallback = run.workflowStageLabel?.trim() || "Running";
  return localize ? localize(fallback, run) : fallback;
}

export function buildStatusTrayItems(
  runs: readonly StatusTrayRun[],
  options?: {
    localizeStatus?: (fallback: string, run: StatusTrayRun) => string;
    untitledTitle?: string;
  },
): StatusTrayRunItem[] {
  const untitledTitle = options?.untitledTitle ?? "Untitled issue";
  return runs
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
      projectId: run.projectId,
      runId: run.id,
      title: run.title?.trim() || untitledTitle,
      statusLabel: statusLabelForRun(run, options?.localizeStatus),
      projectName: run.projectName,
    }));
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
