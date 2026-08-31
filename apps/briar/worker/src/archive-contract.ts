import * as Schema from "effect/Schema";
import { agentProviders } from "../../src/lib/agent-provider";
import type {
  HuntEventRow,
  IssueMessageRow,
  ProjectAgentSessionRow,
  RunEvidenceImageRow,
  RunEvidenceRow,
} from "./db";
import type { TranscriptSessionRow } from "./workers";
import type {
  AgentTranscriptSegmentRow,
  AgentWorkLogEntryRow,
} from "./agent-worklog";
import {
  PositiveSafeInteger,
  strictSchemaOptions,
} from "./schema-codecs";

export const archiveFormatVersion = 2;

const archiveKinds = [
  "run_events",
  "run_evidence",
  "execution_audit",
  "agent_transcript",
  "issue_messages",
  "project_agent_sessions",
] as const;

export type ArchiveKind = (typeof archiveKinds)[number];

const ArchiveKind = Schema.Literals(archiveKinds);

const archiveRecordTypes = [
  "hunt_event",
  "run_evidence",
  "run_evidence_image",
  "execution_audit",
  "transcript_session",
  "worklog_entry",
  "transcript_segment",
  "issue_message",
  "project_agent_session",
] as const;

export const ArchiveManifest = Schema.Struct({
  recordType: Schema.Literal("manifest"),
  formatVersion: Schema.Literal(archiveFormatVersion),
  archiveId: Schema.String.check(Schema.isLengthBetween(64, 64)),
  projectId: Schema.String.check(Schema.isMinLength(1)),
  runId: Schema.NullOr(Schema.String),
  scopeId: Schema.String.check(Schema.isMinLength(1)),
  kind: ArchiveKind,
  rowCount: PositiveSafeInteger,
  periodStart: Schema.String,
  periodEnd: Schema.String,
  createdAt: Schema.String,
});

export const ArchiveLine = Schema.Struct({
  recordType: Schema.Literals(archiveRecordTypes),
  data: Schema.Json,
});

const NullableString = Schema.NullOr(Schema.String);
const FiniteNumber = Schema.Finite;

export const ArchivedHuntEvent = Schema.Struct({
  id: Schema.String,
  run_id: Schema.String,
  event_key: Schema.String,
  attempt: FiniteNumber,
  revision: FiniteNumber,
  stage: Schema.Literals([
    "queued",
    "analyzing",
    "implementing",
    "pr_open",
    "staging_qa",
    "production_qa",
    "completed",
    "blocked",
    "failed",
    "cancelled",
  ]),
  status: Schema.Literals([
    "backlog",
    "queued",
    "running",
    "blocked",
    "failed",
    "completed",
    "cancelled",
  ]),
  workflow_stage: NullableString,
  detail: NullableString,
  actor: Schema.String,
  branch: NullableString,
  commit_sha: NullableString,
  qa_status: Schema.NullOr(Schema.Literals(["pending", "passed", "skipped"])),
  tracker_issue_state: NullableString,
  pull_request_urls: Schema.String,
  target_sha: NullableString,
  occurred_at: Schema.String,
  recorded_at: Schema.String,
});

export const ArchivedRunEvidence = Schema.Struct({
  id: Schema.String,
  run_id: Schema.String,
  attempt: FiniteNumber,
  revision: FiniteNumber,
  evidence_key: Schema.String,
  workflow_stage: Schema.String,
  evidence_type: Schema.String,
  status: Schema.Literals(["pending", "passed", "failed", "skipped"]),
  detail: NullableString,
  command: NullableString,
  url: NullableString,
  metadata_json: NullableString,
  actor: Schema.String,
  observed_at: Schema.String,
  recorded_at: Schema.String,
});

export const ArchivedRunEvidenceImage = Schema.Struct({
  id: Schema.String,
  project_id: Schema.String,
  run_id: Schema.String,
  evidence_id: Schema.String,
  object_key: Schema.String,
  filename: Schema.String,
  content_type: Schema.String,
  byte_size: FiniteNumber,
  sha256: Schema.String,
  position: FiniteNumber,
  created_at: Schema.String,
});

export const ArchivedIssueMessage = Schema.Struct({
  id: Schema.String,
  run_id: Schema.String,
  parent_message_id: NullableString,
  author_user_id: NullableString,
  author_agent_id: NullableString,
  author_agent_name: NullableString,
  author_agent_provider: Schema.NullOr(Schema.Literals(agentProviders)),
  author_name: NullableString,
  author_image: NullableString,
  author_agent_image: NullableString,
  body: Schema.String,
  reply_count: FiniteNumber,
  created_at: Schema.String,
  updated_at: Schema.String,
});

