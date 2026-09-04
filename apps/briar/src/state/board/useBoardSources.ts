import { useEffect } from "react";

import type { ProjectAgent } from "../../types";
import { useRegistry } from "../registry";
import { boardAgentsAtom } from "./run-facts";

/**
 * Publishes the one board input that is still React state into the store, so
 * each card can derive its own agent from it.
 *
 * The agents come from `useIssueAgents`, which loads them per team and
 * remembers the ones a dispatch just started; the sessions they are matched
 * against are atoms since follow-up F3. Writing from an effect means a card's
 * agent badge appears on the commit after the list arrives, which is what
 * already happened: the list is loaded over the network well after the board's
 * first paint.
 */
export function useBoardSources(agents: readonly ProjectAgent[]) {
  const registry = useRegistry();
  useEffect(() => {
    registry.set(boardAgentsAtom, agents);
  }, [agents, registry]);
}
