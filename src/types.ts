export const huntStages = [
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
] as const;

export type HuntStage = (typeof huntStages)[number];
export type HuntSource = "issue" | "error" | "feedback";

export type HuntEvent = {
  id: string;
  stage: HuntStage;
  detail: string | null;
  actor: string;
  occurredAt: string;
};

export type HuntRun = {
  id: string;
  runNumber: number;
  source: HuntSource;
  sourceKey: string;
  title: string;
  stage: HuntStage;
  progress: number;
  detail: string | null;
  repository: string;
  branch: string | null;
  commitSha: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  events: HuntEvent[];
};

export type Project = {
  id: string;
  name: string;
  repositoryPath: string;
  createdAt: string;
};

export type DashboardPayload = {
  project: Project;
  runs: HuntRun[];
  generatedAt: string;
};

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};
