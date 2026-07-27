import type { DashboardPayload, HuntEvent, HuntRun } from "../types";
import { normalizeAutoHuntWorkflow } from "./auto-hunt-contract";
import { defaultAutoHuntAutomation } from "./auto-hunt-automation";
import type { RepositoryReadiness } from "./project-connection";

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const demoWorkflow = normalizeAutoHuntWorkflow({
  version: 1,
  stages: [
    { id: "analyzing", label: "Analyze", required: true },
    { id: "implementing", label: "Implement", required: true },
    {
      id: "local_qa",
      label: "Local validation",
      required: true,
      checks: ["bun run test", "bun run build"],
    },
  ],
});

const runDefaults = {
  currentAttempt: 1,
  currentRevision: 1,
  priority: null,
  tracker: null,
  issueDescription: null,
  attachments: [],
  resultSummary: null,
  pullRequestUrls: [],
  targetSha: null,
  sourceCreatedAt: null,
  stagingQaStatus: null,
  productionQaStatus: null,
  stagingQaDetail: null,
  productionQaDetail: null,
  context: null,
  claimedBy: null,
  claimedAt: null,
  leaseExpiresAt: null,
  claimAttempts: 0,
  workflow: structuredClone(demoWorkflow),
} satisfies Pick<
  HuntRun,
  | "priority"
  | "currentAttempt"
  | "currentRevision"
  | "tracker"
  | "issueDescription"
  | "attachments"
  | "resultSummary"
  | "pullRequestUrls"
  | "targetSha"
  | "sourceCreatedAt"
  | "stagingQaStatus"
  | "productionQaStatus"
  | "stagingQaDetail"
  | "productionQaDetail"
  | "context"
  | "claimedBy"
  | "claimedAt"
  | "leaseExpiresAt"
  | "claimAttempts"
  | "workflow"
>;

const event = (
  input: Pick<
    HuntEvent,
    "id" | "status" | "workflowStage" | "detail" | "actor" | "occurredAt"
  >,
): HuntEvent => ({
  ...input,
  attempt: 1,
  revision: 1,
  qaStatus: null,
  trackerState: null,
  pullRequestUrls: [],
  targetSha: null,
  recordedAt: input.occurredAt,
});

const runs: HuntRun[] = [
  {
    ...runDefaults,
    id: "demo-1",
    runNumber: 12,
    source: "issue",
    sourceKey: "BRIAR-12",
    title: "Agent 실행 로그를 작업 상세에 연결",
    status: "running",
    workflowStage: "implementing",
    progress: 45,
    detail: "Codex가 이벤트 스트림 어댑터와 회귀 테스트를 작성하고 있습니다.",
    repository: "wordbricks/briar",
    branch: "feat/agent-event-stream",
    commitSha: "8e13ac4",
    startedAt: ago(42),
    updatedAt: ago(2),
    completedAt: null,
    events: [
      event({
        id: "event-3",
        status: "running",
        workflowStage: "implementing",
        detail: "이벤트 스트림 어댑터 구현 시작",
        actor: "codex",
        occurredAt: ago(23),
      }),
      event({
        id: "event-2",
        status: "running",
        workflowStage: "analyzing",
        detail: "로컬 Git과 Agent 실행 상태 연결 지점 확인",
        actor: "codex",
        occurredAt: ago(36),
      }),
      event({
        id: "event-1",
        status: "queued",
        workflowStage: null,
        detail: "자동사냥 작업 등록",
        actor: "briar-cli",
        occurredAt: ago(42),
      }),
    ],
  },
  {
    ...runDefaults,
    id: "demo-2",
    runNumber: 11,
    source: "feedback",
    sourceKey: "feedback-11",
    title: "대시보드 작업 상세 패널 개선",
    status: "running",
    workflowStage: "local_qa",
    progress: 65,
    detail: "PR #18의 타입체크와 리뷰 결과를 기다리고 있습니다.",
    repository: "wordbricks/briar",
    branch: "feat/hunt-details",
    commitSha: "c49b012",
    startedAt: ago(108),
    updatedAt: ago(12),
    completedAt: null,
    events: [
      event({
        id: "event-6",
        status: "running",
        workflowStage: "local_qa",
        detail: "로컬 검증 실행",
        actor: "codex",
        occurredAt: ago(12),
      }),
      event({
        id: "event-5",
        status: "running",
        workflowStage: "implementing",
        detail: "상세 패널 구현",
        actor: "codex",
        occurredAt: ago(67),
      }),
    ],
  },
  {
    ...runDefaults,
    id: "demo-3",
    runNumber: 10,
    source: "error",
    sourceKey: "error-10",
    title: "Tauri 시작 시 저장된 세션 복원 실패",
    status: "blocked",
    workflowStage: "implementing",
    progress: 50,
    detail: "Google OAuth 클라이언트 자격증명 등록이 필요합니다.",
    repository: "wordbricks/briar",
    branch: "fix/session-restore",
    commitSha: null,
    startedAt: ago(184),
    updatedAt: ago(31),
    completedAt: null,
    events: [
      event({
        id: "event-8",
        status: "blocked",
        workflowStage: "implementing",
        detail: "Google OAuth 자격증명 대기",
        actor: "codex",
        occurredAt: ago(31),
      }),
    ],
  },
  {
    ...runDefaults,
    id: "demo-4",
    runNumber: 9,
    source: "issue",
    sourceKey: "BRIAR-9",
    title: "D1 작업 이벤트 스키마 추가",
    status: "completed",
    workflowStage: "local_qa",
    progress: 100,
    detail: "마이그레이션과 API 검증이 완료되었습니다.",
    repository: "wordbricks/briar",
    branch: "feat/hunt-schema",
    commitSha: "2d0f9a1",
    startedAt: ago(940),
    updatedAt: ago(510),
    completedAt: ago(510),
    events: [
      event({
        id: "event-9",
        status: "completed",
        workflowStage: "local_qa",
        detail: "로컬 검증과 작업 완료",
        actor: "codex",
        occurredAt: ago(510),
      }),
    ],
  },
];

export const demoDashboard: DashboardPayload = {
  project: {
    id: "demo-project",
    name: "Briar",
    organizationId: "demo-organization",
    organizationName: "Briar",
    role: "owner",
    createdAt: ago(3_000),
  },
  settings: {
    velenOrg: "wordbricks",
    dataSource: "postgres://getgpt-dbdb",
    linear: {
      enabled: true,
      source: "linear://linear-wordbricks",
      teamKey: "GG",
    },
    githubRepository: "wordbricks/briar",
    workflow: structuredClone(demoWorkflow),
    automation: structuredClone(defaultAutoHuntAutomation),
  },
  runs,
  generatedAt: new Date().toISOString(),
};

export const demoRepositoryReadiness: RepositoryReadiness = {
  repositoryPath: "/Users/jay/git/briar",
  gitInstalled: true,
  gitVersion: "git version 2.50.1",
  repositoryHealthy: true,
  remote: "git@github.com:wordbricks/briar.git",
  remoteReachable: true,
  pushAccess: true,
  requiresGithub: true,
  githubRepository: "wordbricks/briar",
  ghInstalled: true,
  ghVersion: "gh version 2.94.0",
  ghAuthenticated: true,
  ghAccount: "jay",
  githubWriteAccess: true,
  gitReady: true,
  prReady: true,
  issues: [],
};
