import * as Atom from "effect/unstable/reactivity/Atom";

import { commands } from "../../generated/tauri";
import { loadStatusTrayRuns } from "../../lib/api";
import { DASHBOARD_POLL_INTERVAL_MS } from "../../lib/dashboard-polling";
import { isDesktopTauri, isMacDesktopTauri } from "../../lib/platform";
import { syncStatusTray } from "../../lib/status-tray";
import type { StatusTrayRun } from "../../types";
import { teamRunsAtom } from "../entities/runs";
import { teamEntityAtom } from "../entities/teams";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { lockedTeamIdAtom } from "../platform";
import { tokenAtom } from "../session/atoms";
import { activeTeamIdAtom } from "../team/atoms";

/*
  The macOS menu bar tray's own state.

  The tray is not a view: nothing on screen renders `statusTrayRuns`, and the
  organization poll behind it runs on the dashboard's interval whether or not
  anyone is looking. That is exactly the shape a subscription atom is for — it
  starts when something first observes it and stops through its finalizer when
  the last observer goes away, instead of living for as long as a component
  happens to be mounted.
*/

/** Everything the tray reaches outside the store, so a test can supply it. */
export interface StatusTrayApi {
  readonly loadStatusTrayRuns: typeof loadStatusTrayRuns;
  readonly syncStatusTray: typeof syncStatusTray;
  readonly syncExecutionWorkerLabels: () => Promise<unknown>;
  /** The tray only exists in the packaged macOS app. */
  readonly macDesktop: boolean;
  /** Worker labels are refreshed on any desktop build. */
  readonly desktop: boolean;
  readonly pollIntervalMs: number;
}

export const liveStatusTrayApi: StatusTrayApi = {
  loadStatusTrayRuns,
  syncStatusTray,
  syncExecutionWorkerLabels: () => commands.syncExecutionWorkerLabels(),
  macDesktop: isMacDesktopTauri(),
  desktop: isDesktopTauri(),
  pollIntervalMs: DASHBOARD_POLL_INTERVAL_MS,
};

export const statusTrayApiAtom = Atom.make<StatusTrayApi>(liveStatusTrayApi).pipe(
  Atom.keepAlive,
  Atom.withLabel("statusTray/api"),
);

/**
 * Every run the tray lists: the open team's, kept current by the dashboard, and
 * every other team's, refreshed by {@link statusTrayPollAtom}.
 */
export const statusTrayRunsAtom = Atom.make<StatusTrayRun[]>([]).pipe(
  Atom.keepAlive,
  Atom.withLabel("statusTray/runs"),
);

/** The tray's share of one team's board. */
export interface ActiveTeamTrayRuns {
  readonly teamId: string;
  readonly runs: readonly StatusTrayRun[];
}

const sameTrayRuns = (
  left: ActiveTeamTrayRuns | null,
  right: ActiveTeamTrayRuns | null,
) =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.teamId === right.teamId &&
    left.runs.length === right.runs.length &&
    left.runs.every((run, index) => {
      const other = right.runs[index]!;
      return (
        run.id === other.id &&
        run.teamId === other.teamId &&
        run.teamName === other.teamName &&
        run.title === other.title &&
        run.workflowStage === other.workflowStage &&
        run.workflowStageLabel === other.workflowStageLabel &&
        run.startedAt === other.startedAt &&
        run.updatedAt === other.updatedAt &&
        run.lastEventAt === other.lastEventAt
      );
    }));

/**
 * The selected team's running runs in the tray's own shape, or `null` before
 * that team has a payload.
 *
 * It is a projection rather than a slice of the board because the tray prints
 * nine fields of a running run and nothing else: an edit to a run that is not
 * running, or to a field the tray does not print, produces an equal list and
 * therefore no notification at all.
 */
export const activeTeamTrayRunsAtom = Atom.make(
  (get): ActiveTeamTrayRuns | null => {
    const teamId = get(activeTeamIdAtom);
    if (teamId === null) return null;
    const team = get(teamEntityAtom(teamId));
    const runs = get(teamRunsAtom(teamId));
    if (!team || !runs) return null;
    return {
      teamId: team.id,
      runs: runs
        .filter((run) => run.status === "running")
        .map((run) => ({
          teamId: team.id,
          teamName: team.name,
          id: run.id,
          title: run.title,
          status: "running" as const,
          workflowStage: run.workflowStage,
          workflowStageLabel:
            run.workflow.stages.find((stage) => stage.id === run.workflowStage)
              ?.label ?? null,
          startedAt: run.startedAt,
          updatedAt: run.updatedAt,
          lastEventAt: run.lastEventAt,
        })),
    };
  },
).pipe(
  Atom.keepAlive,
  Atom.withEquality(sameTrayRuns),
  Atom.withLabel("statusTray/activeTeamRuns"),
);

/**
 * How long the poll keeps running after the last observer unmounts. A few
 * seconds, so a re-render that briefly unmounts the tray does not restart the
 * request — and no longer, so a closed tray stops asking the server.
 */
export const STATUS_TRAY_POLL_IDLE_TTL_MS = 5_000;

/**
 * The organization-wide tray poll, as a subscription rather than an effect.
 *
 * Observing it starts the loop; the finalizer aborts the request in flight and
 * clears the timer. A project window has one team and no tray, and a build
 * without the macOS tray has nothing to push to, so both leave the list empty
 * and start nothing.
 */
export const statusTrayPollAtom = Atom.make((get) => {
  const api = get(statusTrayApiAtom);
  const lockedTeamId = get(lockedTeamIdAtom);
  const token = get(tokenAtom);
  const organizationId = get(activeOrganizationIdAtom);
  const registry = get.registry;

  registry.set(statusTrayRunsAtom, []);
  if (!api.macDesktop || lockedTeamId || !token || !organizationId) {
    return false;
  }

  let cancelled = false;
  let timer: number | null = null;
  let request: AbortController | null = null;

  const refresh = async () => {
    request = new AbortController();
    try {
      const result = await api.loadStatusTrayRuns(
        token,
        organizationId,
        request.signal,
      );
      if (!cancelled) registry.set(statusTrayRunsAtom, result.runs);
    } catch {
      // Keep the last known tray projection across transient network errors.
    } finally {
      request = null;
      if (!cancelled) {
        timer = window.setTimeout(() => void refresh(), api.pollIntervalMs);
      }
    }
  };

  get.addFinalizer(() => {
    cancelled = true;
    request?.abort();
    if (timer !== null) window.clearTimeout(timer);
  });

  void refresh();
  return true;
}).pipe(
  Atom.setIdleTTL(STATUS_TRAY_POLL_IDLE_TTL_MS),
  Atom.withLabel("statusTray/poll"),
);
