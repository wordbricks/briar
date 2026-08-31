import { maxIssueAttachmentCount } from "../../src/lib/issue-attachments";
import {
  isIssueAttachmentReference,
  issueAttachmentReferences,
} from "../../src/lib/issue-markdown";
import { processArchiveCleanupQueue } from "./archive";
import {
  completeIssueResultReview,
  createIssueDependency,
  deleteIssue,
  deleteIssueDependency,
  getHuntRunForProject,
  getProjectSettings,
  getProject,
  listIssueAttachments,
  listIssueSubscriptions,
  subscribeIssue,
  unsubscribeIssue,
  updateIssueCheckpoints,
  updateIssueExecutionPreferences,
  recordHuntEvent,
} from "./db";
import { HttpError } from "./http-response";
import { issueAttachmentJson } from "./issue-conversation-json";
import {
  findIssueCreateMutationReceipt,
  findIssueCreateAggregateId,
  findIssueUpdateMutationReceipt,
  issueAttachmentInsertStatements,
  issueCreateMutationReceiptStatement,
  updateIssueMutationStatements,
} from "./issue-create-update-repository";
import {
  issueAttachmentUploadConsumeStatements,
  resolveIssueAttachmentUploads,
} from "./issue-attachment-upload-repository";
import { hasOrganizationCapability } from "./organization-access";
import {
  decodeExecutionPreferences,
  decodeIssueInput,
  decodeIssueKeptAttachmentIds,
  decodeIssueUpdateInput,
} from "./issue-request-contract";
import { sha256 } from "./crypto-digest";
import { listProjectMembers } from "./organization-repository";
import { schedulePostCommitCleanup } from "./post-commit-cleanup";
import { decodeIssueCheckpointsInput } from "./run-request-contract";

async function requireIssueAssigneeMembership(
  db: D1Database,
  projectId: string,
  assigneeUserId: string | null | undefined,
) {
  if (!assigneeUserId) return;
  const members = await listProjectMembers(db, projectId);
  if (!members.some((member) => member.user_id === assigneeUserId)) {
    throw new HttpError(
      400,
      "Assignee must have access to the project",
    );
  }
}

const validateAttachmentReferences = (references: readonly string[]) => {
  if (
    references.length > maxIssueAttachmentCount ||
    new Set(references).size !== references.length ||
    !references.every(isIssueAttachmentReference)
  ) {
    throw new HttpError(400, "Attachment references are invalid");
  }
  return [...references];
};

const issueMutationConflict = (identity: "issue ID" | "update request ID") =>
  new HttpError(409, `${identity} was already used with a different request`);

const storedMutationResponse = <A>(responseJson: string): A =>
  JSON.parse(responseJson) as A;

type CreateProjectIssueResult = {
  runId: string;
  sourceKey: string;
  stage: "queued";
  status: ReturnType<typeof decodeIssueInput>["status"];
  assigneeUserId: string | null;
  createdByUserId: string;
  difficulty: ReturnType<typeof decodeIssueInput>["difficulty"];
  attachments: ReturnType<typeof issueAttachmentJson>[];
};

export type IssueCreateAttribution = {
  sourceKey: string;
  actor: string;
  detail: string;
  context: Readonly<Record<string, unknown>>;
};

type UpdateProjectIssueResult = {
  runId: string;
  title: string;
  description: string | null;
  priority: number | null;
  difficulty: ReturnType<typeof decodeIssueUpdateInput>["difficulty"];
  assigneeUserId: string | null;
  attachments: ReturnType<typeof issueAttachmentJson>[];
};

type IssueCoreApplicationInput = {
  db: D1Database;
  projectId: string;
  userId: string;
};

async function requireIssueProject(
  input: IssueCoreApplicationInput,
  capability: "issues:execute" | "issues:write" | "organization:read" |
    "results:review",
  deniedMessage: string,
) {
  const project = await getProject(input.db, input.projectId, input.userId);
  if (!project) throw new HttpError(404, "Project not found");
  if (!hasOrganizationCapability(project.member_role, capability)) {
    throw new HttpError(403, deniedMessage);
  }
  return project;
}

