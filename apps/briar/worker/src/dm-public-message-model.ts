import type { AgentProvider } from "../../src/lib/agent-provider";

export type DmPublicMessagePurpose =
  | "acknowledgement"
  | "progress"
  | "discovery"
  | "question"
  | "result"
  | "conversation";

export type DmPublicMessagePublicationKind = "intermediate" | "final";

export type DmPublicMessagePartInput = {
  body: string;
  purpose: DmPublicMessagePurpose;
};

export type DmPublicMessageClaimRow = {
  job_id: string;
  organization_id: string;
  channel_id: string;
  project_id: string | null;
  owner_user_id: string;
  agent_id: string;
  agent_name: string;
  agent_provider: AgentProvider;
  roster_epoch: number;
  input_revision: number;
  trigger_message_id: string;
  trigger_source_version: number;
  reply_message_id: string;
};

export type DmPublicMessageBatchRow = {
  id: string;
  organization_id: string;
  channel_id: string;
  owner_user_id: string;
  agent_id: string;
  roster_epoch: number;
  origin_reply_job_id: string;
  input_revision: number;
  trigger_message_id: string;
  trigger_source_version: number;
  publication_kind: DmPublicMessagePublicationKind;
  payload_hash: string;
  first_sequence: number;
  last_sequence: number;
  part_count: number;
  worker_id: string;
  device_id: string;
  claim_token_hash: string;
  created_at: string;
};

export type DmPublishedMessageBatch = {
  batchId: string;
  messageIds: string[];
  firstSequence: number;
  lastSequence: number;
  publicationKind: DmPublicMessagePublicationKind;
  createdAt: string;
  payloadHash: string;
};
