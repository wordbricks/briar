import { create } from "@bufbuild/protobuf";
import { EmptySchema, timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  ChannelReplySuccessSchema,
  CompleteChannelReplyRequestSchema,
  CompleteIssueReplyRequestSchema,
  DmMemorySaveRequestSchema,
  IssueReplySuccessSchema,
  PrepareReplyAttachmentUploadsRequestSchema,
  ReplyCompletionDisposition,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import type { ParsedChannelReplyAgentResult } from "../src/lib/channel-agent-reply-contract";
import type { IssueAgentReplyResult } from "../src/lib/agent-reply-contract";
import { uploadPreparedFiles } from "../src/lib/upload-client";
import {
  createWorkerQueueClient,
  type WorkerQueueClient,
  workClaimIdentityToProto,
} from "./worker-queue-client";
import type {
  ClaimedChannelReply,
  ClaimedIssueReply,
} from "./worker-queue-contract";

type ChannelReplyResult = ParsedChannelReplyAgentResult["result"];
type CompletionDisposition = "completed" | "requeued" | "failed";
export type ReplyCompletionQueueClient = Pick<
  WorkerQueueClient,
  | "prepareReplyAttachmentUploads"
  | "completeIssueReply"
  | "completeChannelReply"
>;

const retryableCodes = new Set([
  Code.DeadlineExceeded,
  Code.ResourceExhausted,
  Code.Internal,
  Code.Unavailable,
]);

const isRetryable = (error: unknown) =>
  !(error instanceof ConnectError) || retryableCodes.has(error.code);

const exactRpc = async <Value>(
  operation: () => Promise<Value>,
  signal?: AbortSignal,
) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (signal?.aborted || !isRetryable(error) || attempt === 2) throw error;
    }
  }
  throw lastError;
};

const disposition = (value: ReplyCompletionDisposition): CompletionDisposition => {
  switch (value) {
    case ReplyCompletionDisposition.COMPLETED: return "completed";
    case ReplyCompletionDisposition.REQUEUED: return "requeued";
    case ReplyCompletionDisposition.FAILED: return "failed";
    case ReplyCompletionDisposition.UNSPECIFIED:
    default:
      throw new Error("Worker reply completion returned an unknown disposition");
  }
};

const outcomeDisposition = (
  value: ReplyCompletionDisposition,
  outcome: "success" | "failure",
) => {
  const decoded = disposition(value);
  if (
    (outcome === "success" && decoded !== "completed") ||
    (outcome === "failure" && decoded === "completed")
  ) {
    throw new Error("Worker reply completion returned an invalid outcome disposition");
  }
  return decoded;
};

