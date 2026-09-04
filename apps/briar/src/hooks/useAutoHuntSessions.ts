import { useAtomValue } from "@effect/atom-react";
import { useMemo } from "react";

import { agentSessionsAtom } from "../state/agent-sessions/atoms";
import { useAgentSessionActions } from "../state/agent-sessions/actions";

/*
  What is left of the hook that owned agent sessions.

  The state is `state/agent-sessions` now: the sessions are normalized atoms,
  the writes are registry-bound actions, and the transports are mounted by
  `AppEffects`. This is the facade the shell still calls while its consumers are
  moved onto those atoms one at a time, and it is deleted with the last of them.

  The types and the pure helpers are re-exported because most of the modules
  that import this one only ever wanted those.
*/

export type {
  AutoHuntSession,
  AutoHuntSessionEvent,
  AutoHuntSessionEventType,
  AutoHuntSessionFollowUp,
  AutoHuntSessionIssue,
  AutoHuntSessionIssueOutcome,
  AutoHuntSessionStatus,
} from "../types";

export {
  applyProjectAgentSessionSync,
  canStopAutoHuntSession,
  collapseLinkedAutoHuntSessions,
  isRemoteAutoHuntTaskSession,
  mergeSynchronizedSessions,
  reconcileWorkerDispatchSession,
} from "../state/agent-sessions/model";

export function useAutoHuntSessions() {
  const sessions = useAtomValue(agentSessionsAtom);
  const actions = useAgentSessionActions();
  return useMemo(
    () => ({ ...actions, removeProjectSessions: actions.removeTeamSessions, sessions }),
    [actions, sessions],
  );
}
