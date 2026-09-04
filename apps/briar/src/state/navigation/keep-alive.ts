import * as Option from "effect/Option";
import * as Atom from "effect/unstable/reactivity/Atom";

import { agentSessionAtom } from "../agent-sessions/atoms";
import { shallowArrayEqual } from "../entities/upsert";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../organization/atoms";
import { companionMode, demoMode, lockedTeamIdAtom } from "../platform";
import { tokenAtom, userAtom } from "../session/atoms";
import { activeTeamAtom, activeTeamIdAtom } from "../team/atoms";
import {
  activePageAtom,
  activeTeamForTabsAtom,
  companionPageAtom,
  requestedSessionIdAtom,
  settingsTargetAtom,
} from "./atoms";

/*
  Which pages survive being navigated away from.

  Every top level view used to unmount on a visit, so returning to the board
  rebuilt its whole subtree — hundreds of rows, their measurements and their
  scroll position — from nothing. That was the right shape while the views owned
  their data: an unmount was also how the app forgot a stale dashboard. It is
  not any more. The data lives in `state/`, so keeping a view alive costs the
  DOM it already built and the effects it already ran, and buys back the
  rebuild.

  Keeping *every* view alive would trade one cost for another, so this file is
  the policy rather than the mechanism: which pages are worth keeping, how many
  at once, and what makes the whole set stale. `components/app/KeepAliveSlot.tsx`
  is the mechanism, and it asks nothing except "is this key the one on screen".

  The policy is atoms and pure functions on purpose. "Three previously visited
  pages, evicted oldest first, dropped entirely when the account or the
  organization changes" is a rule about the app, not about React, and it is
  asserted here without rendering anything.
*/

/**
 * A page whose DOM is worth keeping. The board and the organization level lists
 * are the heavy ones: each builds a long list, and each is somewhere the user
 * walks back to within seconds. Settings, the organization create flow and the
 * per team pages beside the board are not here — they are cheap, and a settings
 * screen that keeps its scroll across a visit is not worth a kept DOM tree.
 */
export type KeepAlivePageKind =
  | "board"
  | "channels"
  | "dms"
  | "inbox"
  | "my-issues";

/**
 * A kept page and the scope it was built for.
 *
 * The scope is what stops a kept page from showing another team's rows. The
 * board is per team; the other four are per organization, including channels —
 * the channel views are one component per organization that switches channels
 * through a prop, so keying them by channel would build one kept DOM tree per
 * channel ever opened and none of them would be the one on screen.
 */
export interface KeptPage {
  readonly kind: KeepAlivePageKind;
  readonly scopeId: string;
}

/** The key a kept page is stored and rendered under. */
export const keptPageKey = (page: KeptPage): string =>
  `${page.kind}:${page.scopeId}`;

const sameKeptPage = (left: KeptPage | null, right: KeptPage | null): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.kind === right.kind &&
    left.scopeId === right.scopeId);

/**
 * How many previously visited pages stay alive beside the one on screen.
 *
 * Three covers the walks that actually happen — board to inbox and back, board
 * to a channel and back, a lap around the bottom of the sidebar — without
 * holding a DOM tree for every page an account has ever opened.
 */
export const KEPT_PAGE_LIMIT = 3;

/**
 * Moves `key` to the most recent end and drops whatever falls past the bound.
 * Returns `current` unchanged when the key is already the most recent one, so a
 * re-render that resolves the same page does not churn the atom.
 */
export function touchKeptPage(
  current: readonly string[],
  key: string,
  limit: number = KEPT_PAGE_LIMIT,
): readonly string[] {
  if (current.at(-1) === key) return current;
  const next = current.filter((candidate) => candidate !== key);
  next.push(key);
  return next.length > limit + 1 ? next.slice(next.length - (limit + 1)) : next;
}

/**
 * Which shell is mounted. A window runs one of them and never both, so this is
 * a constant of the running app like `lockedTeamIdAtom` — an atom only so that
 * tests can reach the companion chain without mocking the module.
 */
export const activeShellAtom = Atom.make<"companion" | "desktop">(
  companionMode ? "companion" : "desktop",
).pipe(Atom.keepAlive, Atom.withLabel("navigation/activeShell"));

