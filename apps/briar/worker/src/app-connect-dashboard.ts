import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";
import {
  DashboardRun_Source,
  DashboardService,
} from "@briar/contracts/gen/briar/app/v1/dashboard_pb";
import { RunStatus } from "@briar/contracts/gen/briar/app/v1/common_pb";
import * as Schema from "effect/Schema";
import { asPlanningProjectId } from "../../src/lib/entity-ids";
import { listArchivedRunEvents } from "./archive";
import type { BriarAuth } from "./auth";
import {
  getDashboardSyncCursor,
  listDashboardChanges,
} from "./dashboard-change-repository";
import {
  dashboardEventJson,
  dashboardRunJson,
  dashboardRunSummaryJson,
} from "./dashboard-json";
import {
  getHuntRunForProject,
  getTeam,
  getTeamSettings,
  listChannelConversationNotifications,
  decodeDashboardRunListCursor,
  listDashboardRuns,
  listDashboardRunSummaries,
  listDashboardRunsByIds,
  encodeDashboardRunListCursor,
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
  listHuntRunEventsPage,
  resolveHuntEventActorNames,
  type IssueAttachmentRow,
  type IssueDependencyRow,
  type IssueHierarchyRow,
  type IssueRelationRow,
  type IssueResultReviewRow,
} from "./db";
import { HttpError } from "./http-response";
import {
  channelConversationNotificationJson,
  issueConversationNotificationJson,
} from "./issue-conversation-json";
import { listProjectMembers } from "./organization-repository";

import {
  appAgentProvider,
  appChannelNotification,
  appConversationNotification,
  appDashboardRun,
  appDashboardRunSummary,
  appDashboardWorker,
  appExecutionPolicy,
  appOrganizationMember,
  appProject,
  appProjectSettings,
  appRunEvent,
} from "./app-connect-mappers";
import { settingsJson } from "./team-settings-json";
import { decodeRequestSync } from "./request-schema";
import { UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";
import { checkpointPolicyJson, loadWorkflowCheckpointPolicy } from "./workflow-policy";
import { workerJson } from "./worker-json";
import {
  getProjectExecutionWorkerPolicy,
  listExecutionWorkers,
  listOrganizationExecutionProviders,
} from "./workers";

export type AppConnectDashboardInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
  readonly archivesBucket: R2Bucket;
};

const decodeTeamId = decodeRequestSync(Schema.Struct({
  teamId: UuidString,
}));

const decodeRunIds = decodeRequestSync(Schema.Struct({
  teamId: UuidString,
  runId: UuidString,
}));

const sourceForList = (value: DashboardRun_Source) => {
  switch (value) {
    case DashboardRun_Source.ISSUE: return "issue" as const;
    case DashboardRun_Source.ERROR: return "error" as const;
    case DashboardRun_Source.FEEDBACK: return "feedback" as const;
    default: throw new HttpError(400, "Unknown dashboard list source");
  }
};

const statusForList = (value: RunStatus) => {
  switch (value) {
    case RunStatus.BACKLOG: return "backlog" as const;
    case RunStatus.QUEUED: return "queued" as const;
    case RunStatus.RUNNING: return "running" as const;
    case RunStatus.PAUSED: return "paused" as const;
    case RunStatus.BLOCKED: return "blocked" as const;
    case RunStatus.FAILED: return "failed" as const;
    case RunStatus.COMPLETED: return "completed" as const;
    case RunStatus.CANCELLED: return "cancelled" as const;
    default: throw new HttpError(400, "Unknown dashboard list status");
  }
};

type RunEventsCursor = {
  readonly occurredAt: string;
  readonly id: string;
};

const encodeRunEventsCursor = (value: RunEventsCursor) =>
  btoa(JSON.stringify(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");

const decodeRunEventsCursor = (encoded: string): RunEventsCursor => {
  try {
    const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded)) as Partial<RunEventsCursor>;
    if (
      typeof parsed.occurredAt !== "string" ||
      typeof parsed.id !== "string" ||
      parsed.id.length === 0
    ) throw new Error("invalid event cursor shape");
    return { occurredAt: parsed.occurredAt, id: parsed.id };
  } catch {
    throw new HttpError(400, "Invalid run event cursor");
  }
};

type RunRelations = {
  readonly attachmentsByRun: Map<string, IssueAttachmentRow[]>;
  readonly prerequisitesByRun: Map<string, IssueDependencyRow[]>;
  readonly dependentsByRun: Map<string, IssueDependencyRow[]>;
  readonly hierarchyByRun: Map<string, IssueHierarchyRow[]>;
  readonly relatedByRun: Map<string, IssueRelationRow[]>;
  readonly resultReviewsByRun: Map<string, IssueResultReviewRow[]>;
};

