import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  AgentSkillApprovalPolicy,
  AgentSkillExecutionMode,
  AgentSkillKind,
  OrganizationAgentSchema,
  ProjectAgentSkillSchema,
} from "@briar/contracts/gen/briar/app/v1/agent_pb";
import { ComputerUsePolicy } from "@briar/contracts/gen/briar/types/v1/computer_use_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { Code, ConnectError } from "@connectrpc/connect";
import type { AgentSkillRow } from "./agent-skills";
import type { OrganizationAgentRow } from "./organization-agents";

const requiredTimestamp = (value: string, field: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ConnectError(`Invalid ${field} timestamp`, Code.Internal);
  }
  return timestampFromDate(date);
};

const provider = {
  codex: AgentProvider.CODEX,
  claude: AgentProvider.CLAUDE,
  cursor: AgentProvider.CURSOR,
  grok: AgentProvider.GROK,
  agy: AgentProvider.AGY,
  opencode: AgentProvider.OPENCODE,
  openrouter: AgentProvider.OPENROUTER,
} as const satisfies Record<OrganizationAgentRow["provider"], AgentProvider>;

const computerUsePolicy = {
  disabled: ComputerUsePolicy.DISABLED,
  unattended: ComputerUsePolicy.UNATTENDED,
} as const satisfies Record<
  OrganizationAgentRow["computer_use_policy"],
  ComputerUsePolicy
>;

const skillKind = {
  issue_processing: AgentSkillKind.ISSUE_PROCESSING,
  custom: AgentSkillKind.CUSTOM,
} as const satisfies Record<AgentSkillRow["kind"], AgentSkillKind>;

const executionMode = {
  conversation: AgentSkillExecutionMode.CONVERSATION,
  task: AgentSkillExecutionMode.TASK,
} as const satisfies Record<AgentSkillRow["execution_mode"], AgentSkillExecutionMode>;

const approvalPolicy = {
  invoke_is_consent: AgentSkillApprovalPolicy.INVOKE_IS_CONSENT,
  explicit: AgentSkillApprovalPolicy.EXPLICIT,
} as const satisfies Record<AgentSkillRow["approval_policy"], AgentSkillApprovalPolicy>;

const appOrganizationAgentSkill = (skill: AgentSkillRow) =>
  create(ProjectAgentSkillSchema, {
    id: skill.id,
    agentId: skill.agent_id,
    name: skill.name,
    description: skill.description,
    body: skill.body,
    provider: provider[skill.provider],
    model: skill.model ?? undefined,
    effort: skill.effort ?? undefined,
    kind: skillKind[skill.kind],
    executionMode: executionMode[skill.execution_mode],
    approvalPolicy: approvalPolicy[skill.approval_policy],
    position: skill.position,
    createdAt: requiredTimestamp(skill.created_at, "Agent Skill creation"),
    updatedAt: requiredTimestamp(skill.updated_at, "Agent Skill update"),
  });

/** Maps the organization-agent domain row directly to its generated API DTO. */
export const appOrganizationAgent = (row: OrganizationAgentRow) =>
  create(OrganizationAgentSchema, {
    agentId: row.id,
    name: row.name,
    avatar: row.avatar ?? undefined,
    provider: provider[row.provider],
    model: row.model ?? undefined,
    effort: row.effort ?? undefined,
    computerUsePolicy: computerUsePolicy[row.computer_use_policy],
    projectId: row.project_id ?? undefined,
    projectName: row.project_name ?? undefined,
    description: row.description || undefined,
    responsibility: row.responsibility,
    skills: (row.skills ?? []).map(appOrganizationAgentSkill),
    createdAt: requiredTimestamp(row.created_at, "Organization Agent creation"),
  });
