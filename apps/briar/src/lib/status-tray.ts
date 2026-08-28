import { isMacDesktopTauri } from "./platform";
import type { StatusTrayRun } from "../types";
import {
  commands,
  events,
  type StatusTrayOpenRunPayload,
  type StatusTrayRunItem,
  type StatusTraySnapshot,
} from "../generated/tauri";

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
  await commands.syncStatusTray(snapshot);
}

export function listenForStatusTrayOpenRun(
  onOpen: (payload: StatusTrayOpenRunPayload) => void,
): () => void {
  if (typeof window === "undefined" || !isMacDesktopTauri()) {
    return () => undefined;
  }

  let cancelled = false;
  let unlisten: (() => void) | undefined;

  void Promise.resolve()
    .then(() => {
      if (cancelled) return;
      return events.statusTrayOpenRun.listen((event) => {
        onOpen(event.payload);
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
