import {
  autoHuntStages,
  type AutoHuntQaStatus,
  type AutoHuntSource,
  type AutoHuntStage,
} from "./lib/auto-hunt-contract";

export const huntStages = autoHuntStages;
export type HuntStage = AutoHuntStage;
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
  stage: HuntStage;
  detail: string | null;
  actor: string;
  qaStatus: AutoHuntQaStatus | null;
  trackerState: string | null;
  pullRequestUrls: string[];
  targetSha: string | null;
  occurredAt: string;
  recordedAt: string;
};

export type HuntRun = {
  id: string;
  runNumber: number;
  currentAttempt: number;
  source: HuntSource;
  sourceKey: string;
  title: string;
  stage: HuntStage;
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

export type Project = {
  id: string;
  name: string;
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
