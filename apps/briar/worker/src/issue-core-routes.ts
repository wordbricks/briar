import { maxIssueAttachmentCount } from "../../src/lib/issue-attachments";
import { isIssueAttachmentReference } from "../../src/lib/issue-markdown";
import { processArchiveCleanupQueue } from "./archive";
import type { BriarAuth } from "./auth";
import {
  completeIssueResultReview,
  createIssueDependency,
  deleteIssue,
  deleteIssueDependency,
  getHuntRunForProject,
  getProject,
  listIssueAttachments,
  listIssueSubscriptions,
  subscribeIssue,
  unsubscribeIssue,
  updateIssueCheckpoints,
  updateIssueExecutionPreferences,
} from "./db";
import { HttpError, json } from "./http-response";
import { issueAttachmentJson } from "./issue-conversation-json";
import { hasOrganizationCapability } from "./organization-access";
import {
  decodeExecutionPreferences,
  decodeIssueInput,
  decodeIssueKeptAttachmentIds,
  decodeIssueUpdateInput,
} from "./issue-request-contract";
import {
  createIssueWithAttachments,
  updateIssueWithAttachments,
} from "./issue-write-service";
import { listProjectMembers } from "./organization-repository";
import { schedulePostCommitCleanup } from "./post-commit-cleanup";
import {
  readIssueRequest,
  readIssueUpdateRequest,
  readJson,
} from "./request-readers";
import { decodeIssueCheckpointsInput } from "./run-request-contract";
import { requireSession } from "./session-auth";

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
    !references.every(isIssueAttachmentReference)
  ) {
    throw new HttpError(400, "Attachment references are invalid");
  }
  return [...references];
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
    attachmentsBucket: R2Bucket;
    request: unknown;
    attachments: File[];
    attachmentReferences: string[];
  },
) {
  const project = await requireIssueProject(
    input,
    "issues:write",
    "Issue editing permission required",
  );
  const issue = decodeIssueInput(input.request);
  const attachmentReferences = validateAttachmentReferences(
    input.attachmentReferences,
  );
  await requireIssueAssigneeMembership(
    input.db,
    project.id,
    issue.assigneeUserId,
  );
  const issueId = crypto.randomUUID();
  const sourceKey = `briar-issue:${issueId}`;
  const detail = issue.status === "backlog"
    ? "Briar 앱에서 생성된 이슈가 백로그에 추가되었습니다."
    : "Briar 앱에서 생성된 이슈가 처리를 기다리고 있습니다.";
  const created = await createIssueWithAttachments({
    db: input.db,
    attachmentsBucket: input.attachmentsBucket,
    project,
    issue,
    attachments: input.attachments,
    attachmentReferences,
    sourceKey,
    actor: "briar-app",
    detail,
    context: { origin: "briar-app" },
    issueId,
    createdByUserId: input.userId,
  });
  return {
    runId: created.runId,
    sourceKey,
    stage: "queued" as const,
    status: issue.status,
    assigneeUserId: issue.assigneeUserId ?? null,
    createdByUserId: input.userId,
    difficulty: issue.difficulty,
    attachments: created.attachments.map(issueAttachmentJson),
  };
}

export async function updateProjectIssue(
  input: IssueCoreApplicationInput & {
    attachmentsBucket: R2Bucket;
    runId: string;
    request: unknown;
    attachments: File[];
    attachmentReferences: string[];
    keptAttachmentIds?: string[];
  },
) {
  const project = await requireIssueProject(
    input,
    "issues:write",
    "Issue editing permission required",
  );
  const issue = decodeIssueUpdateInput(input.request);
  const attachmentReferences = validateAttachmentReferences(
    input.attachmentReferences,
  );
  const keptAttachmentIds = input.keptAttachmentIds === undefined
    ? undefined
    : decodeIssueKeptAttachmentIds(input.keptAttachmentIds);
  await requireIssueAssigneeMembership(
    input.db,
    project.id,
    issue.assigneeUserId,
  );
  const run = await updateIssueWithAttachments({
    db: input.db,
    attachmentsBucket: input.attachmentsBucket,
    project,
    runId: input.runId,
    issue,
    attachments: input.attachments,
    attachmentReferences,
    keptAttachmentIds,
    updatedAt: new Date().toISOString(),
  });
  return {
    runId: run.id,
    title: run.title,
    description: run.issue_description,
    priority: run.priority,
    difficulty: run.difficulty,
    assigneeUserId: run.assignee_user_id,
    attachments: (await listIssueAttachments(
      input.db,
      project.id,
      input.runId,
    )).map(issueAttachmentJson),
  };
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

export async function handleIssueCoreRoute(input: {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  attachmentsBucket: R2Bucket;
}): Promise<Response | undefined> {
  const {
    request,
    url,
    auth,
    db,
    attachmentsBucket,
  } = input;

  const issuesMatch = url.pathname.match(/^\/projects\/([0-9a-f-]+)\/issues$/u);
  if (
    issuesMatch && request.method === "POST" &&
    request.headers.get("content-type")?.toLowerCase().startsWith(
      "multipart/form-data",
    )
  ) {
    const session = await requireSession(auth, request);
    const issueRequest =
      await readIssueRequest(request);
    if (issueRequest.attachments.length === 0) {
      throw new HttpError(400, "Issue upload requires an attachment");
    }
    return json(await createProjectIssue({
      db,
      projectId: issuesMatch[1],
      userId: session.user.id,
      attachmentsBucket,
      request: issueRequest.input,
      attachments: issueRequest.attachments,
      attachmentReferences: issueRequest.attachmentReferences,
    }), 201);
  }

  const issueUpdateMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)$/u,
  );
  const issueCheckpointsMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/checkpoints$/u,
  );
  if (issueCheckpointsMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueCheckpointsMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "issues:execute")) {
      throw new HttpError(403, "Issue execution permission required");
    }
    const input = decodeIssueCheckpointsInput(await readJson(request));
    const outcome = await updateIssueCheckpoints(
      db,
      project.id,
      issueCheckpointsMatch[2],
      input.checkpoints,
      new Date().toISOString(),
    );
    if (outcome === "not_found") throw new HttpError(404, "Run not found");
    if (outcome === "ineligible") {
      throw new HttpError(
        409,
        "Checkpoints can only be changed before issue execution starts",
      );
    }
    return json({
      runId: issueCheckpointsMatch[2],
      checkpoints: input.checkpoints,
    });
  }
  if (
    issueUpdateMatch && request.method === "PATCH" &&
    request.headers.get("content-type")?.toLowerCase().startsWith(
      "multipart/form-data",
    )
  ) {
    const session = await requireSession(auth, request);
    const issueRequest =
      await readIssueUpdateRequest(request);
    if (issueRequest.attachments.length === 0) {
      throw new HttpError(400, "Issue update upload requires an attachment");
    }
    return json(await updateProjectIssue({
      db,
      projectId: issueUpdateMatch[1],
      userId: session.user.id,
      attachmentsBucket,
      runId: issueUpdateMatch[2],
      request: issueRequest.input,
      attachments: issueRequest.attachments,
      attachmentReferences: issueRequest.attachmentReferences,
      keptAttachmentIds: issueRequest.keptAttachmentIds,
    }));
  }
  return undefined;
}
