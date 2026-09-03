import { useEffect } from "react";

import { setIssueActionBridge } from "./issues/actions";
import { useRegistry } from "./registry";
import {
  setWorkspaceScheduleBridge,
  type WorkspaceScheduleBridge,
} from "./workspace/api";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";

/*
  The callbacks the registry-bound actions reach back into React for.

  Almost nothing needs one: an action reads the store through the registry and
  writes it back. What is left is `useAutoHuntSessions`, which owns agent
  session state that has not been converted to atoms — so the issue actions have
  to hand it a session an agent proposed, and the schedule poller has to hand it
  a run it claimed.

  They are installed after every render rather than passed as hook dependencies,
  for two reasons that both matter: the action objects keep one identity for the
  registry's lifetime, and the schedule poller is not restarted by a re-render —
  a restart re-claims, which is what could run one scheduled job twice.
*/

export interface ActionBridges extends WorkspaceScheduleBridge {
  /** Adopts a session an agent started on the server. */
  readonly adoptRemoteAgentSession?:
    | ((session: AutoHuntSession) => void)
    | undefined;
}

export function useActionBridges({
  adoptRemoteAgentSession,
  settleScheduledAgentSession,
  startScheduledAgentSession,
  startScheduledAgentWorkerDispatch,
}: ActionBridges): void {
  const registry = useRegistry();
  // No dependency array: the callbacks are rebuilt on every render of the
  // component that owns them, and installing the latest is the point.
  useEffect(() => {
    setIssueActionBridge(registry, { adoptRemoteAgentSession });
    setWorkspaceScheduleBridge(registry, {
      settleScheduledAgentSession,
      startScheduledAgentSession,
      startScheduledAgentWorkerDispatch,
    });
  });
}
