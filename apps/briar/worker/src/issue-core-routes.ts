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
import { corsHeaders, HttpError, json } from "./http-response";
import { issueAttachmentJson } from "./issue-conversation-json";
import { hasOrganizationCapability } from "./organization-access";
import {
  decodeExecutionPreferences,
} from "./issue-request-contract";
import {
  createIssueWithAttachments,
  updateIssueWithAttachments,
} from "./issue-write-service";
import { listProjectMembers } from "./organization-repository";
import { responseWithPostCommitCleanup } from "./post-commit-cleanup";
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
  sessionUserId?: string,
) {
  if (!assigneeUserId || assigneeUserId === sessionUserId) return;
  const members = await listProjectMembers(db, projectId);
  if (!members.some((member) => member.user_id === assigneeUserId)) {
    throw new HttpError(
      400,
      "Assignee must have access to the project",
    );
  }
}

export async function handleIssueCoreRoute(input: {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  attachmentsBucket: R2Bucket;
  archivesBucket: R2Bucket;
  context?: ExecutionContext;
}): Promise<Response | undefined> {
  const {
    request,
    url,
    auth,
    db,
    attachmentsBucket,
    archivesBucket,
    context,
  } = input;

  const issuesMatch = url.pathname.match(/^\/projects\/([0-9a-f-]+)\/issues$/u);
  if (issuesMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, issuesMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "issues:write")) {
      throw new HttpError(403, "Issue editing permission required");
    }
    const { input, attachments, attachmentReferences } =
      await readIssueRequest(request);
    const assigneeUserId =
      input.assigneeUserId === undefined
        ? session.user.id
        : input.assigneeUserId;
    await requireIssueAssigneeMembership(
      db,
      project.id,
      assigneeUserId,
      session.user.id,
    );
    const issueId = crypto.randomUUID();
    const sourceKey = `briar-issue:${issueId}`;
    const detail =
      input.status === "backlog"
        ? "Briar 앱에서 생성된 이슈가 백로그에 추가되었습니다."
        : "Briar 앱에서 생성된 이슈가 처리를 기다리고 있습니다.";
    const created = await createIssueWithAttachments({
      db,
      attachmentsBucket,
      project,
      issue: {
        ...input,
        assigneeUserId,
      },
      attachments,
      attachmentReferences,
      sourceKey,
      actor: "briar-app",
      detail,
      context: { origin: "briar-app" },
      issueId,
      createdByUserId: session.user.id,
    });
    return json(
      {
        runId: created.runId,
        sourceKey,
        stage: "queued",
        status: input.status,
        assigneeUserId: assigneeUserId ?? null,
        createdByUserId: session.user.id,
        difficulty: input.difficulty,
        attachments: created.attachments.map(issueAttachmentJson),
      },
      201,
    );
  }

  const issueUpdateMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)$/u,
  );
  const issueSubscriptionMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/subscription$/u,
  );
  const issueDependencyMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/dependencies\/([0-9a-f-]+)$/u,
  );
  const issuePreferencesMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/preferences$/u,
  );
  const issueCheckpointsMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/checkpoints$/u,
  );
  const issueResultReviewsMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/result-reviews$/u,
  );
  if (
    issueSubscriptionMatch &&
    (request.method === "PUT" || request.method === "DELETE")
  ) {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueSubscriptionMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "organization:read")) {
      throw new HttpError(403, "Project reading permission required");
    }
    const run = await getHuntRunForProject(
      db,
      project.id,
      issueSubscriptionMatch[2],
    );
    if (!run) throw new HttpError(404, "Run not found");
    if (request.method === "DELETE") {
      if (run.assignee_user_id === session.user.id) {
        throw new HttpError(
          409,
          "The issue assignee must remain subscribed",
          "ISSUE_ASSIGNEE_SUBSCRIPTION_REQUIRED",
        );
      }
      await unsubscribeIssue(db, project.id, run.id, session.user.id);
    } else {
      await subscribeIssue(
        db,
        project.id,
        run.id,
        session.user.id,
        new Date().toISOString(),
      );
    }
    const subscribers = await listIssueSubscriptions(db, project.id, run.id);
    return json({
      runId: run.id,
      subscribers: subscribers.map((subscriber) => ({
        userId: subscriber.user_id,
        subscribedAt: subscriber.created_at,
      })),
    });
  }
  if (issueDependencyMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueDependencyMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "issues:write")) {
      throw new HttpError(403, "Issue editing permission required");
    }
    const outcome = await createIssueDependency(db, project.id, {
      dependentRunId: issueDependencyMatch[2],
      prerequisiteRunId: issueDependencyMatch[3],
      createdByUserId: session.user.id,
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
    return json(
      {
        prerequisiteRunId: issueDependencyMatch[3],
        dependentRunId: issueDependencyMatch[2],
        outcome,
      },
      outcome === "created" ? 201 : 200,
    );
  }
  if (issueDependencyMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueDependencyMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "issues:write")) {
      throw new HttpError(403, "Issue editing permission required");
    }
    await deleteIssueDependency(
      db,
      project.id,
      issueDependencyMatch[3],
      issueDependencyMatch[2],
    );
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (issuePreferencesMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issuePreferencesMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "issues:execute")) {
      throw new HttpError(403, "Issue execution permission required");
    }
    const input = decodeExecutionPreferences(await readJson(request));
    const run = await updateIssueExecutionPreferences(
      db,
      project.id,
      issuePreferencesMatch[2],
      {
        ...input,
        updatedAt: new Date().toISOString(),
      },
    );
    if (!run) throw new HttpError(404, "Run not found");
    return json({
      runId: run.id,
      provider: run.preferred_agent_provider,
      model: run.preferred_agent_model,
      effort: run.preferred_agent_effort,
    });
  }
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
  if (issueResultReviewsMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      issueResultReviewsMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "results:review")) {
      throw new HttpError(403, "Result review permission required");
    }
    const review = await completeIssueResultReview(
      db,
      project.id,
      issueResultReviewsMatch[2],
      session.user.id,
      new Date().toISOString(),
    );
    if (!review) throw new HttpError(404, "Run not found");
    return json({
      userId: review.user_id,
      name: review.name,
      username: review.username,
      image: review.image,
      completedAt: review.completed_at,
    });
  }
  if (issueUpdateMatch && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, issueUpdateMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "issues:write")) {
      throw new HttpError(403, "Issue editing permission required");
    }
    const { input, attachments, attachmentReferences, keptAttachmentIds } =
      await readIssueUpdateRequest(request);
    await requireIssueAssigneeMembership(
      db,
      project.id,
      input.assigneeUserId,
    );
    const run = await updateIssueWithAttachments({
      db,
      attachmentsBucket,
      project,
      runId: issueUpdateMatch[2],
      issue: input,
      attachments,
      attachmentReferences,
      keptAttachmentIds,
      updatedAt: new Date().toISOString(),
    });
    return json({
      runId: run.id,
      title: run.title,
      description: run.issue_description,
      priority: run.priority,
      difficulty: run.difficulty,
      assigneeUserId: run.assignee_user_id,
      attachments: (await listIssueAttachments(
        db,
        project.id,
        issueUpdateMatch[2],
      )).map(issueAttachmentJson),
    });
  }
  if (issueUpdateMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, issueUpdateMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "issues:write")) {
      throw new HttpError(403, "Issue editing permission required");
    }
    const observedAt = new Date().toISOString();
    const outcome = await deleteIssue(
      db,
      project.id,
      issueUpdateMatch[2],
      observedAt,
    );
    if (outcome === "not_found") {
      throw new HttpError(404, "Run not found");
    }
    if (outcome === "active") {
      throw new HttpError(409, "An active issue cannot be deleted");
    }
    return responseWithPostCommitCleanup(
      new Response(null, { status: 204, headers: corsHeaders }),
      {
        context,
        operation: "issue_delete",
        observedAt,
        tasks: [{
          queue: "archive",
          run: () => processArchiveCleanupQueue(
            db,
            archivesBucket,
            attachmentsBucket,
            observedAt,
            1_000,
          ),
        }],
      },
    );
  }


  return undefined;
}
