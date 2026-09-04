import { useEffect } from "react";

import type { AutoHuntSession, ProjectAgent } from "../../types";
import { useRegistry } from "../registry";
import { boardAgentsAtom, boardSessionsAtom } from "./run-facts";

/**
 * Publishes the two board inputs that are still React state into the store, so
 * each card can derive its own agent from them.
 *
 * The agents come from `useIssueAgents` and the sessions from
 * `useAutoHuntSessions`, both of which the plan leaves for a follow-up. Writing
 * them from an effect means a card's agent badge appears on the commit after
 * the list arrives, which is what already happened: both lists are loaded over
 * the network well after the board's first paint.
 */
export function useBoardSources(
  agents: readonly ProjectAgent[],
  sessions: readonly AutoHuntSession[],
) {
  const registry = useRegistry();
  useEffect(() => {
    registry.set(boardAgentsAtom, agents);
  }, [agents, registry]);
  useEffect(() => {
    registry.set(boardSessionsAtom, sessions);
  }, [registry, sessions]);
}
