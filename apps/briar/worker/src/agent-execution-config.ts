import type {
  AgentSkillEffort,
  AgentSkillProvider,
} from "./agent-skills";

type IssueReplyExecutionSource = {
  provider: AgentSkillProvider | null;
  model: string | null;
  effort: AgentSkillEffort | null;
};

export function issueClaimExecutionConfig(input: {
  preferred: IssueReplyExecutionSource;
  requested: IssueReplyExecutionSource;
  activeSkill: IssueReplyExecutionSource | null;
  agent: IssueReplyExecutionSource | null;
}) {
  // requested_* is the immutable choice approved for the current dispatch.
  // preferred_* remains a default only until a dispatch snapshot exists.
  const source = input.requested.provider
    ? input.requested
    : input.preferred.provider
      ? input.preferred
      : input.activeSkill?.provider
        ? input.activeSkill
        : input.agent?.provider
          ? input.agent
          : null;
  return {
    provider: source?.provider ?? null,
    model: source?.model ?? null,
    effort: source?.effort ?? null,
  };
}

export function issueReplyExecutionConfig(input: {
  provider: AgentSkillProvider;
  preferred: IssueReplyExecutionSource;
  requested: IssueReplyExecutionSource;
  activeSkill: IssueReplyExecutionSource | null;
  agent: IssueReplyExecutionSource | null;
  prioritizeAgent?: boolean;
}) {
  const source = (input.prioritizeAgent
    ? [input.activeSkill, input.agent, input.requested, input.preferred]
    : [input.requested, input.preferred, input.activeSkill, input.agent]
  ).find((candidate) => candidate?.provider === input.provider);
  return {
    model: source?.model ?? null,
    effort: source?.effort ?? null,
  };
}