/**
 * The kept page the desktop chain resolves to, or `null` when the page on
 * screen is one of the ones that unmounts on leave.
 *
 * The branches below are the guards of `DesktopPages`' own chain, in its order,
 * and that duplication is deliberate: the chain renders its kept pages by key
 * rather than inline, so something has to decide *which* key, and a page that
 * disagreed with the chain would render nothing at all. `DesktopPages.test.tsx`
 * walks every page and asserts the two agree.
 */
function resolveDesktopKeptPage(get: Atom.AtomContext): KeptPage | null {
  const page = get(activePageAtom);
  const settingsTarget = get(settingsTargetAtom);
  const organizationId = get(activeOrganizationIdAtom);
  const token = get(tokenAtom);
  const lockedTeamId = get(lockedTeamIdAtom);

  if (page === "organization-create") return null;
  if (
    page === "settings" &&
    settingsTarget.scope === "application" &&
    get(userAtom)
  ) {
    return null;
  }
  if (page === "settings" && settingsTarget.scope === "organization") {
    const target = settingsTarget.organizationId;
    const known = get(organizationsAtom).some(
      (organization) => organization.id === target,
    );
    if (known) return null;
  }
  if (page === "dms" && !lockedTeamId && organizationId) {
    return token ? { kind: "dms", scopeId: organizationId } : null;
  }
  if (page === "projects" && get(activeTeamForTabsAtom)) return null;
  if (page === "my-issues" && organizationId) {
    return { kind: "my-issues", scopeId: organizationId };
  }
  if (page === "inbox") return { kind: "inbox", scopeId: organizationId ?? "" };
  const activeTeam = get(activeTeamAtom);
  if (page === "settings" && settingsTarget.scope === "project" && activeTeam) {
    return null;
  }
  if (page === "lobby" && activeTeam) return null;
  if (page === "agents" && activeTeam) return null;
  if (page === "schedule" && activeTeam) return null;
  if (page === "channels" && organizationId && token) {
    return { kind: "channels", scopeId: organizationId };
  }
  return { kind: "board", scopeId: get(activeTeamIdAtom) ?? "" };
}

/**
 * The same question for the phone chain, whose kept pages are the same ones
 * minus "my issues" — the companion has no such screen — and whose open agent
 * session covers the page it was opened from.
 */
function resolveCompanionKeptPage(get: Atom.AtomContext): KeptPage | null {
  const requestedSessionId = get(requestedSessionIdAtom);
  if (requestedSessionId && get(agentSessionAtom(requestedSessionId))) {
    return null;
  }
  const page = get(companionPageAtom);
  if (page === "settings") return null;
  const organizationId = get(activeOrganizationIdAtom);
  const token = get(tokenAtom);
  if (page === "home" && organizationId && (token || demoMode)) {
    return { kind: "channels", scopeId: organizationId };
  }
  if (page === "lobby" && get(activeTeamAtom)) return null;
  if (page === "inbox") return { kind: "inbox", scopeId: organizationId ?? "" };
  if (page === "dms" && organizationId && token) {
    return { kind: "dms", scopeId: organizationId };
  }
  return { kind: "board", scopeId: get(activeTeamIdAtom) ?? "" };
}

/**
 * What makes every kept page stale at once.
 *
 * A kept page holds the rows of one account inside one organization, so a
 * different account or a different organization invalidates all of them —
 * including the ones whose key happens to survive, such as an inbox opened
 * before an organization resolved. The pinned window's team is here for the
 * same reason: a project window is scoped to one team for its whole life, and a
 * change to that scope means this is not the same window's content any more.
 */
function keptPageScope(get: Atom.AtomContext): string {
  return [
    get(userAtom)?.id ?? "",
    get(activeOrganizationIdAtom) ?? "",
    get(lockedTeamIdAtom) ?? "",
  ].join("|");
}

interface KeptPageContext {
  readonly page: KeptPage | null;
  readonly scope: string;
}

const sameKeptPageContext = (
  left: KeptPageContext,
  right: KeptPageContext,
): boolean => left.scope === right.scope && sameKeptPage(left.page, right.page);

