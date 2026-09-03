import * as Atom from "effect/unstable/reactivity/Atom";

import { demoDashboard } from "../../lib/demo-data";
import type { OrganizationMember } from "../../types";
import { demoMode } from "../platform";
import { shallowArrayEqual } from "./upsert";

/*
  Organization members normalized by user id, with one id index per team.

  Members are organization scoped but arrive on the team dashboard payload, so
  the index is keyed by team: it is the membership list that team's payload
  described. `null` means the payload omitted the projection.
*/

const demoTeamId = demoMode ? demoDashboard.team.id : null;
const demoMembers = demoDashboard.members ?? [];

/** Every known organization member, keyed by user id. */
export const membersByIdAtom = Atom.make<ReadonlyMap<string, OrganizationMember>>(
  demoMode
    ? new Map(demoMembers.map((member) => [member.userId, member]))
    : new Map(),
).pipe(Atom.keepAlive, Atom.withLabel("entities/members"));

/** One member, or `null` when they are not in the store. */
export const memberAtom = Atom.family((userId: string) =>
  Atom.map(membersByIdAtom, (members) => members.get(userId) ?? null).pipe(
    Atom.withLabel(`entities/members/${userId}`),
  ),
);

/** A team payload's member user ids, or `null` when it carried none. */
export const teamMemberIdsAtom = Atom.family((teamId: string) =>
  Atom.make<string[] | null>(
    teamId === demoTeamId && demoDashboard.members
      ? demoMembers.map((member) => member.userId)
      : null,
  ).pipe(
    Atom.keepAlive,
    Atom.withEquality<string[] | null>(shallowArrayEqual),
    Atom.withLabel(`entities/members/team/${teamId}/ids`),
  ),
);

/** A team payload's members resolved against the store, or `null` when absent. */
export const teamMembersAtom = Atom.family((teamId: string) =>
  Atom.make((get): OrganizationMember[] | null => {
    const ids = get(teamMemberIdsAtom(teamId));
    if (!ids) return null;
    const members = get(membersByIdAtom);
    const resolved: OrganizationMember[] = [];
    for (const id of ids) {
      const member = members.get(id);
      if (member) resolved.push(member);
    }
    return resolved;
  }).pipe(
    Atom.withEquality<OrganizationMember[] | null>(shallowArrayEqual),
    Atom.withLabel(`entities/members/team/${teamId}`),
  ),
);