export async function createProjectIssue(
  input: IssueCoreApplicationInput & {
    request: unknown;
    clientIssueId: string;
    attachmentIds: readonly string[];
    attribution?: IssueCreateAttribution;
  },
): Promise<CreateProjectIssueResult> {
  const project = await requireIssueProject(
    input,
    "issues:write",
    "Issue editing permission required",
  );
  const issue = decodeIssueInput(input.request);
  const canonicalIssue = {
    ...issue,
    description: issue.description ?? null,
    priority: issue.priority ?? null,
    assigneeUserId: issue.assigneeUserId ?? null,
    preferredProvider: issue.preferredProvider ?? null,
    preferredModel: issue.preferredModel ?? null,
    preferredEffort: issue.preferredEffort ?? null,
  };
  const attribution = input.attribution ?? {
    sourceKey: `briar-issue:${input.clientIssueId}`,
    actor: "briar-app",
    detail: canonicalIssue.status === "backlog"
      ? "Briar 앱에서 생성된 이슈가 백로그에 추가되었습니다."
      : "Briar 앱에서 생성된 이슈가 처리를 기다리고 있습니다.",
    context: { origin: "briar-app" },
  };
  const sourceKey = attribution.sourceKey;
  const attachmentIds = validateAttachmentReferences(input.attachmentIds);
  const requestHash = await sha256(JSON.stringify({
    projectId: project.id,
    organizationId: project.organization_id,
    userId: input.userId,
    clientIssueId: input.clientIssueId,
    issue: canonicalIssue,
    attachmentIds,
    attribution,
  }));
  const existingReceipt = await findIssueCreateMutationReceipt(
    input.db,
    input.clientIssueId,
  );
  if (existingReceipt) {
    if (
      existingReceipt.organization_id !== project.organization_id ||
      existingReceipt.project_id !== project.id ||
      existingReceipt.user_id !== input.userId ||
      existingReceipt.request_hash !== requestHash
    ) {
      throw issueMutationConflict("issue ID");
    }
    return storedMutationResponse(existingReceipt.response_json);
  }
  if (await findIssueCreateAggregateId(input.db, {
    projectId: project.id,
    clientIssueId: input.clientIssueId,
    sourceKey,
  })) {
    throw new HttpError(409, "Issue aggregate exists without its mutation receipt");
  }
  await requireIssueAssigneeMembership(
    input.db,
    project.id,
    canonicalIssue.assigneeUserId,
  );
  const referencedAttachmentIds = issueAttachmentReferences(
    canonicalIssue.description,
  );
  if ([...referencedAttachmentIds].some((id) => !attachmentIds.includes(id))) {
    throw new HttpError(
      400,
      "Issue description references an attachment outside this mutation",
    );
  }
  const observedAt = new Date().toISOString();
  const uploads = await resolveIssueAttachmentUploads(input.db, {
    purpose: "issue_create",
    organizationId: project.organization_id,
    projectId: project.id,
    userId: input.userId,
    mutationId: input.clientIssueId,
    runId: null,
    uploadIds: attachmentIds,
    observedAt,
  });
  if (!uploads) {
    throw new HttpError(409, "Issue attachments are unavailable or out of scope");
  }
  const attachmentRows = uploads.map((upload) => ({
    id: upload.upload_id,
    run_id: input.clientIssueId,
    project_id: project.id,
    object_key: upload.object_key,
    filename: upload.filename,
    content_type: upload.content_type,
    byte_size: upload.byte_size,
    created_at: observedAt,
  })).sort((left, right) => left.id.localeCompare(right.id));
  const response: CreateProjectIssueResult = {
    runId: input.clientIssueId,
    sourceKey,
    stage: "queued" as const,
    status: canonicalIssue.status,
    assigneeUserId: canonicalIssue.assigneeUserId,
    createdByUserId: input.userId,
    difficulty: canonicalIssue.difficulty,
    attachments: attachmentRows.map(issueAttachmentJson),
  };
  const responseJson = JSON.stringify(response);
  try {
    await recordHuntEvent(input.db, project.id, {
      source: "issue",
      sourceKey,
      title: canonicalIssue.title,
      stage: "queued",
      status: canonicalIssue.status,
      workflowStage: null,
      eventKey: `${sourceKey}:${canonicalIssue.status}:intake`,
      occurredAt: observedAt,
      actor: attribution.actor,
      repository: (await getProjectSettings(input.db, project.id))
        ?.github_repository ?? project.name,
      detail: attribution.detail,
      priority: canonicalIssue.priority,
      difficulty: canonicalIssue.difficulty,
      assigneeUserId: canonicalIssue.assigneeUserId,
      issueCheckpoints: canonicalIssue.checkpoints,
      fullAuto: canonicalIssue.fullAuto,
      branch: null,
      commitSha: null,
      tracker: null,
      issueDescription: canonicalIssue.description,
      resultSummary: null,
      structuredResult: null,
      pullRequestUrls: [],
      targetSha: null,
      sourceCreatedAt: observedAt,
      qaStatus: null,
      stagingQaDetail: null,
      productionQaDetail: null,
      context: {
        ...attribution.context,
        issueId: input.clientIssueId,
        attachmentCount: uploads.length,
        fullAuto: canonicalIssue.fullAuto,
      },
      createdByUserId: input.userId,
      preferredAgentProvider: canonicalIssue.preferredProvider,
      preferredAgentModel: canonicalIssue.preferredModel,
      preferredAgentEffort: canonicalIssue.preferredEffort,
    }, {
      newRunId: input.clientIssueId,
      additionalStatements: ({ recordedAt }) => [
        ...issueAttachmentInsertStatements(input.db, {
          projectId: project.id,
          runId: input.clientIssueId,
          uploads,
          createdAt: observedAt,
        }),
        issueCreateMutationReceiptStatement(input.db, {
          clientIssueId: input.clientIssueId,
          organizationId: project.organization_id,
          projectId: project.id,
          userId: input.userId,
          requestHash,
          attachmentUploadIds: attachmentIds,
          responseJson,
          createdAt: recordedAt,
        }),
        ...issueAttachmentUploadConsumeStatements(input.db, {
          purpose: "issue_create",
          organizationId: project.organization_id,
          projectId: project.id,
          userId: input.userId,
          mutationId: input.clientIssueId,
          runId: null,
          uploadIds: attachmentIds,
          consumedAt: recordedAt,
        }),
      ],
    });
  } catch (error) {
    const concurrentReceipt = await findIssueCreateMutationReceipt(
      input.db,
      input.clientIssueId,
    );
    if (concurrentReceipt) {
      if (
        concurrentReceipt.organization_id === project.organization_id &&
        concurrentReceipt.project_id === project.id &&
        concurrentReceipt.user_id === input.userId &&
        concurrentReceipt.request_hash === requestHash
      ) {
        return storedMutationResponse(concurrentReceipt.response_json);
      }
      throw issueMutationConflict("issue ID");
    }
    if (await findIssueCreateAggregateId(input.db, {
      projectId: project.id,
      clientIssueId: input.clientIssueId,
      sourceKey,
    })) {
      throw new HttpError(409, "Issue aggregate exists without its mutation receipt");
    }
    throw error;
  }
  const storedReceipt = await findIssueCreateMutationReceipt(
    input.db,
    input.clientIssueId,
  );
  if (!storedReceipt || storedReceipt.request_hash !== requestHash) {
    throw new HttpError(409, "Issue mutation receipt is incomplete");
  }
  return storedMutationResponse(storedReceipt.response_json);
}

