/** Detail tabs shown on the shared issue page (desktop, Tauri iOS/Android). */
export type IssueDetailTab =
  | "description"
  | "result"
  | "agentActivity"
  | "statusHistory"
  | "evidence"
  | "conversation";

/**
 * Initial issue-detail tab when opening a run.
 * Completed and paused runs open on Result so the work outcome is immediate;
 * every other status opens on the issue description. Native iOS uses the same rule.
 */
export function defaultIssueDetailTab(
  status: string,
): Extract<IssueDetailTab, "description" | "result"> {
  return status === "completed" || status === "paused" ? "result" : "description";
}
