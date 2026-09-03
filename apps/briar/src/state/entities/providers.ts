import * as Atom from "effect/unstable/reactivity/Atom";

import { demoDashboard } from "../../lib/demo-data";
import type { AgentProvider } from "../../lib/agent-provider";
import { demoMode } from "../platform";
import { shallowArrayEqual } from "./upsert";

/*
  The agent providers an organization has enabled, as the team dashboard payload
  reports them.

  `AgentProvider` is a string union, not an identified record, so there is no
  `Map<id, T>` worth keeping here: the list itself is the value. It still lives
  under `entities/` because it is one of the payload projections the normalized
  store owns, and because the reference preservation rule is the same one every
  other projection follows.
*/

const demoTeamId = demoMode ? demoDashboard.team.id : null;

/**
 * A team payload's organization providers, or `null` when the payload carried
 * none. The delta merge replaces the list wholesale, so there is no per-item
 * identity to preserve — only the list's own reference.
 */
export const teamOrganizationProvidersAtom = Atom.family((teamId: string) =>
  Atom.make<AgentProvider[] | null>(
    teamId === demoTeamId ? (demoDashboard.organizationProviders ?? null) : null,
  ).pipe(
    Atom.keepAlive,
    Atom.withEquality<AgentProvider[] | null>(shallowArrayEqual),
    Atom.withLabel(`entities/providers/team/${teamId}`),
  ),
);