export const dashboardListPatch = <Input, Output>(
  values: readonly Input[] | null,
  map: (value: Input) => Output,
) => values === null ? undefined : { values: values.map(map) };

function indexRunRelations(
  attachments: readonly IssueAttachmentRow[],
  dependencies: readonly IssueDependencyRow[],
  hierarchy: readonly IssueHierarchyRow[],
  related: readonly IssueRelationRow[],
  resultReviews: readonly IssueResultReviewRow[],
  runIds?: ReadonlySet<string>,
): RunRelations {
  const attachmentsByRun = new Map<string, IssueAttachmentRow[]>();
  const prerequisitesByRun = new Map<string, IssueDependencyRow[]>();
  const dependentsByRun = new Map<string, IssueDependencyRow[]>();
  const hierarchyByRun = new Map<string, IssueHierarchyRow[]>();
  const relatedByRun = new Map<string, IssueRelationRow[]>();
  const resultReviewsByRun = new Map<string, IssueResultReviewRow[]>();
  for (const attachment of attachments) {
    if (runIds && !runIds.has(attachment.run_id)) continue;
    const rows = attachmentsByRun.get(attachment.run_id) ?? [];
    rows.push(attachment);
    attachmentsByRun.set(attachment.run_id, rows);
  }
  for (const dependency of dependencies) {
    if (!runIds || runIds.has(dependency.dependent_run_id)) {
      const rows = prerequisitesByRun.get(dependency.dependent_run_id) ?? [];
      rows.push(dependency);
      prerequisitesByRun.set(dependency.dependent_run_id, rows);
    }
    if (!runIds || runIds.has(dependency.prerequisite_run_id)) {
      const rows = dependentsByRun.get(dependency.prerequisite_run_id) ?? [];
      rows.push(dependency);
      dependentsByRun.set(dependency.prerequisite_run_id, rows);
    }
  }
  for (const link of hierarchy) {
    for (const runId of [link.parent_run_id, link.child_run_id]) {
      if (runIds && !runIds.has(runId)) continue;
      const rows = hierarchyByRun.get(runId) ?? [];
      rows.push(link);
      hierarchyByRun.set(runId, rows);
    }
  }
  for (const relation of related) {
    for (const runId of [relation.first_run_id, relation.second_run_id]) {
      if (runIds && !runIds.has(runId)) continue;
      const rows = relatedByRun.get(runId) ?? [];
      rows.push(relation);
      relatedByRun.set(runId, rows);
    }
  }
  for (const review of resultReviews) {
    if (runIds && !runIds.has(review.run_id)) continue;
    const rows = resultReviewsByRun.get(review.run_id) ?? [];
    rows.push(review);
    resultReviewsByRun.set(review.run_id, rows);
  }
  return {
    attachmentsByRun,
    prerequisitesByRun,
    dependentsByRun,
    hierarchyByRun,
    relatedByRun,
    resultReviewsByRun,
  };
}

const runJsonWithRelations = (
  run: Parameters<typeof dashboardRunJson>[0],
  relations: RunRelations,
) => dashboardRunJson(
  run,
  relations.attachmentsByRun.get(run.id) ?? [],
  relations.prerequisitesByRun.get(run.id) ?? [],
  relations.dependentsByRun.get(run.id) ?? [],
  relations.hierarchyByRun.get(run.id) ?? [],
  relations.relatedByRun.get(run.id) ?? [],
  relations.resultReviewsByRun.get(run.id) ?? [],
);

