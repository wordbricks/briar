import * as Atom from "effect/unstable/reactivity/Atom";

import { commands } from "../../generated/tauri";
import type { MessageKey } from "../../i18n/messages";
import { loadStatusTrayRuns } from "../../lib/api";
import { DASHBOARD_POLL_INTERVAL_MS } from "../../lib/dashboard-polling";
import { isDesktopTauri, isMacDesktopTauri } from "../../lib/platform";
import {
  buildStatusTrayItems,
  buildStatusTraySnapshot,
  syncStatusTray,
} from "../../lib/status-tray";
import type { StatusTrayRun } from "../../types";
import { translatorAtom } from "../i18n/atoms";
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

/*
  The nine fields the tray prints. Comparing them rather than the objects is
  what keeps a run edit the tray does not show — or a poll that returned what
  the store already had — from pushing an identical snapshot to Rust.
*/
const sameTrayRun = (left: StatusTrayRun, right: StatusTrayRun) =>
  left.id === right.id &&
  left.teamId === right.teamId &&
  left.teamName === right.teamName &&
  left.title === right.title &&
  left.workflowStage === right.workflowStage &&
  left.workflowStageLabel === right.workflowStageLabel &&
  left.startedAt === right.startedAt &&
  left.updatedAt === right.updatedAt &&
  left.lastEventAt === right.lastEventAt;

const sameRunList = (
  left: readonly StatusTrayRun[],
  right: readonly StatusTrayRun[],
) =>
  left === right ||
  (left.length === right.length &&
    left.every((run, index) => sameTrayRun(run, right[index]!)));

/**
 * Every run the tray lists: the open team's, merged in by
 * {@link statusTrayTeamRunsAtom}, and every other team's, refreshed by
 * {@link statusTrayPollAtom}.
 *
 * The equality matters because two writers produce this list: the merge and the
 * poll can arrive at the same nine fields for the same runs, and without it the
 * second of them would push an identical snapshot to Rust.
 */
export const statusTrayRunsAtom = Atom.make<StatusTrayRun[]>([]).pipe(
  Atom.keepAlive,
  Atom.withEquality<StatusTrayRun[]>(sameRunList),
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
    sameRunList(left.runs, right.runs));

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
 *
 * It seeds from the open team rather than emptying the list. Clearing was the
 * flash: on a boot that hydrated a dashboard, or on any remount, this ran before
 * the merge below and the tray was pushed empty for one pass before the team's
 * running runs came back. The seed reads the projection through the registry
 * rather than `get`, so a run starting on the open team does not restart the
 * poll.
 */
export const statusTrayPollAtom = Atom.make((get) => {
  const api = get(statusTrayApiAtom);
  const lockedTeamId = get(lockedTeamIdAtom);
  const token = get(tokenAtom);
  const organizationId = get(activeOrganizationIdAtom);
  const registry = get.registry;

  const seed = registry.get(activeTeamTrayRunsAtom);
  registry.set(statusTrayRunsAtom, seed ? [...seed.runs] : []);
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
      if (cancelled) return;
      /*
        The organization's answer replaces every team's share of the list
        except the open one's, which the board keeps fresher than a poll on
        the dashboard interval can. Replacing the whole list was the other
        half of the flash: the first result dropped the runs the merge below
        had just put there, and nothing re-ran to bring them back.
      */
      const openTeamId = registry.get(activeTeamTrayRunsAtom)?.teamId ?? null;
      registry.update(statusTrayRunsAtom, (current) =>
        openTeamId === null
          ? [...result.runs]
          : [
              ...result.runs.filter((run) => run.teamId !== openTeamId),
              ...current.filter((run) => run.teamId === openTeamId),
            ],
      );
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

/*
  The three subscriptions that were `useStatusTray`'s effects.

  Two of them stayed in React because the localized snapshot needs `t`, which
  only a render could produce. `state/i18n` publishes the loaded catalog now, so
  all three read what they need from the store: the hook is the three
  `useAtomMount` calls and nothing else, and a tray update costs no render at
  all — not even of a component that returns `null`.

  Their mount order is their write order. `useStatusTray` mounts the poll (which
  seeds), then the merge (which folds the open team in), then the snapshot
  (which reads the result). The equality on `statusTrayRunsAtom` makes the merge
  a no-op when the seed already said the same thing, so the snapshot is pushed
  once.
*/

/**
 * Folds the open dashboard's running runs into the tray list, replacing that
 * team's share of it. Nothing else refreshes the open team: the poll's interval
 * is minutes and the board's own sync is seconds.
 */
export const statusTrayTeamRunsAtom = Atom.make((get) => {
  const api = get(statusTrayApiAtom);
  const lockedTeamId = get(lockedTeamIdAtom);
  const teamTrayRuns = get(activeTeamTrayRunsAtom);
  if (!api.macDesktop || lockedTeamId || !teamTrayRuns) return false;
  get.registry.update(statusTrayRunsAtom, (current) => [
    ...current.filter((run) => run.teamId !== teamTrayRuns.teamId),
    ...teamTrayRuns.runs,
  ]);
  return true;
}).pipe(
  Atom.setIdleTTL(STATUS_TRAY_POLL_IDLE_TTL_MS),
  Atom.withLabel("statusTray/teamRuns"),
);

/** The localized snapshot pushed to Rust, rebuilt when the list or the locale moves. */
export const statusTraySnapshotAtom = Atom.make((get) => {
  const api = get(statusTrayApiAtom);
  const lockedTeamId = get(lockedTeamIdAtom);
  const runs = get(statusTrayRunsAtom);
  const t = get(translatorAtom);
  if (!api.macDesktop || lockedTeamId) return false;

  const items = buildStatusTrayItems(runs, {
    untitledTitle: t("statusTray.untitledIssue"),
    localizeStatus: (fallback, run) => {
      if (run.status === "running" && run.workflowStage) {
        const stageKey = `stage.${run.workflowStage}` as MessageKey;
        const localized = t(stageKey);
        if (localized && localized !== stageKey) return localized;
        return run.workflowStageLabel ?? fallback;
      }
      const statusKey = `status.${run.status}` as MessageKey;
      const localized = t(statusKey);
      return localized && localized !== statusKey ? localized : fallback;
    },
  });
  void api
    .syncStatusTray(
      buildStatusTraySnapshot(items, {
        runningLabel: t("statusTray.running"),
        emptyLabel: t("statusTray.empty"),
        openLabel: t("statusTray.openBriar"),
        quitLabel: t("statusTray.quitBriar"),
        moreLabel: t("statusTray.more"),
      }),
    )
    .catch(() => {
      // Tray bridge may be unavailable outside the packaged macOS app.
    });
  return true;
}).pipe(
  Atom.setIdleTTL(STATUS_TRAY_POLL_IDLE_TTL_MS),
  Atom.withLabel("statusTray/snapshot"),
);

/** The desktop start's worker label refresh. Any desktop build, tray or not. */
export const statusTrayWorkerLabelsAtom = Atom.make((get) => {
  const api = get(statusTrayApiAtom);
  if (!api.desktop || get(lockedTeamIdAtom)) return false;
  void api.syncExecutionWorkerLabels().catch(() => {
    // Offline startup must not block the rest of the desktop app.
  });
  return true;
}).pipe(
  Atom.setIdleTTL(STATUS_TRAY_POLL_IDLE_TTL_MS),
  Atom.withLabel("statusTray/workerLabels"),
);