export async function updateProjectIssue(
  input: IssueCoreApplicationInput & {
    runId: string;
    requestId: string;
    request: unknown;
    attachmentIds: readonly string[];
    keptAttachmentIds?: string[];
  },
): Promise<UpdateProjectIssueResult> {
  const project = await requireIssueProject(
    input,
    "issues:write",
    "Issue editing permission required",
  );
  const issue = decodeIssueUpdateInput(input.request);
  const attachmentIds = validateAttachmentReferences(input.attachmentIds);
  const keptAttachmentIds = input.keptAttachmentIds === undefined
    ? undefined
    : decodeIssueKeptAttachmentIds(input.keptAttachmentIds);
  if (
    keptAttachmentIds &&
    new Set(keptAttachmentIds).size !== keptAttachmentIds.length
  ) {
    throw new HttpError(400, "Kept attachment IDs must be unique");
  }
  const requestHash = await sha256(JSON.stringify({
    projectId: project.id,
    organizationId: project.organization_id,
    runId: input.runId,
    userId: input.userId,
    requestId: input.requestId,
    issue,
    keptAttachments: keptAttachmentIds === undefined
      ? { case: "snapshot" }
      : { case: "explicit", values: keptAttachmentIds },
    attachmentIds,
  }));
  const existingReceipt = await findIssueUpdateMutationReceipt(
    input.db,
    input.requestId,
  );
  if (existingReceipt) {
    if (
      existingReceipt.organization_id !== project.organization_id ||
      existingReceipt.project_id !== project.id ||
      existingReceipt.run_id !== input.runId ||
      existingReceipt.user_id !== input.userId ||
      existingReceipt.request_hash !== requestHash
    ) {
      throw issueMutationConflict("update request ID");
    }
    return storedMutationResponse(existingReceipt.response_json);
  }
  await requireIssueAssigneeMembership(
    input.db,
    project.id,
    issue.assigneeUserId,
  );
  const run = await getHuntRunForProject(input.db, project.id, input.runId);
  if (!run) throw new HttpError(404, "Run not found");
  const existingAttachments = await listIssueAttachments(
    input.db,
    project.id,
    input.runId,
  );
  const byId = new Map(existingAttachments.map((attachment) => [attachment.id, attachment]));
  const selectedKeptIds = keptAttachmentIds ?? existingAttachments.map(({ id }) => id);
  if (selectedKeptIds.some((id) => !byId.has(id))) {
    throw new HttpError(400, "Kept attachment IDs must belong to this issue");
  }
  const keptAttachments = selectedKeptIds.map((id) => byId.get(id)!);
  if (keptAttachments.length + attachmentIds.length > maxIssueAttachmentCount) {
    throw new HttpError(400, `Issue attachments are limited to ${maxIssueAttachmentCount}`);
  }
  const accessibleIds = new Set([...selectedKeptIds, ...attachmentIds]);
  if (
    [...issueAttachmentReferences(issue.description)].some(
      (id) => !accessibleIds.has(id),
    )
  ) {
    throw new HttpError(
      400,
      "Issue description references an attachment removed by this update",
    );
  }
  const now = Date.now();
  const observedAt = new Date(
    Math.max(now, Date.parse(run.updated_at) + 1),
  ).toISOString();
  const uploads = await resolveIssueAttachmentUploads(input.db, {
    purpose: "issue_update",
    organizationId: project.organization_id,
    projectId: project.id,
    userId: input.userId,
    mutationId: input.requestId,
    runId: input.runId,
    uploadIds: attachmentIds,
    observedAt,
  });
  if (!uploads) {
    throw new HttpError(409, "Issue attachments are unavailable or out of scope");
  }
  const newAttachmentRows = uploads.map((upload) => ({
    id: upload.upload_id,
    run_id: input.runId,
    project_id: project.id,
    object_key: upload.object_key,
    filename: upload.filename,
    content_type: upload.content_type,
    byte_size: upload.byte_size,
    created_at: observedAt,
  }));
  const finalAttachments = [...keptAttachments, ...newAttachmentRows].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id),
  );
  const response: UpdateProjectIssueResult = {
    runId: run.id,
    title: issue.title,
    description: issue.description,
    priority: issue.priority ?? null,
    difficulty: issue.difficulty,
    assigneeUserId: issue.assigneeUserId === undefined
      ? run.assignee_user_id
      : issue.assigneeUserId,
    attachments: finalAttachments.map(issueAttachmentJson),
  };
  const responseJson = JSON.stringify(response);
  const removedAttachments = existingAttachments.filter(
    (attachment) => !new Set(selectedKeptIds).has(attachment.id),
  );
  const statements = updateIssueMutationStatements(input.db, {
    organizationId: project.organization_id,
    projectId: project.id,
    runId: input.runId,
    userId: input.userId,
    requestId: input.requestId,
    requestHash,
    title: response.title,
    description: response.description,
    priority: response.priority,
    difficulty: response.difficulty,
    assigneeUserId: response.assigneeUserId,
    previousUpdatedAt: run.updated_at,
    updatedAt: observedAt,
    previousAttachmentIds: existingAttachments.map(({ id }) => id),
    keptAttachments,
    newUploads: uploads,
    removedAttachments,
    responseJson,
  });
  try {
    await input.db.batch([
      statements.update,
      ...statements.inserts,
      ...statements.cleanup,
      ...statements.removals,
      statements.receipt,
      ...issueAttachmentUploadConsumeStatements(input.db, {
        purpose: "issue_update",
        organizationId: project.organization_id,
        projectId: project.id,
        userId: input.userId,
        mutationId: input.requestId,
        runId: input.runId,
        uploadIds: attachmentIds,
        consumedAt: observedAt,
      }),
    ]);
  } catch (error) {
    const concurrentReceipt = await findIssueUpdateMutationReceipt(
      input.db,
      input.requestId,
    );
    if (concurrentReceipt) {
      if (
        concurrentReceipt.organization_id === project.organization_id &&
        concurrentReceipt.project_id === project.id &&
        concurrentReceipt.run_id === input.runId &&
        concurrentReceipt.user_id === input.userId &&
        concurrentReceipt.request_hash === requestHash
      ) {
        return storedMutationResponse(concurrentReceipt.response_json);
      }
      throw issueMutationConflict("update request ID");
    }
    try {
      const [currentRun, currentAttachments, currentUploads] = await Promise.all([
        getHuntRunForProject(input.db, project.id, input.runId),
        listIssueAttachments(input.db, project.id, input.runId),
        resolveIssueAttachmentUploads(input.db, {
          purpose: "issue_update",
          organizationId: project.organization_id,
          projectId: project.id,
          userId: input.userId,
          mutationId: input.requestId,
          runId: input.runId,
          uploadIds: attachmentIds,
          observedAt,
        }),
      ]);
      const previousIds = existingAttachments.map(({ id }) => id).sort();
      const currentIds = currentAttachments.map(({ id }) => id).sort();
      if (
        !currentRun ||
        currentRun.updated_at !== run.updated_at ||
        currentUploads === null ||
        previousIds.length !== currentIds.length ||
        previousIds.some((id, index) => id !== currentIds[index])
      ) {
        throw new HttpError(
          409,
          "Issue changed while the update was being committed",
        );
      }
    } catch (diagnosticError) {
      if (diagnosticError instanceof HttpError) throw diagnosticError;
    }
    throw error;
  }
  const storedReceipt = await findIssueUpdateMutationReceipt(
    input.db,
    input.requestId,
  );
  if (!storedReceipt || storedReceipt.request_hash !== requestHash) {
    throw new HttpError(409, "Issue update mutation receipt is incomplete");
  }
  return storedMutationResponse(storedReceipt.response_json);
}

