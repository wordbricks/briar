import type { AgentProvider } from "./project-llm";

type IssueSession = {
  projectId: string;
  status: string;
  conversationId: string | null;
  issues: Array<{
    runId: string;
    outcome: string;
  }>;
};

export type IssueAgentConversation = {
  conversationId: string;
  provider: AgentProvider;
};

export function mentionsBriar(body: string) {
  return /(^|[^\p{L}\p{N}_])@briar(?=$|[^\p{L}\p{N}_])/iu.test(body);
}

export function providerForConversation(
  projectId: string,
  conversationId: string,
): AgentProvider | null {
  if (conversationId.startsWith(`briar:claude:${projectId}:`)) return "claude";
  if (conversationId.startsWith(`briar:${projectId}:`)) return "codex";
  return null;
}

export function issueAgentConversation(
  sessions: readonly IssueSession[],
  projectId: string,
  runId: string,
): IssueAgentConversation | null {
  for (const session of sessions) {
    if (
      session.projectId !== projectId ||
      session.status !== "completed" ||
      !session.conversationId ||
      !session.issues.some(
        (issue) =>
          issue.runId === runId &&
          issue.outcome !== "pending" &&
          issue.outcome !== "skipped",
      )
    ) {
      continue;
    }
    const provider = providerForConversation(
      projectId,
      session.conversationId,
    );
    if (provider) {
      return { conversationId: session.conversationId, provider };
    }
  }
  return null;
}
