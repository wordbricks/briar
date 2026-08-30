import { create, toJsonString } from "@bufbuild/protobuf";
import {
  LocalClaimedRunSchema,
  LocalClaimResultSchema,
  LocalNoWorkSchema,
  LocalQueuedAttachmentSchema,
  LocalWorkspace_Kind,
  LocalWorkspaceSchema,
  type LocalClaimResult,
} from "@briar/contracts/gen/briar/local/v1/local_pb";
import type {
  ClaimedIssue,
  QueuedAttachment,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import type { IssueWorktree } from "./worktree";

export type LocalClaimWorkspace =
  | ({ type: "worktree" } & IssueWorktree & { warning?: string })
  | { type: "current"; path: string }
  | null;

export type DownloadedQueuedAttachment = {
  attachment: QueuedAttachment;
  localPath: string | null;
  downloadError: string | null;
};

const workspaceMessage = (value: Exclude<LocalClaimWorkspace, null>) =>
  value.type === "current"
    ? create(LocalWorkspaceSchema, {
        kind: LocalWorkspace_Kind.CURRENT,
        path: value.path,
      })
    : create(LocalWorkspaceSchema, {
        kind: LocalWorkspace_Kind.WORKTREE,
        path: value.path,
        branch: value.branch,
        baseRef: value.baseRef,
        baseRefResolved: value.baseRefResolved,
        baseSha: value.baseSha,
        reused: value.reused,
        includedPaths: value.includedPaths,
        warning: value.warning,
      });

export function localNoWorkResult(): LocalClaimResult {
  return create(LocalClaimResultSchema, {
    outcome: { case: "noWork", value: create(LocalNoWorkSchema) },
  });
}

export function localClaimResult(input: {
  issue: ClaimedIssue;
  attachments: DownloadedQueuedAttachment[];
  briarIssueUrl: string;
  workspace: LocalClaimWorkspace;
  workspaceError: string | null;
}): LocalClaimResult {
  if (input.issue.payload === undefined) {
    throw new Error("Worker claim omitted issue payload");
  }
  return create(LocalClaimResultSchema, {
    outcome: {
      case: "claimed",
      value: create(LocalClaimedRunSchema, {
        payload: input.issue.payload,
        attachments: input.attachments.map((value) =>
          create(LocalQueuedAttachmentSchema, {
            attachment: value.attachment,
            localPath: value.localPath ?? undefined,
            downloadError: value.downloadError ?? undefined,
          })
        ),
        briarIssueUrl: input.briarIssueUrl,
        workspace: input.workspace ? workspaceMessage(input.workspace) : undefined,
        workspaceError: input.workspaceError ?? undefined,
      }),
    },
  });
}

export const localClaimResultJson = (value: LocalClaimResult) =>
  toJsonString(LocalClaimResultSchema, value);
