import type { IssueMessage } from "../types";
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

export function shouldBriarReply(
  messages: readonly IssueMessage[],
  input: { body: string; parentMessageId: string | null },
) {
  if (mentionsBriar(input.body)) return true;
  if (!input.parentMessageId) return false;
  return messages.some(
    (message) =>
      (message.id === input.parentMessageId ||
        message.parentMessageId === input.parentMessageId) &&
      (message.author.provider !== null || mentionsBriar(message.body)),
  );
}

export function agentReplyParentMessageId(
  message: Pick<IssueMessage, "id" | "parentMessageId">,
) {
  return message.parentMessageId ?? message.id;
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
  if (conversationId.startsWith(`briar:grok:${projectId}:`)) return "grok";
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
