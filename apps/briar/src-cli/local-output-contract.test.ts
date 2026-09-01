import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { LocalWorkspace_Kind } from "@briar/contracts/gen/briar/local/v1/local_pb";
import {
  ClaimedIssuePayloadSchema,
  ClaimedIssueSchema,
  QueuedAttachmentSchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { describe, expect, it } from "vitest";
import {
  localClaimResult,
  localClaimResultJson,
} from "./local-output-contract";

const runId = "11111111-1111-4111-8111-111111111111";
const secret = `briar_claim_${"a".repeat(64)}`;
const attachment = create(QueuedAttachmentSchema, {
  id: "33333333-3333-4333-8333-333333333333",
  filename: "layout.png",
  contentType: "image/png",
  byteSize: 2_048,
  url: `/projects/project-1/runs/${runId}/attachments/attachment-1`,
});
const issue = create(ClaimedIssueSchema, {
  payload: create(ClaimedIssuePayloadSchema, {
    runId,
    runNumber: 13,
    currentAttempt: 2,
    currentRevision: 3,
    sourceKey: "BRIAR-13",
    title: "Render the attached layout",
    claimedBy: "briar-auto-hunt-runtime",
    claimedAt: timestampFromDate(new Date("2026-08-31T00:00:00.000Z")),
    leaseExpiresAt: timestampFromDate(new Date("2026-08-31T00:15:00.000Z")),
    claimAttempts: 1,
  }),
  attachments: [attachment],
  claimToken: secret,
});

describe("local CLI ProtoJSON", () => {
  it("cannot serialize the private claim token while preserving local overlays", () => {
    const result = localClaimResult({
      issue,
      attachments: [{
        attachment,
        localPath: "/tmp/briar/attachments/layout.png",
        downloadError: null,
      }],
      briarIssueUrl: `https://briar.example/issues/${runId}`,
      workspace: {
        type: "worktree",
        path: "/tmp/briar/worktrees/BRIAR-13",
        branch: "briar/BRIAR-13",
        baseRef: "origin/main",
        baseRefResolved: "refs/remotes/origin/main",
        baseSha: "a".repeat(40),
        reused: false,
        includedPaths: [".env.keys"],
      },
      workspaceError: "copied one ignored input with a warning",
    });

    expect(result.outcome.case).toBe("claimed");
    if (result.outcome.case !== "claimed") return;
    expect(result.outcome.value.payload?.runId).toBe(runId);
    expect(result.outcome.value.workspace?.kind).toBe(
      LocalWorkspace_Kind.WORKTREE,
    );
    expect(result.outcome.value.workspaceError).toBe(
      "copied one ignored input with a warning",
    );
    const json = localClaimResultJson(result);
    expect(json).not.toContain(secret);
    expect(json).not.toContain("claimToken");
  });
});
