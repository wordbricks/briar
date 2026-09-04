import * as Atom from "effect/unstable/reactivity/Atom";

import type {
  ExecutionWorker,
  OrganizationMember,
  ProjectAgent,
} from "../../types";
import { teamAgentSessionsAtom } from "../agent-sessions/atoms";
import { teamMembersAtom } from "../entities/members";
import { runAtom } from "../entities/runs";
import { shallowArrayEqual } from "../entities/upsert";
import { teamWorkersAtom } from "../entities/workers";
import { splitBoardKey } from "./atoms";

/*
  The facts a card shows that are not on the run.

  The board computed all three in one `useMemo` over the whole run list, so a
  single run edit rebuilt the agent maps for every card. Each card asks for its
  own run's facts here instead, and each atom's equality stops at the value the
  card renders: the same agent, worker or member reference means no
  notification, whatever else moved in the store.

  The sessions come from `state/agent-sessions`. The agents still come from a
  React hook — `useIssueAgents` loads them per team and remembers the ones a
  dispatch just started — so the board publishes those into the atom below and
  everything downstream is derived.
*/

/** Every agent the shell has loaded, across teams. Published by the board. */
export const boardAgentsAtom = Atom.make<readonly ProjectAgent[]>([]).pipe(
  Atom.keepAlive,
  Atom.withEquality<readonly ProjectAgent[]>(shallowArrayEqual),
  Atom.withLabel("board/agents"),
);

/** The agent a run is labelled with, and the one working on it right now. */
export interface RunAgentAssociation {
  readonly active: ProjectAgent | null;
  readonly performed: ProjectAgent | null;
}

const noAgents: RunAgentAssociation = { active: null, performed: null };

const sameAssociation = (
  left: RunAgentAssociation,
  right: RunAgentAssociation,
) => left.active === right.active && left.performed === right.performed;

/*
  A run's own `agentId` names the agent that performed it, but it only counts as
  *active* while the run is in flight — this is the list of statuses the board
  treated as "not working right now".
*/
const idleStatuses = [
  "backlog",
  "queued",
  "completed",
  "cancelled",
  "paused",
  "blocked",
  "failed",
];

/** What the sessions of one team say about the runs they touched. */
interface SessionAgentIndex {
  readonly active: ReadonlyMap<string, ProjectAgent>;
  readonly performed: ReadonlyMap<string, ProjectAgent>;
}

/**
 * The team's sessions folded into two run-id lookups. Newest session first and
 * first write wins, which is how the board resolved two sessions that touched
 * the same run.
 */
export const teamSessionAgentIndexAtom = Atom.family((teamId: string) =>
  Atom.make((get): SessionAgentIndex => {
    const agentById = new Map(
      get(boardAgentsAtom).map((agent) => [agent.id, agent] as const),
    );
    const active = new Map<string, ProjectAgent>();
    const performed = new Map<string, ProjectAgent>();
    const recent = [...get(teamAgentSessionsAtom(teamId))].sort(
      (left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt),
    );
    for (const session of recent) {
      if (!session.agentId) continue;
      const agent = agentById.get(session.agentId);
      if (!agent) continue;
      for (const issue of session.issues) {
        if (!performed.has(issue.runId)) performed.set(issue.runId, agent);
        if (
          session.status === "running" &&
          issue.outcome === "pending" &&
          !active.has(issue.runId)
        ) {
          active.set(issue.runId, agent);
        }
      }
    }
    return { active, performed };
  }).pipe(Atom.withLabel(`board/${teamId}/sessionAgents`)),
);

/**
 * One run's agents, keyed by `boardRunKey` because the answer depends on the
 * team whose sessions are being consulted.
 */
export const runAgentAssociationAtom = Atom.family((key: string) => {
  const [teamId, runId] = splitBoardKey(key);
  return Atom.make((get): RunAgentAssociation => {
    const run = get(runAtom(runId));
    if (!run) return noAgents;
    const sessionIndex = get(teamSessionAgentIndexAtom(teamId));
    const ownAgent = run.agentId
      ? get(boardAgentsAtom).find((agent) => agent.id === run.agentId) ?? null
      : null;
    return {
      active:
        ownAgent && !idleStatuses.includes(run.status)
          ? ownAgent
          : sessionIndex.active.get(run.id) ?? null,
      performed: ownAgent ?? sessionIndex.performed.get(run.id) ?? null,
    };
  }).pipe(
    Atom.withEquality<RunAgentAssociation>(sameAssociation),
    Atom.withLabel(`board/${teamId}/run/${runId}/agents`),
  );
});

/**
 * The worker a run is running on, falling back to the one it asked for. Both
 * ids are optional, and an id the team's worker list does not hold reads as no
 * worker — the two chained lookups the card did inline.
 */
export const runAssignedWorkerAtom = Atom.family((key: string) => {
  const [teamId, runId] = splitBoardKey(key);
  return Atom.make((get): ExecutionWorker | null => {
    const run = get(runAtom(runId));
    if (!run) return null;
    const workers = get(teamWorkersAtom(teamId));
    if (!workers) return null;
    return (
      workers.find((worker) => worker.id === run.workerId) ??
      workers.find((worker) => worker.id === run.requestedWorkerId) ??
      null
    );
  }).pipe(Atom.withLabel(`board/${teamId}/run/${runId}/worker`));
});

/** The member a run is assigned to, resolved against the team's member list. */
export const runAssigneeAtom = Atom.family((key: string) => {
  const [teamId, runId] = splitBoardKey(key);
  return Atom.make((get): OrganizationMember | null => {
    const run = get(runAtom(runId));
    if (!run?.assigneeUserId) return null;
    return (
      get(teamMembersAtom(teamId))?.find(
        (member) => member.userId === run.assigneeUserId,
      ) ?? null
    );
  }).pipe(Atom.withLabel(`board/${teamId}/run/${runId}/assignee`));
});
