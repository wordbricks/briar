import { repositoryWorkflowBootstrap } from "../lib/auto-hunt-contract";
import { demoDashboard } from "../lib/demo-data";
import type {
  DashboardPayload,
  IssueMessage,
  Organization,
  Project,
  RunEvidence,
  SessionUser,
} from "../types";

/**
 * Seed data the app renders in demo mode. The two timestamps are anchored to
 * module load so the sample conversation always reads as recent; everything
 * derived from them is evaluated at import time as well.
 */
export const demoUser: SessionUser = {
  id: "demo-user",
  name: "Jay",
  email: "demo@briar.local",
};
export const demoOrganization: Organization = {
  id: demoDashboard.team.organizationId,
  name: demoDashboard.team.organizationName,
  handle: "briar",
  logo: null,
  role: demoDashboard.team.role,
  createdAt: demoDashboard.team.createdAt,
};
export const demoMessageTime = new Date(Date.now() - 18 * 60_000).toISOString();
export const demoReplyTime = new Date(Date.now() - 8 * 60_000).toISOString();
export const initialDemoIssueMessages = {
  "demo-1": [
    {
      id: "demo-message-1",
      runId: "demo-1",
      parentMessageId: null,
      body: "이벤트 스트림에서 빠지는 상태가 없는지 같이 확인해 주세요.",
      attachments: [],
      author: {
        id: demoUser.id,
        name: demoUser.name,
        image: null,
        provider: null,
      },
      replyCount: 1,
      proposedAction: null,
      executionProposal: null,
      skillExecutionProposal: null,
      createdAt: demoMessageTime,
      updatedAt: demoMessageTime,
    },
    {
      id: "demo-message-reply-1",
      runId: "demo-1",
      parentMessageId: "demo-message-1",
      body: "완료·실패·중단 상태까지 회귀 테스트에 포함했습니다.",
      attachments: [],
      author: {
        id: null,
        name: "Briar · Codex",
        image: null,
        provider: "codex",
      },
      replyCount: 0,
      proposedAction: null,
      executionProposal: null,
      skillExecutionProposal: null,
      createdAt: demoReplyTime,
      updatedAt: demoReplyTime,
    },
  ],
} satisfies Record<string, IssueMessage[]>;

export const initialDemoRunEvidence = {
  "demo-1": [
    {
      key: "BRIAR-12:analyzing:repository_findings",
      attempt: 1,
      revision: 1,
      stage: "analyzing",
      type: "repository_findings",
      status: "passed",
      detail: "이벤트 스트림과 이슈 상세 화면의 연결 지점을 확인했습니다.",
      command: "rg -n \"AgentEvent|HuntDashboard\" src src-tauri",
      url: null,
      metadata: { filesReviewed: 6 },
      actor: "briar-workflow",
      observedAt: demoMessageTime,
      recordedAt: demoMessageTime,
      requiredRevision: 1,
      canonical: true,
    },
    {
      key: "BRIAR-12:implementing:diff",
      attempt: 1,
      revision: 1,
      stage: "implementing",
      type: "diff",
      status: "pending",
      detail: "이벤트 스트림 어댑터와 회귀 테스트를 작성하고 있습니다.",
      command: null,
      url: null,
      metadata: null,
      actor: "briar-workflow",
      observedAt: demoReplyTime,
      recordedAt: demoReplyTime,
      requiredRevision: 1,
      canonical: true,
    },
  ],
} satisfies Record<string, RunEvidence[]>;

/**
 * The dashboard a freshly connected team starts from, before its first
 * server payload arrives.
 */
export const emptyDashboard = (project: Project): DashboardPayload => ({
  team: project,
  settings: {
    velenOrg: null,
    dataSource: null,
    linear: { enabled: false, source: null, teamKey: null },
    githubRepository: null,
    githubRepositoryId: null,
    workflow: repositoryWorkflowBootstrap,
  },
  runs: [],
  generatedAt: new Date().toISOString(),
});
