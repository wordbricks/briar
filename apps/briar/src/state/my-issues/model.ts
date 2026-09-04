import { formatIssueKey } from "../../lib/issue-key";
import type { HuntRun, Project } from "../../types";

/*
  The rules "내 이슈" narrows and groups by, as pure functions.

  They were inline `useMemo`s over a `Record<projectId, DashboardPayload>` the
  page held, which is what made every run edit anywhere in the organization
  rebuild the whole list. The derived atoms in `./atoms.ts` apply the same rules
  over the normalized store; nothing here reads an atom.
*/

/** Which of the four scope tabs a row belongs to. */
export type MyIssueScope = "assigned" | "created" | "subscribed" | "activity";

/** The buckets the list view draws, in the order it draws them. */
export type MyIssuesGroupKey = "urgent" | "triage" | "backlog" | "completed";

export const myIssuesGroupOrder: readonly MyIssuesGroupKey[] = [
  "urgent",
  "triage",
  "backlog",
  "completed",
];

/** The bucket one run falls into. */
export function myIssuesGroupForRun(run: HuntRun): MyIssuesGroupKey {
  if (["blocked", "failed", "paused"].includes(run.status) || run.priority === 1) {
    return "urgent";
  }
  if (run.status === "backlog") return "backlog";
  if (["completed", "cancelled"].includes(run.status)) return "completed";
  return "triage";
}

/**
 * Whether a run is one of `userId`'s at all. The page lists what the account
 * created or was assigned; the scope tabs narrow that further.
 */
export function runBelongsToUser(run: HuntRun, userId: string | null) {
  if (!userId) return false;
  return run.createdByUserId === userId || run.assigneeUserId === userId;
}

/** Whether a run of the account's survives the selected scope tab. */
export function runMatchesMyIssueScope(
  run: HuntRun,
  scope: MyIssueScope,
  userId: string | null,
) {
  if (scope === "created") return run.createdByUserId === userId;
  if (scope === "subscribed") {
    return Boolean(
      run.subscribers?.some((subscriber) => subscriber.userId === userId),
    );
  }
  return true;
}

/**
 * The text the page's search box matches against. It differs from the board's
 * (`state/board/filters.ts`) in two ways the page needs: the project name is
 * part of it, because the list spans projects, and the repository is not.
 */
export function myIssuesSearchText(
  run: HuntRun,
  project: Pick<Project, "name" | "issueKeyPrefix"> | null,
) {
  return [
    project?.name,
    formatIssueKey(project?.issueKeyPrefix, run.runNumber),
    run.title,
    run.detail,
    run.issueDescription,
    run.sourceKey,
  ]
    .filter(Boolean)
    .join(" ");
}
