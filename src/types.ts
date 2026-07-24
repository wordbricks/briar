import {
  autoHuntRunStatuses,
  type AutoHuntQaStatus,
  type AutoHuntRunStatus,
  type AutoHuntSource,
  type AutoHuntWorkflow,
  type AutoHuntWorkflowStageId,
} from "./lib/auto-hunt-contract";
import type { AutoHuntAutomation } from "./lib/auto-hunt-automation";
import type { AgentProvider } from "./lib/project-llm";

export const huntStatuses = autoHuntRunStatuses;
export type HuntStatus = AutoHuntRunStatus;
export type HuntSource = AutoHuntSource;

export type TrackerReference = {
  provider: string;
  issueId: string | null;
  identifier: string | null;
  url: string | null;
  state: string | null;
};

export type IssueAttachment = {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  url: string;
};

export type CreateIssueInput = {
  title: string;
  description: string | null;
  priority: number | null;
  attachments: File[];
};

export type HuntEvent = {
  id: string;
  attempt: number;
  status: HuntStatus;
  workflowStage: AutoHuntWorkflowStageId | null;
  detail: string | null;
  actor: string;
  qaStatus: AutoHuntQaStatus | null;
  trackerState: string | null;
  pullRequestUrls: string[];
  targetSha: string | null;
  occurredAt: string;
  recordedAt: string;
};

export type IssueMessageAuthor = {
  id: string | null;
  name: string;
  image: string | null;
  provider: AgentProvider | null;
};

export type IssueMessage = {
  id: string;
  runId: string;
  parentMessageId: string | null;
  body: string;
  author: IssueMessageAuthor;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
};

export type IssueMessageSendResult = {
  message: IssueMessage;
  agentReply: Promise<IssueMessage> | null;
};

export type HuntRun = {
  id: string;
  runNumber: number;
  currentAttempt: number;
  source: HuntSource;
  sourceKey: string;
  title: string;
  status: HuntStatus;
  workflowStage: AutoHuntWorkflowStageId | null;
  workflow: AutoHuntWorkflow;
  progress: number;
  detail: string | null;
  priority: number | null;
  repository: string;
  branch: string | null;
  commitSha: string | null;
  tracker: TrackerReference | null;
  issueDescription: string | null;
  attachments: IssueAttachment[];
  resultSummary: string | null;
  pullRequestUrls: string[];
  targetSha: string | null;
  sourceCreatedAt: string | null;
  stagingQaStatus: AutoHuntQaStatus | null;
  productionQaStatus: AutoHuntQaStatus | null;
  stagingQaDetail: string | null;
  productionQaDetail: string | null;
  context: Record<string, unknown> | null;
  claimedBy: string | null;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
  claimAttempts: number;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  events: HuntEvent[];
};

export type HuntRunPlacement = {
  status: HuntStatus;
  workflowStage: AutoHuntWorkflowStageId | null;
};

export type Project = {
  id: string;
  name: string;
  organizationId?: string;
  organizationName?: string;
  role?: "owner" | "admin" | "member";
  createdAt: string;
};

export type Organization = {
  id: string;
  name: string;
  handle: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
};

export type OrganizationMember = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: "owner" | "admin" | "member";
  createdAt: string;
};

export type ProjectSettings = {
  velenOrg: string | null;
  dataSource: string | null;
  linear: {
    enabled: boolean;
    source: string | null;
    teamKey: string | null;
  };
  githubRepository: string | null;
  workflow: AutoHuntWorkflow;
  automation: AutoHuntAutomation;
};

export type DashboardPayload = {
  project: Project;
  settings: ProjectSettings;
  runs: HuntRun[];
  generatedAt: string;
};

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};