export async function deleteProjectIssue(
  input: IssueCoreApplicationInput & {
    runId: string;
    attachmentsBucket: R2Bucket;
    archivesBucket: R2Bucket;
    context?: ExecutionContext;
  },
) {
  const project = await requireIssueProject(
    input,
    "issues:write",
    "Issue editing permission required",
  );
  const observedAt = new Date().toISOString();
  const outcome = await deleteIssue(
    input.db,
    project.id,
    input.runId,
    observedAt,
  );
  if (outcome === "not_found") throw new HttpError(404, "Run not found");
  if (outcome === "active") {
    throw new HttpError(409, "An active issue cannot be deleted");
  }
  void schedulePostCommitCleanup({
    context: input.context,
    operation: "issue_delete",
    observedAt,
    tasks: [{
      queue: "archive",
      run: () => processArchiveCleanupQueue(
        input.db,
        input.archivesBucket,
        input.attachmentsBucket,
        observedAt,
        1_000,
      ),
    }],
  });
  return { deleted: true as const };
}

export async function setProjectIssueSubscription(
  input: IssueCoreApplicationInput & { runId: string; subscribed: boolean },
) {
  const project = await requireIssueProject(
    input,
    "organization:read",
    "Project reading permission required",
  );
  const run = await getHuntRunForProject(input.db, project.id, input.runId);
  if (!run) throw new HttpError(404, "Run not found");
  if (!input.subscribed) {
    if (run.assignee_user_id === input.userId) {
      throw new HttpError(
        409,
        "The issue assignee must remain subscribed",
        "ISSUE_ASSIGNEE_SUBSCRIPTION_REQUIRED",
      );
    }
    await unsubscribeIssue(input.db, project.id, run.id, input.userId);
  } else {
    await subscribeIssue(
      input.db,
      project.id,
      run.id,
      input.userId,
      new Date().toISOString(),
    );
  }
  const subscribers = await listIssueSubscriptions(input.db, project.id, run.id);
  return {
    runId: run.id,
    subscribers: subscribers.map((subscriber) => ({
      userId: subscriber.user_id,
      subscribedAt: subscriber.created_at,
    })),
  };
}

