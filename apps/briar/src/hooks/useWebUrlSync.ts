import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useEffect, useRef } from "react";

import {
  pageFromNavigationLocation,
  projectIdFromNavigationLocation,
  runIdFromNavigationLocation,
  type AppNavigationLocation,
} from "../lib/app-navigation";
import { formatIssueKey } from "../lib/issue-key";
import {
  parseWebAppIssueKeyPath,
  parseWebAppIssuePath,
  parseWebAppPagePath,
  type BriarLinkTarget,
} from "../lib/issue-links";
import { webMode } from "../state/platform";
import { runsByIdAtom } from "../state/entities/runs";
import {
  navigationHistoryAtom,
  pendingBriarLinkAtom,
} from "../state/navigation/atoms";
import { teamsAtom } from "../state/team/atoms";
import type { HuntRun, Team } from "../types";

/*
  Keeps the web app's address bar honest.

  The app navigates through an internal visit stack that used to leave the URL
  frozen at whatever the first load requested, so copying the address bar,
  opening it in a new tab or reloading never returned to the card on screen.
  In web mode this hook mirrors the current location into the URL: an issue
  card gets its canonical card-number path (/app/issues/BR-42), every other
  page gets /app/<page>. Reading is the mirror image — a link opened cold or a
  popstate becomes a pending deep link the resolver in useDeepLinks routes.

  Desktop and mobile keep their deep-link schemes and never touch the URL.
*/

/** The path a navigation location should show, or null to leave the URL alone. */
export function urlPathForLocation(
  location: AppNavigationLocation,
  runsById: ReadonlyMap<string, HuntRun>,
  teams: readonly Team[],
): string | null {
  const runId = runIdFromNavigationLocation(location);
  if (runId) {
    const run = runsById.get(runId);
    // The card is not in the store yet; writing anything would stomp the very
    // URL the resolver is working from, so wait for the run to arrive.
    if (!run) return null;
    const teamId = projectIdFromNavigationLocation(location) ?? run.teamId;
    const team = teams.find((candidate) => candidate.id === teamId);
    return `/app/issues/${formatIssueKey(team?.issueKeyPrefix, run.runNumber)}`;
  }
  const page = pageFromNavigationLocation(location);
  return page ? `/app/${page}` : null;
}

export function webUrlTargetFromPathname(
  pathname: string,
): BriarLinkTarget | null {
  const issue = parseWebAppIssuePath(pathname);
  if (issue) return { kind: "issue", ...issue };
  const issueKey = parseWebAppIssueKeyPath(pathname);
  if (issueKey) return { kind: "issueKey", issueKey };
  const page = parseWebAppPagePath(pathname);
  return page ? { kind: "page", page } : null;
}

export function useWebUrlSync(): void {
  const history = useAtomValue(navigationHistoryAtom);
  const runsById = useAtomValue(runsByIdAtom);
  const teams = useAtomValue(teamsAtom);
  const pendingLink = useAtomValue(pendingBriarLinkAtom);
  const setPendingLink = useAtomSet(pendingBriarLinkAtom);
  const previousIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (!webMode || typeof window === "undefined") return;
    const onPopState = () => {
      const target = webUrlTargetFromPathname(window.location.pathname);
      if (target) setPendingLink(target);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [setPendingLink]);

  useEffect(() => {
    if (!webMode || typeof window === "undefined") return;
    // A link is still resolving; its URL is the source of truth until then.
    if (pendingLink) return;
    const location = history.entries[history.index];
    if (!location) return;
    const path = urlPathForLocation(location, runsById, teams);
    if (!path) {
      previousIndexRef.current = history.index;
      return;
    }
    const previousIndex = previousIndexRef.current;
    previousIndexRef.current = history.index;
    if (window.location.pathname === path) return;
    const pushed =
      previousIndex !== null && history.index > previousIndex;
    if (pushed) {
      window.history.pushState(null, "", path);
    } else {
      window.history.replaceState(null, "", path);
    }
  }, [history, runsById, teams, pendingLink]);
}
