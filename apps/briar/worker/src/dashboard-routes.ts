import {
  isProjectUsageDateRange,
  projectUsageSummaryWindow,
  type ProjectUsageDateRange,
} from "../../src/lib/project-usage-summary";
import { parseExecutionMetrics } from "./agent-result-json";
import { listArchivedRunEvents } from "./archive";
import type { BriarAuth } from "./auth";
import {
  getDashboardSyncCursor,
  listDashboardChanges,
} from "./dashboard-change-repository";
import {
  dashboardEventJson,
  dashboardRunJson,
  statusTrayRunJson,
} from "./dashboard-json";
import { hasOrganizationCapability } from "./organization-access";
import {
  getHuntRunForProject,
  getProject,
  getProjectSettings,
  listChannelConversationNotifications,
  listDashboardRuns,
  listDashboardRunsByIds,
  listHuntRunEvents,
  listIssueAttachments,
  listIssueAttachmentsByRunIds,
  listIssueConversationNotifications,
  listIssueDependencies,
  listIssueDependenciesByRunIds,
  listIssueHierarchy,
  listIssueHierarchyByRunIds,
  listIssueRelations,
  listIssueRelationsByRunIds,
  listIssueResultReviews,
  listIssueResultReviewsByRunIds,
  listOrganizationStatusTrayRuns,
  listProjectUsageRuns,
  listProjectUsageTotals,
  listRunUsageRecords,
  resolveHuntEventActorNames,
  type IssueAttachmentRow,
  type IssueDependencyRow,
  type IssueHierarchyRow,
  type IssueRelationRow,
  type IssueResultReviewRow,
} from "./db";
import { HttpError, json } from "./http-response";
import {
  channelConversationNotificationJson,
  issueConversationNotificationJson,
} from "./issue-conversation-json";
import { organizationMemberJson } from "./organization-json";
import {
  getOrganizationRole,
  listProjectMembers,
} from "./organization-repository";
import { projectJson } from "./project-json";
import { settingsJson } from "./project-settings-json";
import { decodeProjectUsagePeriod } from "./run-request-contract";
import { requireSession } from "./session-auth";
import { projectUsageSummaryJson } from "./usage-json";
import {
  estimateRunExecutionCost,
  loadAgentUsagePricing,
} from "./usage-pricing";
import {
  checkpointPolicyJson,
  loadWorkflowCheckpointPolicy,
} from "./workflow-policy";
import { workerJson } from "./worker-json";
import {
  getProjectExecutionWorkerPolicy,
  listExecutionWorkers,
  listOrganizationExecutionProviders,
} from "./workers";