export const ArchivedProjectAgentSession = Schema.Struct({
  project_id: Schema.String,
  id: Schema.String,
  agent_id: NullableString,
  requested_by_user_id: NullableString,
  status: Schema.Literals([
    "running",
    "completed",
    "failed",
    "skipped",
    "interrupted",
  ]),
  session_type: Schema.Literals(["task", "dispatch"]),
  payload_json: Schema.String,
  started_at: Schema.String,
  completed_at: NullableString,
  updated_at: Schema.String,
});

export const ArchivedTranscriptSession = Schema.Struct({
  session_id: Schema.String,
  project_id: Schema.String,
  run_id: NullableString,
  worker_id: NullableString,
  agent_provider: Schema.Literals(agentProviders),
  started_at: Schema.String,
  last_event_at: Schema.String,
  event_count: FiniteNumber,
  byte_count: FiniteNumber,
});

export const ArchivedWorkLogEntry = Schema.Struct({
  session_id: Schema.String,
  entry_id: Schema.String,
  sequence: FiniteNumber,
  updated_sequence: FiniteNumber,
  entry_type: Schema.Literals(["message", "activity"]),
  activity_kind: Schema.NullOr(
    Schema.Literals(["command", "fileChange", "webSearch", "tool"]),
  ),
  phase: NullableString,
  title: NullableString,
  body: Schema.String,
  status: Schema.Literals([
    "writing",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ]),
  started_at: Schema.String,
  updated_at: Schema.String,
  completed_at: NullableString,
});

export const ArchivedTranscriptSegment = Schema.Struct({
  session_id: Schema.String,
  first_sequence: FiniteNumber,
  last_sequence: FiniteNumber,
  object_key: Schema.String,
  event_count: FiniteNumber,
  uncompressed_bytes: FiniteNumber,
  compressed_bytes: FiniteNumber,
  sha256: Schema.String,
  recorded_at: Schema.String,
});

export type ExecutionAuditArchiveRow = {
  id: string;
  run_id: string | null;
  worker_id: string | null;
  agent_id: string | null;
  actor_user_id: string | null;
  actor_device_id: string | null;
  action: string;
  request_id: string | null;
  detail_json: string;
  occurred_at: string;
};

export const ArchivedExecutionAudit = Schema.Struct({
  id: Schema.String,
  run_id: NullableString,
  worker_id: NullableString,
  agent_id: NullableString,
  actor_user_id: NullableString,
  actor_device_id: NullableString,
  action: Schema.String,
  request_id: NullableString,
  detail_json: Schema.String,
  occurred_at: Schema.String,
});

export const RelatedArchiveObjectKeys = Schema.mutable(
  Schema.Array(
    Schema.Trimmed.check(Schema.isLengthBetween(1, 1_024)),
  ),
);

const StoredRelatedArchiveObjectKeys = Schema.fromJsonString(
  RelatedArchiveObjectKeys,
);

const decodeArchiveSync = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
) => Schema.decodeUnknownSync(schema, strictSchemaOptions);

export const decodeArchiveManifest = decodeArchiveSync(ArchiveManifest);
export const decodeArchiveLine = decodeArchiveSync(ArchiveLine);
export const decodeArchivedHuntEvent: (input: unknown) => HuntEventRow =
  decodeArchiveSync(ArchivedHuntEvent);
export const decodeArchivedRunEvidence: (input: unknown) => RunEvidenceRow =
  decodeArchiveSync(ArchivedRunEvidence);
export const decodeArchivedRunEvidenceImage:
  (input: unknown) => RunEvidenceImageRow =
    decodeArchiveSync(ArchivedRunEvidenceImage);
export const decodeArchivedIssueMessage: (input: unknown) => IssueMessageRow =
  decodeArchiveSync(ArchivedIssueMessage);
export const decodeArchivedProjectAgentSession:
  (input: unknown) => ProjectAgentSessionRow =
    decodeArchiveSync(ArchivedProjectAgentSession);
export const decodeArchivedTranscriptSession:
  (input: unknown) => TranscriptSessionRow =
    decodeArchiveSync(ArchivedTranscriptSession);
export const decodeArchivedWorkLogEntry:
  (input: unknown) => AgentWorkLogEntryRow =
    decodeArchiveSync(ArchivedWorkLogEntry);
export const decodeArchivedTranscriptSegment:
  (input: unknown) => AgentTranscriptSegmentRow =
    decodeArchiveSync(ArchivedTranscriptSegment);
export const decodeArchivedExecutionAudit:
  (input: unknown) => ExecutionAuditArchiveRow =
    decodeArchiveSync(ArchivedExecutionAudit);

export const decodeRelatedArchiveObjectKeys = Schema.decodeUnknownSync(
  StoredRelatedArchiveObjectKeys,
  strictSchemaOptions,
);
export const encodeRelatedArchiveObjectKeys = Schema.encodeSync(
  StoredRelatedArchiveObjectKeys,
  strictSchemaOptions,
);
