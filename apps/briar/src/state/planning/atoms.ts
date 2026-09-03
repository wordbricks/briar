import * as Atom from "effect/unstable/reactivity/Atom";

import type { PlanningProject } from "../../types";
import { demoPlanningProject } from "../demo-fixtures";
import { demoMode } from "../platform";

/**
 * Planning projects across every team the account can open, flattened into one
 * list. Views filter by `teamId`; the list is replaced wholesale whenever the
 * team list or the session token changes.
 */
export const planningProjectsAtom = Atom.make<PlanningProject[]>(
  demoMode ? [demoPlanningProject] : [],
).pipe(Atom.keepAlive, Atom.withLabel("planning/list"));