export async function handleDashboardRoute(input: {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  archivesBucket: R2Bucket;
}): Promise<Response | undefined> {
  const { request, url, auth, db, archivesBucket } = input;

  const statusTrayRunsMatch = url.pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/status-tray\/runs$/u,
  );
  if (statusTrayRunsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = statusTrayRunsMatch[1];
    const role = await getOrganizationRole(
      db,
      organizationId,
      session.user.id,
    );
    if (!hasOrganizationCapability(role, "organization:read")) {
      throw new HttpError(404, "Organization not found");
    }
    const runs = await listOrganizationStatusTrayRuns(
      db,
      organizationId,
      session.user.id,
    );
    return json({
      runs: runs.map(statusTrayRunJson),
      generatedAt: new Date().toISOString(),
    });
  }

  const projectUsageSummaryMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/usage\/summary$/u,
  );
  if (projectUsageSummaryMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectUsageSummaryMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const period = decodeProjectUsagePeriod(
      new URL(request.url).searchParams.get("period") ?? "day",
    );
    const search = new URL(request.url).searchParams;
    const from = search.get("from");
    const to = search.get("to");
    let range: ProjectUsageDateRange | undefined;
    if (from !== null || to !== null) {
      range = { from: from ?? "", to: to ?? "" };
      if (!isProjectUsageDateRange(range, period)) {
        throw new HttpError(
          400,
          "Usage range is invalid or contains more than 400 timeline buckets",
        );
      }
    }
    const generatedAt = Date.now();
    const window = projectUsageSummaryWindow(
      period,
      generatedAt,
      range,
    );
    const since = new Date(window.startAt).toISOString();
    const until = new Date(window.endAt).toISOString();
    const [runs, totals] = await Promise.all([
      listProjectUsageRuns(db, project.id, since, until),
      listProjectUsageTotals(db, project.id, since, until),
    ]);
    return json(projectUsageSummaryJson(
      runs,
      totals,
      period,
      generatedAt,
      range,
    ));
  }

  const dashboardDeltaMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/dashboard\/delta$/u,
  );
  if (dashboardDeltaMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      dashboardDeltaMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const rawCursor = new URL(request.url).searchParams.get("cursor");
    if (!rawCursor || !/^\d+$/u.test(rawCursor)) {
      throw new HttpError(400, "A non-negative dashboard cursor is required");
    }
    const cursor = Number(rawCursor);
    if (!Number.isSafeInteger(cursor)) {
      throw new HttpError(400, "Dashboard cursor is outside the safe range");
    }
    const page = await listDashboardChanges(db, project.id, cursor);
    if (page.expired) {
      return json(
        {
          code: "dashboard_cursor_expired",
          message: "Dashboard cursor expired; reload the full snapshot",
        },
        410,
      );
    }

    const observedAt = new Date().toISOString();
    const changedRunIds = new Set(
      page.changes.flatMap((change) =>
        change.entity_type === "run" && change.entity_id
          ? [change.entity_id]
          : [],
      ),
    );
    const changedRunIdList = [...changedRunIds];
    const metadataChanged = page.changes.some(
      (change) => change.entity_type === "metadata",
    );
    const notificationsChanged = page.changes.some(
      (change) =>
        change.entity_type === "notifications" || change.entity_type === "run",
    );
    const [
      dashboardRows,
      attachments,
      dependencies,
      hierarchy,
      relations,
      resultReviews,
      workers,
      organizationProviders,
    ] =
      await Promise.all([
        listDashboardRunsByIds(db, project.id, changedRunIdList),
        listIssueAttachmentsByRunIds(db, project.id, changedRunIdList),
        listIssueDependenciesByRunIds(db, project.id, changedRunIdList),
        listIssueHierarchyByRunIds(db, project.id, changedRunIdList),
        listIssueRelationsByRunIds(db, project.id, changedRunIdList),
        listIssueResultReviewsByRunIds(db, project.id, changedRunIdList),
        listExecutionWorkers(db, project.id, observedAt),
        listOrganizationExecutionProviders(
          db,
          project.organization_id,
        ),
      ]);
    const attachmentsByRun = new Map<string, IssueAttachmentRow[]>();
    for (const attachment of attachments) {
      if (!changedRunIds.has(attachment.run_id)) continue;
      const runAttachments = attachmentsByRun.get(attachment.run_id) ?? [];
      runAttachments.push(attachment);
      attachmentsByRun.set(attachment.run_id, runAttachments);
    }
    const prerequisitesByRun = new Map<string, IssueDependencyRow[]>();
    const dependentsByRun = new Map<string, IssueDependencyRow[]>();
    const hierarchyByRun = new Map<string, IssueHierarchyRow[]>();
    const relationsByRun = new Map<string, IssueRelationRow[]>();
    const resultReviewsByRun = new Map<string, IssueResultReviewRow[]>();
    for (const review of resultReviews) {
      if (!changedRunIds.has(review.run_id)) continue;
      const runReviews = resultReviewsByRun.get(review.run_id) ?? [];
      runReviews.push(review);
      resultReviewsByRun.set(review.run_id, runReviews);
    }
    for (const dependency of dependencies) {
      if (changedRunIds.has(dependency.dependent_run_id)) {
        const prerequisites =
          prerequisitesByRun.get(dependency.dependent_run_id) ?? [];
        prerequisites.push(dependency);
        prerequisitesByRun.set(dependency.dependent_run_id, prerequisites);
      }
      if (changedRunIds.has(dependency.prerequisite_run_id)) {
        const dependents =
          dependentsByRun.get(dependency.prerequisite_run_id) ?? [];
        dependents.push(dependency);
        dependentsByRun.set(dependency.prerequisite_run_id, dependents);
      }
    }
    for (const link of hierarchy) {
      for (const runId of [link.parent_run_id, link.child_run_id]) {
        if (!changedRunIds.has(runId)) continue;
        const links = hierarchyByRun.get(runId) ?? [];
        links.push(link);
        hierarchyByRun.set(runId, links);
      }
    }
    for (const relation of relations) {
      for (const runId of [relation.first_run_id, relation.second_run_id]) {
        if (!changedRunIds.has(runId)) continue;
        const runRelations = relationsByRun.get(runId) ?? [];
        runRelations.push(relation);
        relationsByRun.set(runId, runRelations);
      }
    }
    const changedRuns = dashboardRows.filter((run) =>
      changedRunIds.has(run.id),
    );
    const existingRunIds = new Set(changedRuns.map((run) => run.id));
    const metadata = metadataChanged
      ? await Promise.all([
          getProjectSettings(db, project.id),
          loadWorkflowCheckpointPolicy(db, project.id, session.user.id),
          getProjectExecutionWorkerPolicy(db, project.id),
          listProjectMembers(db, project.id),
        ])
      : null;
    const conversationNotifications = notificationsChanged
      ? await listIssueConversationNotifications(
          db,
          project.id,
          session.user.id,
        )
      : null;
    // Channel changes have an organization cursor rather than a project
    // dashboard cursor. Refresh this bounded projection on the existing
    // dashboard cadence so Inbox needs no second polling loop.
    const channelNotifications = await listChannelConversationNotifications(
      db,
      project.organization_id,
      session.user.id,
    );

    const response = {
      cursor: page.nextCursor,
      hasMore: page.hasMore,
      runs: changedRuns.map((run) =>
        dashboardRunJson(
          run,
          attachmentsByRun.get(run.id) ?? [],
          prerequisitesByRun.get(run.id) ?? [],
          dependentsByRun.get(run.id) ?? [],
          hierarchyByRun.get(run.id) ?? [],
          relationsByRun.get(run.id) ?? [],
          resultReviewsByRun.get(run.id) ?? [],
        ),
      ),
      deletedRunIds: [...changedRunIds].filter(
        (runId) => !existingRunIds.has(runId),
      ),
      // Worker liveness also changes as time passes without a database write,
      // so this small projection is refreshed on every delta request.
      workers: workers.map((worker) => workerJson(worker, observedAt)),
      organizationProviders,
    };
    if (metadata) {
      Object.assign(response, {
        project: projectJson(project),
        settings: settingsJson(
          metadata[0],
          checkpointPolicyJson(metadata[1]),
        ),
        executionPolicy: metadata[2],
        members: metadata[3].map((member) => organizationMemberJson(member)),
      });
    }
    if (conversationNotifications) {
      Object.assign(response, {
        conversationNotifications: conversationNotifications.map(
          issueConversationNotificationJson,
        ),
      });
    }
    Object.assign(response, {
      channelNotifications: channelNotifications.map(
        channelConversationNotificationJson,
      ),
      generatedAt: observedAt,
    });
    return json(response);
  }

  const dashboardMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/dashboard$/u,
  );
  if (dashboardMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, dashboardMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    // Capture the cursor before reading the snapshot. A concurrent write is
    // therefore either visible here or guaranteed to appear in the next delta.
    const cursor = await getDashboardSyncCursor(db, project.id);
    const observedAt = new Date().toISOString();
    const [
      runs,
      settings,
      checkpointPolicy,
      attachments,
      dependencies,
      hierarchy,
      relations,
      resultReviews,
      workers,
      organizationProviders,
      executionPolicy,
      members,
      conversationNotifications,
      channelNotifications,
    ] =
      await Promise.all([
        listDashboardRuns(db, project.id),
        getProjectSettings(db, project.id),
        loadWorkflowCheckpointPolicy(db, project.id, session.user.id),
        listIssueAttachments(db, project.id),
        listIssueDependencies(db, project.id),
        listIssueHierarchy(db, project.id),
        listIssueRelations(db, project.id),
        listIssueResultReviews(db, project.id),
        listExecutionWorkers(db, project.id, observedAt),
        listOrganizationExecutionProviders(
          db,
          project.organization_id,
        ),
        getProjectExecutionWorkerPolicy(db, project.id),
        listProjectMembers(db, project.id),
        listIssueConversationNotifications(
          db,
          project.id,
          session.user.id,
        ),
        listChannelConversationNotifications(
          db,
          project.organization_id,
          session.user.id,
        ),
      ]);
    const attachmentsByRun = new Map<string, IssueAttachmentRow[]>();
    for (const attachment of attachments) {
      const runAttachments = attachmentsByRun.get(attachment.run_id) ?? [];
      runAttachments.push(attachment);
      attachmentsByRun.set(attachment.run_id, runAttachments);
    }
    const prerequisitesByRun = new Map<string, IssueDependencyRow[]>();
    const dependentsByRun = new Map<string, IssueDependencyRow[]>();
    const hierarchyByRun = new Map<string, IssueHierarchyRow[]>();
    const relationsByRun = new Map<string, IssueRelationRow[]>();
    const resultReviewsByRun = new Map<string, IssueResultReviewRow[]>();
    for (const review of resultReviews) {
      const runReviews = resultReviewsByRun.get(review.run_id) ?? [];
      runReviews.push(review);
      resultReviewsByRun.set(review.run_id, runReviews);
    }
    for (const dependency of dependencies) {
      const prerequisites =
        prerequisitesByRun.get(dependency.dependent_run_id) ?? [];
      prerequisites.push(dependency);
      prerequisitesByRun.set(dependency.dependent_run_id, prerequisites);
      const dependents =
        dependentsByRun.get(dependency.prerequisite_run_id) ?? [];
      dependents.push(dependency);
      dependentsByRun.set(dependency.prerequisite_run_id, dependents);
    }
    for (const link of hierarchy) {
      for (const runId of [link.parent_run_id, link.child_run_id]) {
        const links = hierarchyByRun.get(runId) ?? [];
        links.push(link);
        hierarchyByRun.set(runId, links);
      }
    }
    for (const relation of relations) {
      for (const runId of [relation.first_run_id, relation.second_run_id]) {
        const runRelations = relationsByRun.get(runId) ?? [];
        runRelations.push(relation);
        relationsByRun.set(runId, runRelations);
      }
    }
    return json({
      project: projectJson(project),
      settings: settingsJson(settings, checkpointPolicyJson(checkpointPolicy)),
      runs: runs.map((run) =>
        dashboardRunJson(
          run,
          attachmentsByRun.get(run.id) ?? [],
          prerequisitesByRun.get(run.id) ?? [],
          dependentsByRun.get(run.id) ?? [],
          hierarchyByRun.get(run.id) ?? [],
          relationsByRun.get(run.id) ?? [],
          resultReviewsByRun.get(run.id) ?? [],
        ),
      ),
      workers: workers.map((worker) => workerJson(worker, observedAt)),
      organizationProviders,
      executionPolicy,
      members: members.map((member) => organizationMemberJson(member)),
      conversationNotifications: conversationNotifications.map(
        issueConversationNotificationJson,
      ),
      channelNotifications: channelNotifications.map(
        channelConversationNotificationJson,
      ),
      cursor,
      generatedAt: observedAt,
    });
  }

  const runCostEstimateMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/cost-estimate$/u,
  );
  if (runCostEstimateMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const projectId = runCostEstimateMatch[1];
    const runId = runCostEstimateMatch[2];
    const project = await getProject(db, projectId, session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const run = await getHuntRunForProject(db, projectId, runId);
    if (!run) throw new HttpError(404, "Run not found");
    const [usageRecords, loadedPricing] = await Promise.all([
      listRunUsageRecords(
        db,
        projectId,
        runId,
        run.current_attempt,
        run.last_execution_id,
      ),
      loadAgentUsagePricing(),
    ]);
    const metrics = parseExecutionMetrics(run.execution_metrics_json);
    const provider =
      run.preferred_agent_provider ?? run.requested_agent_provider ?? null;
    const model = run.preferred_agent_provider
      ? run.preferred_agent_model
      : run.requested_agent_provider
        ? run.requested_agent_model
        : null;
    return json(
      estimateRunExecutionCost({
        usageRecords,
        loadedPricing,
        fallback:
          metrics && provider
            ? {
                agentProvider: provider,
                model,
                inputTokens: metrics.inputTokens,
                cacheReadTokens: metrics.cacheReadTokens,
                cacheWriteTokens: metrics.cacheWriteTokens,
                outputTokens: metrics.outputTokens,
              }
            : null,
      }),
    );
  }

  const runEventsMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/events$/u,
  );
  if (runEventsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, runEventsMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const run = await getHuntRunForProject(db, project.id, runEventsMatch[2]);
    if (!run) throw new HttpError(404, "Run not found");
    const [hotEvents, archivedEvents] = await Promise.all([
      listHuntRunEvents(db, project.id, run.id),
      listArchivedRunEvents(db, archivesBucket, project.id, run.id),
    ]);
    const events = [
      ...new Map(
        [...archivedEvents, ...hotEvents].map((event) => [event.id, event]),
      ).values(),
    ].sort(
      (left, right) =>
        right.occurred_at.localeCompare(left.occurred_at) ||
        right.id.localeCompare(left.id),
    );
    const actorNames = await resolveHuntEventActorNames(
      db,
      project.id,
      events.map((event) => event.actor),
    );
    return json({
      runId: run.id,
      eventCount: events.length,
      events: events.map((event) => dashboardEventJson(event, actorNames)),
    });
  }


  return undefined;
}