const requiredTimestamp = (
  value: Parameters<typeof timestampDate>[0] | undefined,
  field: string,
) => {
  if (!value) throw new Error(`Worker reply completion omitted ${field}`);
  const date = timestampDate(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Worker reply completion returned invalid ${field}`);
  }
  return date.toISOString();
};

const issueSuccess = (
  result: IssueAgentReplyResult,
  attachmentIds: readonly string[],
) => {
  const base = {
    body: result.body,
    attachments: attachmentIds.map((uploadId) => ({ uploadId })),
  };
  if (result.proposedAction) {
    switch (result.proposedAction.type) {
      case "request_issue_rework":
        return create(IssueReplySuccessSchema, {
          ...base,
          action: {
            case: "rework",
            value: {
              workflowStage: result.proposedAction.workflowStage,
              reason: result.proposedAction.reason,
            },
          },
        });
      case "request_issue_update": {
        const changes = result.proposedAction.changes;
        const description = (() => {
          if (!Object.prototype.hasOwnProperty.call(changes, "description")) {
            return { case: undefined } as const;
          }
          if (changes.description === null) {
            return {
              case: "clearDescription" as const,
              value: create(EmptySchema),
            };
          }
          if (changes.description === undefined) {
            throw new Error("Issue reply update description is undefined");
          }
          return { case: "setDescription" as const, value: changes.description };
        })();
        const priority = (() => {
          if (!Object.prototype.hasOwnProperty.call(changes, "priority")) {
            return { case: undefined } as const;
          }
          if (changes.priority === null) {
            return {
              case: "clearPriority" as const,
              value: create(EmptySchema),
            };
          }
          if (changes.priority === undefined) {
            throw new Error("Issue reply update priority is undefined");
          }
          return { case: "setPriority" as const, value: changes.priority };
        })();
        return create(IssueReplySuccessSchema, {
          ...base,
          action: {
            case: "update",
            value: {
              title: changes.title,
              description,
              priority,
            },
          },
        });
      }
      case "request_issue_create":
        return create(IssueReplySuccessSchema, {
          ...base,
          action: {
            case: "create",
            value: {
              issue: {
                title: result.proposedAction.issue.title,
                description: result.proposedAction.issue.description ?? undefined,
                priority: result.proposedAction.issue.priority ?? undefined,
              },
              executeAfterCreate: result.proposedAction.executeAfterCreate,
            },
          },
        });
    }
  }
  if (result.executionProposal) {
    return create(IssueReplySuccessSchema, {
      ...base,
      action: { case: "execution", value: {} },
    });
  }
  if (result.skillExecutionProposal) {
    return create(IssueReplySuccessSchema, {
      ...base,
      action: { case: "skillExecution", value: {} },
    });
  }
  return create(IssueReplySuccessSchema, base);
};

const channelSuccess = (
  result: ChannelReplyResult,
  conversationId: string | null,
  attachmentIds: readonly string[],
) => {
  const base = {
    body: result.body,
    conversationId: conversationId ?? undefined,
    attachments: attachmentIds.map((uploadId) => ({ uploadId })),
    memoryCitations: (result.memoryCitations ?? []).map((reference) => ({
      documentId: reference.documentId,
      version: reference.version,
    })),
    memorySaveRequest: result.memorySaveRequest
      ? create(DmMemorySaveRequestSchema, {
          documents: result.memorySaveRequest.documents.map((reference) => ({
            documentId: reference.documentId,
            version: reference.version,
          })),
        })
      : undefined,
  };
  const artifactProposalCount = [
    result.issueProposal,
    result.issueBatchProposal,
    result.executionProposal,
  ].filter(Boolean).length;
  if (
    artifactProposalCount > 1 ||
    (result.delegation &&
      (result.document || artifactProposalCount > 0 ||
        result.skillExecutionProposal)) ||
    (result.skillExecutionProposal &&
      (result.document || artifactProposalCount > 0))
  ) {
    throw new Error("Channel reply action variants are mutually exclusive");
  }
  if (result.delegation) {
    return create(ChannelReplySuccessSchema, {
      ...base,
      action: {
        case: "delegation",
        value: {
          projectId: result.delegation.projectId,
          agentId: result.delegation.agentId,
          request: result.delegation.request,
        },
      },
    });
  }
  if (result.skillExecutionProposal) {
    return create(ChannelReplySuccessSchema, {
      ...base,
      action: { case: "skillExecution", value: {} },
    });
  }
  if (
    result.document || result.issueProposal || result.issueBatchProposal ||
    result.executionProposal
  ) {
    const proposal = result.issueProposal
      ? {
          case: "issue" as const,
          value: {
            projectId: result.issueProposal.projectId ?? undefined,
            issue: {
              title: result.issueProposal.issue.title,
              description: result.issueProposal.issue.description ?? undefined,
              priority: result.issueProposal.issue.priority ?? undefined,
            },
            executeAfterCreate: result.issueProposal.executeAfterCreate,
          },
        }
      : result.issueBatchProposal
        ? {
            case: "issueBatch" as const,
            value: {
              projectId: result.issueBatchProposal.projectId ?? undefined,
              items: result.issueBatchProposal.batch.items.map((item) => ({
                key: item.key,
                issue: {
                  title: item.issue.title,
                  description: item.issue.description ?? undefined,
                  priority: item.issue.priority ?? undefined,
                },
              })),
              dependencies: result.issueBatchProposal.batch.dependencies,
            },
          }
        : result.executionProposal
          ? {
              case: "execution" as const,
              value: {
                projectId: result.executionProposal.projectId,
                runId: result.executionProposal.runId,
              },
            }
          : { case: undefined as undefined };
    return create(ChannelReplySuccessSchema, {
      ...base,
      action: {
        case: "artifacts",
        value: {
          document: result.document
            ? {
                title: result.document.title,
                markdown: result.document.markdown,
                projectId: result.document.projectId ?? undefined,
              }
            : undefined,
          proposal,
        },
      },
    });
  }
  return create(ChannelReplySuccessSchema, base);
};

export function createReplyCompletionClient(
  apiUrl: string,
  token: string,
  dependencies: {
    queue?: ReplyCompletionQueueClient;
    fetch?: typeof globalThis.fetch;
    randomUUID?: typeof crypto.randomUUID;
  } = {},
) {
  const queue = dependencies.queue ?? createWorkerQueueClient(apiUrl, token);
  const fetch = dependencies.fetch ?? globalThis.fetch;
  const randomUUID = dependencies.randomUUID ?? crypto.randomUUID;

  const prepareAttachments = async (input: {
    projectId: string;
    workerId: string;
    work: ClaimedIssueReply | ClaimedChannelReply;
    attachments: readonly File[];
    signal?: AbortSignal;
  }) => {
    if (input.attachments.length === 0) return [];
    const files = await Promise.all(input.attachments.map(async (file, index) => ({
      clientId: `attachment-${index + 1}`,
      file,
      digest: new Uint8Array(await crypto.subtle.digest(
        "SHA-256",
        await file.arrayBuffer(),
      )),
    })));
    const request = create(PrepareReplyAttachmentUploadsRequestSchema, {
      requestId: randomUUID(),
      projectId: input.projectId,
      workerId: input.workerId,
      work: workClaimIdentityToProto(input.work),
      attachments: files.map(({ clientId, file, digest }) => ({
        clientId,
        filename: file.name,
        contentType: file.type,
        byteSize: BigInt(file.size),
        sha256: digest,
      })),
    });
    const prepared = await exactRpc(
      () => queue.prepareReplyAttachmentUploads(request, {
        signal: input.signal,
      }),
      input.signal,
    );
    for (const upload of prepared.uploads) {
      requiredTimestamp(upload.expiresAt, "upload expiry");
    }
    return uploadPreparedFiles({
      apiUrl,
      files,
      uploads: prepared.uploads,
      uploadId: (upload) => upload.reference?.uploadId,
      fetch,
      signal: input.signal,
    });
  };

  return {
    completeIssueReply: async (input: {
      projectId: string;
      workerId: string;
      work: ClaimedIssueReply;
      signal?: AbortSignal;
    } & (
      | {
          outcome: {
            case: "success";
            result: IssueAgentReplyResult;
            attachments: readonly File[];
          };
        }
      | { outcome: { case: "failure"; error: string } }
    )) => {
      const attachmentIds = input.outcome.case === "success"
        ? await prepareAttachments({
            ...input,
            attachments: input.outcome.attachments,
          })
        : [];
      const request = create(CompleteIssueReplyRequestSchema, {
        requestId: randomUUID(),
        projectId: input.projectId,
        workerId: input.workerId,
        work: workClaimIdentityToProto(input.work),
        outcome: input.outcome.case === "success"
          ? {
              case: "success",
              value: issueSuccess(input.outcome.result, attachmentIds),
            }
          : {
              case: "failure",
              value: { error: input.outcome.error },
            },
      });
      const response = await exactRpc(
        () => queue.completeIssueReply(request, { signal: input.signal }),
        input.signal,
      );
      return {
        replayed: response.replayed,
        disposition: outcomeDisposition(
          response.disposition,
          input.outcome.case,
        ),
      };
    },

    completeChannelReply: async (input: {
      projectId: string;
      workerId: string;
      work: ClaimedChannelReply;
      signal?: AbortSignal;
    } & (
      | {
          outcome: {
            case: "success";
            result: ChannelReplyResult;
            conversationId: string | null;
            attachments: readonly File[];
          };
        }
      | { outcome: { case: "failure"; error: string } }
    )) => {
      const attachmentIds = input.outcome.case === "success"
        ? await prepareAttachments({
            ...input,
            attachments: input.outcome.attachments,
          })
        : [];
      const request = create(CompleteChannelReplyRequestSchema, {
        requestId: randomUUID(),
        projectId: input.projectId,
        workerId: input.workerId,
        work: workClaimIdentityToProto(input.work),
        outcome: input.outcome.case === "success"
          ? {
              case: "success",
              value: channelSuccess(
                input.outcome.result,
                input.outcome.conversationId,
                attachmentIds,
              ),
            }
          : {
              case: "failure",
              value: { error: input.outcome.error },
            },
      });
      const response = await exactRpc(
        () => queue.completeChannelReply(request, { signal: input.signal }),
        input.signal,
      );
      return {
        replayed: response.replayed,
        disposition: outcomeDisposition(
          response.disposition,
          input.outcome.case,
        ),
        retainedUntil: requiredTimestamp(response.retainedUntil, "retainedUntil"),
      };
    },
  };
}