export async function setProjectIssueDependency(
  input: IssueCoreApplicationInput & {
    dependentRunId: string;
    prerequisiteRunId: string;
    enabled: boolean;
  },
) {
  const project = await requireIssueProject(
    input,
    "issues:write",
    "Issue editing permission required",
  );
  if (!input.enabled) {
    const deleted = await deleteIssueDependency(
      input.db,
      project.id,
      input.prerequisiteRunId,
      input.dependentRunId,
    );
    return {
      prerequisiteRunId: input.prerequisiteRunId,
      dependentRunId: input.dependentRunId,
      outcome: deleted ? "removed" as const : "already_removed" as const,
    };
  }
  const outcome = await createIssueDependency(input.db, project.id, {
    dependentRunId: input.dependentRunId,
    prerequisiteRunId: input.prerequisiteRunId,
    createdByUserId: input.userId,
    createdAt: new Date().toISOString(),
  });
  if (outcome === "not_found") {
    throw new HttpError(404, "Dependency issue not found");
  }
  if (outcome === "cycle") {
    throw new HttpError(409, "Dependency would create a cycle");
  }
  if (outcome === "ineligible") {
    throw new HttpError(
      409,
      "Dependencies cannot be added after an issue starts executing",
    );
  }
  return {
    prerequisiteRunId: input.prerequisiteRunId,
    dependentRunId: input.dependentRunId,
    outcome,
  };
}

