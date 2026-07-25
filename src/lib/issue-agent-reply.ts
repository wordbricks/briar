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
  conversationId: string | null;
  provider: AgentProvider | null;
};

export function mentionsBriar(body: string) {
  return /(^|[^\p{L}\p{N}_])@briar(?=$|[^\p{L}\p{N}_])/iu.test(body);
}

export function briarMentionAtCaret(body: string, caret: number) {
  if (!Number.isInteger(caret) || caret < 0 || caret > body.length) return null;
  const match = body
    .slice(0, caret)
    .match(/(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_-]*)$/u);
  if (!match || !"briar".startsWith(match[2].toLowerCase())) return null;
  return {
    start: caret - match[2].length - 1,
    end: caret,
  };
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
): IssueAgentConversation {
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
  return { conversationId: null, provider: null };
}