export const createAppDashboardService = (
  { request, auth, db, archivesBucket }: AppConnectDashboardInput,
): ServiceImpl<typeof DashboardService> => ({
  getDashboard: async (rpcRequest) => {
    const input = decodeTeamId({ teamId: rpcRequest.teamId });
    const session = await requireSession(auth, request);
    const project = await getTeam(db, input.teamId, session.user.id);
    if (!project) throw new HttpError(404, "Project not found");

    // Read the cursor before the projection so every concurrent mutation is
    // either visible here or guaranteed to be returned by SyncDashboard.
    const cursor = await getDashboardSyncCursor(db, project.id);
    const observedAt = new Date().toISOString();
    const [
      runs,
      projectSettings,
      checkpointPolicy,
      attachments,
      dependencies,
      hierarchy,
      related,
      resultReviews,
      workers,
      organizationProviders,
      executionPolicy,
      members,
      conversationNotifications,
      channelNotifications,
    ] = await Promise.all([
      listDashboardRuns(db, project.id),
      getTeamSettings(db, project.id),
      loadWorkflowCheckpointPolicy(db, project.id, session.user.id),
      listIssueAttachments(db, project.id),
      listIssueDependencies(db, project.id),
      listIssueHierarchy(db, project.id),
      listIssueRelations(db, project.id),
      listIssueResultReviews(db, project.id),
      listExecutionWorkers(db, project.id, observedAt),
      listOrganizationExecutionProviders(db, project.organization_id),
      getProjectExecutionWorkerPolicy(db, project.id),
      listProjectMembers(db, project.id),
      listIssueConversationNotifications(db, project.id, session.user.id),
      listChannelConversationNotifications(
        db,
        project.organization_id,
        session.user.id,
      ),
    ]);
    const relations = indexRunRelations(
      attachments,
      dependencies,
      hierarchy,
      related,
      resultReviews,
    );
    return {
      team: appProject(project),
      settings: appProjectSettings(settingsJson(
        projectSettings,
        checkpointPolicyJson(checkpointPolicy),
      )),
      runs: runs.map((run) =>
        appDashboardRun(runJsonWithRelations(run, relations))
      ),
      workers: workers.map((worker) =>
        appDashboardWorker(workerJson(worker, observedAt))
      ),
      organizationProviders: organizationProviders.map(
        (provider) => appAgentProvider[provider],
      ),
      executionPolicy: appExecutionPolicy(executionPolicy),
      members: members.map((member) => appOrganizationMember(member)),
      conversationNotifications: conversationNotifications.map(
        (notification) => appConversationNotification(
          issueConversationNotificationJson(notification),
        ),
      ),
      channelNotifications: channelNotifications.map((notification) =>
        appChannelNotification(
          channelConversationNotificationJson(notification),
        )
      ),
      cursor: BigInt(cursor),
      generatedAt: timestampFromDate(new Date(observedAt)),
    };
  },

  listDashboardRuns: async (rpcRequest) => {
    const input = decodeTeamId({ teamId: rpcRequest.teamId });
    const session = await requireSession(auth, request);
    const project = await getTeam(db, input.teamId, session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const cursor = rpcRequest.cursor
      ? (() => {
          try {
            return decodeDashboardRunListCursor(rpcRequest.cursor);
          } catch {
            throw new HttpError(400, "Invalid dashboard list cursor");
          }
        })()
      : null;
    // System edge: protobuf carries the id as a plain string, and the RPC field
    // name is what identifies it as a planning Project rather than a Team.
    const planningProjectId = rpcRequest.planningProjectId
      ? asPlanningProjectId(
          decodeRequestSync(Schema.Struct({ planningProjectId: UuidString }))({
            planningProjectId: rpcRequest.planningProjectId,
          }).planningProjectId,
        )
      : null;
    const observedAt = new Date().toISOString();
    const page = await listDashboardRunSummaries(db, project.id, {
      pageSize: rpcRequest.pageSize,
      cursor,
      sources: rpcRequest.sources.map(sourceForList),
      statuses: rpcRequest.statuses.map(statusForList),
      query: rpcRequest.query ?? null,
      planningProjectId,
    }, observedAt);
    return {
      runs: page.rows.map((run) =>
        appDashboardRunSummary(dashboardRunSummaryJson(run))
      ),
      nextCursor: page.nextCursor
        ? encodeDashboardRunListCursor(page.nextCursor)
        : undefined,
      generatedAt: timestampFromDate(new Date(observedAt)),
    };
  },

  syncDashboard: async (rpcRequest) => {
    const input = decodeTeamId({ teamId: rpcRequest.teamId });
    if (
      rpcRequest.cursor < 0n ||
      rpcRequest.cursor > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new HttpError(400, "Dashboard cursor is outside the safe range");
    }
    const session = await requireSession(auth, request);
    const project = await getTeam(db, input.teamId, session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const page = await listDashboardChanges(
      db,
      project.id,
      Number(rpcRequest.cursor),
    );
    const observedAt = new Date().toISOString();
    if (page.expired) {
      return {
        cursor: BigInt(page.nextCursor),
        hasMore: false,
        reset: true,
        runs: [],
        deletedRunIds: [],
        workers: [],
        organizationProviders: [],
        channelNotifications: [],
        generatedAt: timestampFromDate(new Date(observedAt)),
      };
    }

    const changedRunIds = new Set(page.changes.flatMap((change) =>
      change.entity_type === "run" && change.entity_id
        ? [change.entity_id]
        : []
    ));
    const changedRunIdList = [...changedRunIds];
    const metadataChanged = page.changes.some(
      (change) => change.entity_type === "metadata",
    );
    const notificationsChanged = page.changes.some(
      (change) =>
        change.entity_type === "notifications" ||
        change.entity_type === "run",
    );
    const [
      dashboardRows,
      attachments,
      dependencies,
      hierarchy,
      related,
      resultReviews,
      workers,
      organizationProviders,
    ] = await Promise.all([
      listDashboardRunsByIds(db, project.id, changedRunIdList),
      listIssueAttachmentsByRunIds(db, project.id, changedRunIdList),
      listIssueDependenciesByRunIds(db, project.id, changedRunIdList),
      listIssueHierarchyByRunIds(db, project.id, changedRunIdList),
      listIssueRelationsByRunIds(db, project.id, changedRunIdList),
      listIssueResultReviewsByRunIds(db, project.id, changedRunIdList),
      listExecutionWorkers(db, project.id, observedAt),
      listOrganizationExecutionProviders(db, project.organization_id),
    ]);
    const relations = indexRunRelations(
      attachments,
      dependencies,
      hierarchy,
      related,
      resultReviews,
      changedRunIds,
    );
    const existingRunIds = new Set(dashboardRows.map((run) => run.id));
    const metadata = metadataChanged
      ? await Promise.all([
          getTeamSettings(db, project.id),
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
    const channelNotifications = await listChannelConversationNotifications(
      db,
      project.organization_id,
      session.user.id,
    );

    return {
      cursor: BigInt(page.nextCursor),
      hasMore: page.hasMore,
      reset: false,
      runs: dashboardRows.map((run) =>
        appDashboardRun(runJsonWithRelations(run, relations))
      ),
      deletedRunIds: changedRunIdList.filter(
        (runId) => !existingRunIds.has(runId),
      ),
      team: metadata ? appProject(project) : undefined,
      settings: metadata
        ? appProjectSettings(settingsJson(
            metadata[0],
            checkpointPolicyJson(metadata[1]),
          ))
        : undefined,
      workers: workers.map((worker) =>
        appDashboardWorker(workerJson(worker, observedAt))
      ),
      organizationProviders: organizationProviders.map(
        (provider) => appAgentProvider[provider],
      ),
      executionPolicy: metadata
        ? appExecutionPolicy(metadata[2])
        : undefined,
      members: dashboardListPatch(
        metadata?.[3] ?? null,
        appOrganizationMember,
      ),
      conversationNotifications: dashboardListPatch(
        conversationNotifications,
        (notification) => appConversationNotification(
          issueConversationNotificationJson(notification),
        ),
      ),
      channelNotifications: channelNotifications.map((notification) =>
        appChannelNotification(
          channelConversationNotificationJson(notification),
        )
      ),
      generatedAt: timestampFromDate(new Date(observedAt)),
    };
  },

  listRunEvents: async (rpcRequest) => {
    const input = decodeRunIds({
      teamId: rpcRequest.teamId,
      runId: rpcRequest.runId,
    });
    const session = await requireSession(auth, request);
    const project = await getTeam(db, input.teamId, session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const run = await getHuntRunForProject(db, project.id, input.runId);
    if (!run) throw new HttpError(404, "Run not found");
    const limit = Math.max(
      25,
      Math.min(100, rpcRequest.limit > 0 ? rpcRequest.limit : 50),
    );
    const cursor = rpcRequest.cursor
      ? decodeRunEventsCursor(rpcRequest.cursor)
      : null;
    let events: Awaited<ReturnType<typeof listHuntRunEventsPage>>["events"];
    let nextCursor: RunEventsCursor | null;
    if (!rpcRequest.includeArchived) {
      const page = await listHuntRunEventsPage(db, project.id, run.id, {
        limit,
        cursor,
      });
      events = page.events;
      nextCursor = page.nextCursor;
    } else {
      const [hotEvents, archivedEvents] = await Promise.all([
        listHuntRunEvents(db, project.id, run.id),
        listArchivedRunEvents(db, archivesBucket, project.id, run.id),
      ]);
      const merged = [
        ...new Map(
          [...archivedEvents, ...hotEvents].map((event) => [event.id, event]),
        ).values(),
      ].sort(
        (left, right) =>
          right.occurred_at.localeCompare(left.occurred_at) ||
          right.id.localeCompare(left.id),
      );
      const afterCursor = cursor
        ? merged.filter(
            (event) =>
              event.occurred_at < cursor.occurredAt ||
              (event.occurred_at === cursor.occurredAt &&
                event.id < cursor.id),
          )
        : merged;
      events = afterCursor.slice(0, limit);
      const last = events.at(-1);
      nextCursor = afterCursor.length > limit && last
        ? { occurredAt: last.occurred_at, id: last.id }
        : null;
    }
    const actorNames = await resolveHuntEventActorNames(
      db,
      project.id,
      events.map((event) => event.actor),
    );
    return {
      events: events.map((event) =>
        appRunEvent(dashboardEventJson(event, actorNames))
      ),
      nextCursor: nextCursor ? encodeRunEventsCursor(nextCursor) : undefined,
      hasMore: nextCursor !== null,
      archivesIncluded: rpcRequest.includeArchived,
    };
  },
});

export function registerAppDashboardService(
  router: ConnectRouter,
  input: AppConnectDashboardInput,
) {
  router.service(DashboardService, createAppDashboardService(input));
}
