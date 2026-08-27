import { isRepositoryWorkflowPending } from "../../src/lib/auto-hunt-contract";
import type {
  ChannelIssueBatchResultItem,
  ChannelIssueBatchProposalPayload,
} from "../../src/lib/channels-contract";
import { channelRelatedMessageReference } from "./channel-proposal-helpers";
import { stableJson } from "./hunt-run-codec";
import type { ProjectRow } from "./project-repository";
import { getProjectSettings } from "./project-settings-repository";
import { digestRunId } from "./run-identity";
import { workflowSnapshotForRun } from "./workflow-policy";

type ReservedBatchItem = ChannelIssueBatchResultItem & {
  position: number;
  sourceKey: string;
  issue: ChannelIssueBatchProposalPayload["batch"]["items"][number]["issue"];
};

const batchItemSourceKey = async (reservationKey: string, localKey: string) => {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${reservationKey}\u0000${localKey}`),
  ));
  const suffix = [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `briar-channel-batch-approved:${suffix}`;
};

export async function reserveChannelIssueBatchItems(input: {
  projectId: string;
  reservationSourceKey: string;
  batch: ChannelIssueBatchProposalPayload["batch"];
}) {
  const items: ReservedBatchItem[] = [];
  for (const [position, item] of input.batch.items.entries()) {
    const sourceKey = position === 0
      ? input.reservationSourceKey
      : await batchItemSourceKey(input.reservationSourceKey, item.key);
    items.push({
      localKey: item.key,
      position,
      sourceKey,
      runId: await digestRunId(input.projectId, "issue", sourceKey),
      issue: item.issue,
    });
  }
  return items;
}

export async function listChannelIssueBatchItems(
  db: D1Database,
  proposalId: string,
) {
  const rows = await db.prepare(
    `select local_key, run_id
     from briar_channel_issue_batch_items
     where proposal_id = ? order by position`,
  ).bind(proposalId).all<{ local_key: string; run_id: string }>();
  return rows.results.map((row) => ({
    localKey: row.local_key,
    runId: row.run_id,
  }));
}

export async function materializeChannelIssueBatch(input: {
  db: D1Database;
  project: Pick<ProjectRow, "id" | "name">;
  organizationId: string;
  channelId: string;
  proposalId: string;
  messageId: string;
  rootMessageId: string | null;
  proposalPayloadJson: string;
  proposalCreatedAt: string;
  approvedAt: string;
  approvedByUserId: string;
  reservationSourceKey: string;
  batch: ChannelIssueBatchProposalPayload["batch"];
}) {
  const [settings, workflow, items] = await Promise.all([
    getProjectSettings(input.db, input.project.id),
    workflowSnapshotForRun(
      input.db,
      input.project.id,
      input.approvedByUserId,
      [],
      false,
    ),
    reserveChannelIssueBatchItems({
      projectId: input.project.id,
      reservationSourceKey: input.reservationSourceKey,
      batch: input.batch,
    }),
  ]);
  if (isRepositoryWorkflowPending(workflow)) {
    throw new Error("Repository workflow has not been generated for this project");
  }

  const repository = settings?.github_repository ?? input.project.name;
  const recordedAt = new Date().toISOString();
  const relatedMessage = channelRelatedMessageReference({
    organizationId: input.organizationId,
    channelId: input.channelId,
    messageId: input.messageId,
    rootMessageId: input.rootMessageId,
  });
  const itemByKey = new Map(items.map((item) => [item.localKey, item]));
  const statements: D1PreparedStatement[] = [];

  for (const item of items) {
    statements.push(
      input.db.prepare(
        `insert into briar_hunt_runs (
           id, project_id, source, source_key, title, stage, status,
           workflow_stage, workflow_snapshot_json, issue_checkpoints_json,
           detail, priority, created_by_user_id, repository,
           issue_description, pull_request_urls, source_created_at,
           context_json, started_at, last_event_at, created_at, updated_at
         ) select
           ?, ?, 'issue', ?, ?, 'queued', 'backlog', null, ?, '[]',
           ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?
         from briar_channel_action_proposals proposal
         where proposal.id = ? and proposal.channel_id = ?
           and proposal.status = 'pending'
           and proposal.action_type = 'request_issue_create'
           and proposal.project_id = ? and proposal.issue_source_key = ?
           and proposal.accepted_by_user_id = ? and proposal.accepted_at = ?`,
      ).bind(
        item.runId,
        input.project.id,
        item.sourceKey,
        item.issue.title,
        stableJson(workflow),
        "채널 대화에서 사용자가 한 번에 승인한 배치 제안으로 생성된 이슈입니다.",
        item.issue.priority,
        input.approvedByUserId,
        repository,
        item.issue.description,
        input.proposalCreatedAt,
        stableJson({
          origin: "briar-channel",
          proposalId: input.proposalId,
          channelId: input.channelId,
          issueId: input.proposalId,
          batchKey: item.localKey,
          relatedMessage,
          attachmentCount: 0,
          fullAuto: false,
        }),
        input.proposalCreatedAt,
        input.proposalCreatedAt,
        recordedAt,
        recordedAt,
        input.proposalId,
        input.channelId,
        input.project.id,
        input.reservationSourceKey,
        input.approvedByUserId,
        input.approvedAt,
      ),
      input.db.prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, attempt, revision, stage, status,
           workflow_stage, detail, actor, pull_request_urls,
           occurred_at, recorded_at
         ) values (?, ?, ?, 1, 1, 'queued', 'backlog', null, ?, ?, '[]', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        item.runId,
        `${item.sourceKey}:backlog:intake`,
        "채널 대화에서 사용자가 한 번에 승인한 배치 제안으로 생성된 이슈입니다.",
        "briar-channel",
        input.proposalCreatedAt,
        recordedAt,
      ),
      input.db.prepare(
        `insert into briar_channel_issue_batch_items (
           organization_id, channel_id, proposal_id, project_id,
           local_key, position, source_key, run_id, created_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        input.organizationId,
        input.channelId,
        input.proposalId,
        input.project.id,
        item.localKey,
        item.position,
        item.sourceKey,
        item.runId,
        input.approvedAt,
      ),
      input.db.prepare(
        `insert into briar_channel_issue_approval_audit (
           id, proposal_id, organization_id, channel_id, project_id, run_id,
           approved_by_user_id, approved_at, issue_source_key,
           result_verification, payload_json, created_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'atomic', ?, ?)`,
      ).bind(
        `${input.proposalId}:batch-approval:${item.localKey}`,
        input.proposalId,
        input.organizationId,
        input.channelId,
        input.project.id,
        item.runId,
        input.approvedByUserId,
        input.approvedAt,
        item.sourceKey,
        input.proposalPayloadJson,
        input.approvedAt,
      ),
    );
  }

  for (const dependency of input.batch.dependencies) {
    const prerequisite = itemByKey.get(dependency.prerequisiteKey)!;
    const dependent = itemByKey.get(dependency.dependentKey)!;
    statements.push(input.db.prepare(
      `insert into briar_issue_dependencies (
         project_id, prerequisite_run_id, dependent_run_id,
         created_by_user_id, created_at
       ) values (?, ?, ?, ?, ?)`,
    ).bind(
      input.project.id,
      prerequisite.runId,
      dependent.runId,
      input.approvedByUserId,
      input.approvedAt,
    ));
  }

  const first = items[0];
  statements.push(input.db.prepare(
    `update briar_channel_action_proposals
     set status = 'accepted', result_run_id = ?, updated_at = ?
     where id = ? and channel_id = ? and status = 'pending'
       and action_type = 'request_issue_create'
       and project_id = ? and issue_source_key = ?
       and accepted_by_user_id = ? and accepted_at = ?`,
  ).bind(
    first.runId,
    input.approvedAt,
    input.proposalId,
    input.channelId,
    input.project.id,
    input.reservationSourceKey,
    input.approvedByUserId,
    input.approvedAt,
  ));

  await input.db.batch(statements);
  return items.map(({ localKey, runId }) => ({ localKey, runId }));
}
