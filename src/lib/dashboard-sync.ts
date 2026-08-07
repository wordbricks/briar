import type {
  DashboardDeltaPayload,
  DashboardPayload,
  ExecutionWorker,
  HuntRun,
  ChannelNotification,
  IssueConversationNotification,
} from "../types";

const sameValue = (left: unknown, right: unknown) =>
  left === right || JSON.stringify(left) === JSON.stringify(right);

const sameReferences = <T>(left: T[], right: T[]) =>
  left.length === right.length && left.every((item, index) => item === right[index]);

function preserveEqualEntities<T extends { id: string }>(
  current: T[],
  incoming: T[],
) {
  const currentById = new Map(current.map((item) => [item.id, item]));
  return incoming.map((item) => {
    const previous = currentById.get(item.id);
    return previous && sameValue(previous, item) ? previous : item;
  });
}

const orderedRuns = (runs: HuntRun[]) =>
  [...runs].sort((left, right) => {
    const leftTerminal = ["completed", "cancelled"].includes(left.status);
    const rightTerminal = ["completed", "cancelled"].includes(right.status);
    if (leftTerminal !== rightTerminal) return leftTerminal ? 1 : -1;
    return right.updatedAt.localeCompare(left.updatedAt);
  });

function mergeRuns(
  current: HuntRun[],
  changed: HuntRun[],
  deletedRunIds: string[],
) {
  if (changed.length === 0 && deletedRunIds.length === 0) return current;
  const deleted = new Set(deletedRunIds);
  const changedById = new Map(changed.map((run) => [run.id, run]));
  const merged = current.flatMap((run) => {
    if (deleted.has(run.id)) return [];
    const next = changedById.get(run.id);
    if (!next) return [run];
    changedById.delete(run.id);
    return [sameValue(run, next) ? run : next];
  });
  merged.push(...changedById.values());
  const ordered = orderedRuns(merged).slice(0, 200);
  return sameReferences(current, ordered) ? current : ordered;
}

function replaceEntities<T extends { id: string }>(current: T[], incoming: T[]) {
  const next = preserveEqualEntities(current, incoming);
  return sameReferences(current, next) ? current : next;
}

export type DashboardMergeResult = {
  dashboard: DashboardPayload;
  changed: boolean;
};

/**
 * Applies a server delta without cloning unchanged dashboard entities. Cursor
 * progress by itself intentionally does not produce a new React state value.
 */
export function mergeDashboardDelta(
  current: DashboardPayload,
  delta: DashboardDeltaPayload,
): DashboardMergeResult {
  const runs = mergeRuns(current.runs, delta.runs, delta.deletedRunIds);
  const workers = sameValue(current.workers ?? [], delta.workers)
    ? current.workers
    : replaceEntities<ExecutionWorker>(current.workers ?? [], delta.workers);
  const organizationProviders = sameValue(
    current.organizationProviders ?? [],
    delta.organizationProviders,
  )
    ? current.organizationProviders
    : delta.organizationProviders;
  const project = delta.project && !sameValue(current.project, delta.project)
    ? delta.project
    : current.project;
  const settings = delta.settings && !sameValue(current.settings, delta.settings)
    ? delta.settings
    : current.settings;
  const executionPolicy = delta.executionPolicy === undefined ||
      sameValue(current.executionPolicy, delta.executionPolicy)
    ? current.executionPolicy
    : delta.executionPolicy;
  const members = delta.members === undefined || sameValue(current.members ?? [], delta.members)
    ? current.members
    : delta.members;
  const conversationNotifications = delta.conversationNotifications === undefined
    ? current.conversationNotifications
    : replaceEntities<IssueConversationNotification>(
        current.conversationNotifications ?? [],
        delta.conversationNotifications,
      );
  const channelNotifications = delta.channelNotifications === undefined
    ? current.channelNotifications
    : replaceEntities<ChannelNotification>(
        current.channelNotifications ?? [],
        delta.channelNotifications,
      );

  const changed =
    runs !== current.runs ||
    workers !== current.workers ||
    organizationProviders !== current.organizationProviders ||
    project !== current.project ||
    settings !== current.settings ||
    executionPolicy !== current.executionPolicy ||
    members !== current.members ||
    conversationNotifications !== current.conversationNotifications ||
    channelNotifications !== current.channelNotifications;
  if (!changed) return { dashboard: current, changed: false };
  return {
    dashboard: {
      ...current,
      project,
      settings,
      runs,
      workers,
      organizationProviders,
      executionPolicy,
      members,
      conversationNotifications,
      channelNotifications,
      cursor: delta.cursor,
      generatedAt: delta.generatedAt,
    },
    changed: true,
  };
}