export async function updateProjectIssuePreferences(
  input: IssueCoreApplicationInput & { runId: string; request: unknown },
) {
  const project = await requireIssueProject(
    input,
    "issues:execute",
    "Issue execution permission required",
  );
  const request = decodeExecutionPreferences(input.request);
  const run = await updateIssueExecutionPreferences(
    input.db,
    project.id,
    input.runId,
    { ...request, updatedAt: new Date().toISOString() },
  );
  if (!run) throw new HttpError(404, "Run not found");
  return {
    runId: run.id,
    provider: run.preferred_agent_provider,
    model: run.preferred_agent_model,
    effort: run.preferred_agent_effort,
  };
}

export async function completeProjectIssueResultReview(
  input: IssueCoreApplicationInput & { runId: string },
) {
  const project = await requireIssueProject(
    input,
    "results:review",
    "Result review permission required",
  );
  const review = await completeIssueResultReview(
    input.db,
    project.id,
    input.runId,
    input.userId,
    new Date().toISOString(),
  );
  if (!review) throw new HttpError(404, "Run not found");
  return {
    userId: review.user_id,
    name: review.name,
    username: review.username,
    image: review.image,
    completedAt: review.completed_at,
  };
}

export async function updateProjectIssueCheckpoints(
  input: IssueCoreApplicationInput & { runId: string; request: unknown },
) {
  const project = await requireIssueProject(
    input,
    "issues:execute",
    "Issue execution permission required",
  );
  const request = decodeIssueCheckpointsInput(input.request);
  const outcome = await updateIssueCheckpoints(
    input.db,
    project.id,
    input.runId,
    request.checkpoints,
    new Date().toISOString(),
  );
  if (outcome === "not_found") throw new HttpError(404, "Run not found");
  if (outcome === "ineligible") {
    throw new HttpError(
      409,
      "Checkpoints can only be changed before issue execution starts",
    );
  }
  return { runId: input.runId, checkpoints: request.checkpoints };
}
