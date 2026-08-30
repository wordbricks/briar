import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ConnectRouter } from "@connectrpc/connect";
import {
  DashboardService,
} from "@briar/contracts/gen/briar/app/v1/dashboard_pb";
import * as Schema from "effect/Schema";
import { listArchivedRunEvents } from "./archive";
import type { BriarAuth } from "./auth";
import {
  getDashboardSyncCursor,
  listDashboardChanges,
} from "./dashboard-change-repository";
import { dashboardEventJson, dashboardRunJson } from "./dashboard-json";
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
  listIssueResultReviews,
  listIssueResultReviewsByRunIds,
  resolveHuntEventActorNames,
  type IssueAttachmentRow,
  type IssueDependencyRow,
  type IssueResultReviewRow,
} from "./db";
import { HttpError } from "./http-response";
import {
  channelConversationNotificationJson,
  issueConversationNotificationJson,
} from "./issue-conversation-json";
import { listProjectMembers } from "./organization-repository";
import { withConnectErrors } from "./app-connect-errors";
import {
  appAgentProvider,
  appChannelNotification,
  appConversationNotification,
  appDashboardRun,
  appDashboardWorker,
  appExecutionPolicy,
  appOrganizationMember,
  appProject,
  appProjectSettings,
  appRunEvent,
} from "./app-connect-mappers";
import { settingsJson } from "./project-settings-json";
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

const decodeProjectId = decodeRequestSync(Schema.Struct({
  projectId: UuidString,
}));

const decodeRunIds = decodeRequestSync(Schema.Struct({
  projectId: UuidString,
  runId: UuidString,
}));

type RunRelations = {
  readonly attachmentsByRun: Map<string, IssueAttachmentRow[]>;
  readonly prerequisitesByRun: Map<string, IssueDependencyRow[]>;
  readonly dependentsByRun: Map<string, IssueDependencyRow[]>;
  readonly resultReviewsByRun: Map<string, IssueResultReviewRow[]>;
};

function indexRunRelations(
  attachments: readonly IssueAttachmentRow[],
  dependencies: readonly IssueDependencyRow[],
  resultReviews: readonly IssueResultReviewRow[],
  runIds?: ReadonlySet<string>,
): RunRelations {
  const attachmentsByRun = new Map<string, IssueAttachmentRow[]>();
  const prerequisitesByRun = new Map<string, IssueDependencyRow[]>();
  const dependentsByRun = new Map<string, IssueDependencyRow[]>();
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
  relations.resultReviewsByRun.get(run.id) ?? [],
);

export const createAppDashboardService = (
  { request, auth, db, archivesBucket }: AppConnectDashboardInput,
) => ({
  getDashboard: async (rpcRequest: { readonly projectId: string }) =>
    withConnectErrors(async () => {
      const input = decodeProjectId({ projectId: rpcRequest.projectId });
      const session = await requireSession(auth, request);
      const project = await getProject(db, input.projectId, session.user.id);
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
        resultReviews,
        workers,
        organizationProviders,
        executionPolicy,
        members,
        conversationNotifications,
        channelNotifications,
      ] = await Promise.all([
        listDashboardRuns(db, project.id),
        getProjectSettings(db, project.id),
        loadWorkflowCheckpointPolicy(db, project.id, session.user.id),
        listIssueAttachments(db, project.id),
        listIssueDependencies(db, project.id),
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
        resultReviews,
      );
      return {
        project: appProject(project),
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
    }),

  syncDashboard: async (rpcRequest: {
    readonly projectId: string;
    readonly cursor: bigint;
  }) => withConnectErrors(async () => {
    const input = decodeProjectId({ projectId: rpcRequest.projectId });
    if (
      rpcRequest.cursor < 0n ||
      rpcRequest.cursor > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new HttpError(400, "Dashboard cursor is outside the safe range");
    }
    const session = await requireSession(auth, request);
    const project = await getProject(db, input.projectId, session.user.id);
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
        members: [],
        conversationNotifications: [],
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
      resultReviews,
      workers,
      organizationProviders,
    ] = await Promise.all([
      listDashboardRunsByIds(db, project.id, changedRunIdList),
      listIssueAttachmentsByRunIds(db, project.id, changedRunIdList),
      listIssueDependenciesByRunIds(db, project.id, changedRunIdList),
      listIssueResultReviewsByRunIds(db, project.id, changedRunIdList),
      listExecutionWorkers(db, project.id, observedAt),
      listOrganizationExecutionProviders(db, project.organization_id),
    ]);
    const relations = indexRunRelations(
      attachments,
      dependencies,
      resultReviews,
      changedRunIds,
    );
    const existingRunIds = new Set(dashboardRows.map((run) => run.id));
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
      project: metadata ? appProject(project) : undefined,
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
      members: metadata
        ? metadata[3].map((member) => appOrganizationMember(member))
        : [],
      conversationNotifications: conversationNotifications
        ? conversationNotifications.map((notification) =>
            appConversationNotification(
              issueConversationNotificationJson(notification),
            )
          )
        : [],
      channelNotifications: channelNotifications.map((notification) =>
        appChannelNotification(
          channelConversationNotificationJson(notification),
        )
      ),
      generatedAt: timestampFromDate(new Date(observedAt)),
    };
  }),

  listRunEvents: async (rpcRequest: {
    readonly projectId: string;
    readonly runId: string;
  }) => withConnectErrors(async () => {
    const input = decodeRunIds({
      projectId: rpcRequest.projectId,
      runId: rpcRequest.runId,
    });
    const session = await requireSession(auth, request);
    const project = await getProject(db, input.projectId, session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const run = await getHuntRunForProject(db, project.id, input.runId);
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
    return {
      events: events.map((event) =>
        appRunEvent(dashboardEventJson(event, actorNames))
      ),
    };
  }),
});

export function registerAppDashboardService(
  router: ConnectRouter,
  input: AppConnectDashboardInput,
) {
  router.service(DashboardService, createAppDashboardService(input));
}