/*
  The page on screen and the scope it belongs to, resolved together.

  Together is the point. Both answers come from the organization and the signed
  in account, so computing them in two atoms gives the history below two
  arrivals for one write — and it recorded the page it saw in between, which is
  the old organization's page filed under the new organization's scope. One atom
  over the same roots is one arrival and one consistent pair.
*/
const desktopKeptPageContextAtom = Atom.make(
  (get): KeptPageContext => ({
    page: resolveDesktopKeptPage(get),
    scope: keptPageScope(get),
  }),
).pipe(
  Atom.keepAlive,
  Atom.withEquality(sameKeptPageContext),
  Atom.withLabel("navigation/desktopKeptPageContext"),
);

const companionKeptPageContextAtom = Atom.make(
  (get): KeptPageContext => ({
    page: resolveCompanionKeptPage(get),
    scope: keptPageScope(get),
  }),
).pipe(
  Atom.keepAlive,
  Atom.withEquality(sameKeptPageContext),
  Atom.withLabel("navigation/companionKeptPageContext"),
);

/** The kept page the desktop chain resolves to. */
export const desktopKeptPageAtom = Atom.map(
  desktopKeptPageContextAtom,
  (context) => context.page,
).pipe(
  Atom.keepAlive,
  Atom.withEquality(sameKeptPage),
  Atom.withLabel("navigation/desktopKeptPage"),
);

/** The kept page the phone chain resolves to. */
export const companionKeptPageAtom = Atom.map(
  companionKeptPageContextAtom,
  (context) => context.page,
).pipe(
  Atom.keepAlive,
  Atom.withEquality(sameKeptPage),
  Atom.withLabel("navigation/companionKeptPage"),
);

const activeKeptPageContextAtom = Atom.make((get): KeptPageContext =>
  get(activeShellAtom) === "companion"
    ? get(companionKeptPageContextAtom)
    : get(desktopKeptPageContextAtom),
).pipe(
  Atom.keepAlive,
  Atom.withEquality(sameKeptPageContext),
  Atom.withLabel("navigation/activeKeptPageContext"),
);

/**
 * The kept page on screen, whichever shell is drawing it.
 *
 * Both shells read this rather than their own resolver, so the page a shell
 * draws and the history below can never name different things: they are the
 * same derivation.
 */
export const activeKeptPageAtom = Atom.map(
  activeKeptPageContextAtom,
  (context) => context.page,
).pipe(
  Atom.keepAlive,
  Atom.withEquality(sameKeptPage),
  Atom.withLabel("navigation/activeKeptPage"),
);

interface KeptPagesState {
  readonly keys: readonly string[];
  readonly scope: string;
}

/*
  The visit history of the kept pages, oldest first.

  It is derived rather than written by the shell so that nothing has to remember
  to record a visit: reading the page on screen is what records it. `get.self()`
  is this atom's own previous value, which is what makes an LRU out of a
  derivation, and `Atom.keepAlive` is what keeps that previous value around
  between visits. A scope change is read here rather than reset by a caller for
  the same reason — sign-out and an organization switch are already writes to
  atoms this one depends on.
*/
const keptPagesStateAtom = Atom.make((get): KeptPagesState => {
  const { page, scope } = get(activeKeptPageContextAtom);
  const previous = Option.getOrUndefined(get.self<KeptPagesState>());
  const kept =
    previous !== undefined && previous.scope === scope ? previous.keys : [];
  const keys = page === null ? kept : touchKeptPage(kept, keptPageKey(page));
  if (previous !== undefined && previous.scope === scope && previous.keys === keys) {
    return previous;
  }
  return { keys, scope };
}).pipe(Atom.keepAlive, Atom.withLabel("navigation/keptPagesState"));

/** The kept page keys currently alive, oldest first. */
export const keptPageKeysAtom = Atom.map(
  keptPagesStateAtom,
  (state) => state.keys,
).pipe(
  Atom.keepAlive,
  Atom.withEquality<readonly string[]>(shallowArrayEqual),
  Atom.withLabel("navigation/keptPageKeys"),
);

/**
 * Whether the kept page under `key` is the one on screen.
 *
 * The slot does not need this — React's `<Activity>` unmounts a hidden page's
 * effects on its own — but anything *inside* a kept page that has to know
 * whether it is being looked at does, and so do the tests that pin the policy.
 */
export const pageVisibleAtom = Atom.family((key: string) =>
  Atom.map(
    activeKeptPageAtom,
    (page) => page !== null && keptPageKey(page) === key,
  ).pipe(Atom.withLabel(`navigation/pageVisible/${key}`)),
);
