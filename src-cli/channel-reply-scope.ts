export type ChannelReplyScope =
  | { kind: "organization"; organizationId: string }
  | { kind: "project"; organizationId: string; projectId: string };

/**
 * Reject a mismatched Project Agent claim before allocating a worktree. One
 * physical device can run several project loops, so the local repository must
 * agree with both server-authenticated project fields.
 */
export function assertChannelReplyWorkspaceScope(
  reply: { projectId: string | null; scope: ChannelReplyScope },
  localProjectId: string,
) {
  if (reply.projectId !== null && reply.projectId !== localProjectId) {
    throw new Error(
      `Channel reply project ${reply.projectId} does not match local worker project ${localProjectId}`,
    );
  }
  if (
    reply.scope.kind === "project" &&
    reply.scope.projectId !== localProjectId
  ) {
    throw new Error("Channel reply scope does not match the local project");
  }
}
