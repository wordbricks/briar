import * as Atom from "effect/unstable/reactivity/Atom";

import type { Organization } from "../../types";
import { demoOrganization } from "../demo-fixtures";
import { demoMode } from "../platform";

/*
  The organizations the signed-in account belongs to, and which one the app is
  currently scoped to. Teams, channels and members all hang off the active
  organization, so this pair is read almost everywhere and written only by the
  organization actions and the session bootstrap.
*/

/** Every organization the account is a member of. */
export const organizationsAtom = Atom.make<Organization[]>(
  demoMode ? [demoOrganization] : [],
).pipe(Atom.keepAlive, Atom.withLabel("organization/list"));

/**
 * The organization the app is scoped to. A project window pins this to the
 * locked team's organization, so `useBriar` seeds it per registry rather than
 * relying on the module default.
 */
export const activeOrganizationIdAtom = Atom.make<string | null>(
  demoMode ? demoOrganization.id : null,
).pipe(Atom.keepAlive, Atom.withLabel("organization/activeId"));

/**
 * The active organization resolved against the list. The result is an element
 * of `organizationsAtom`, never a fresh object, so subscribers are notified
 * only when the selected organization itself changes.
 */
export const activeOrganizationAtom = Atom.make((get) => {
  const activeOrganizationId = get(activeOrganizationIdAtom);
  if (!activeOrganizationId) return null;
  return (
    get(organizationsAtom).find(
      (organization) => organization.id === activeOrganizationId,
    ) ?? null
  );
}).pipe(Atom.keepAlive, Atom.withLabel("organization/active"));
