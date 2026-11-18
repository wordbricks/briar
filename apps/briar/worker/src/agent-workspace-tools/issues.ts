import { formatIssueKey } from "../../../src/lib/issue-key";
import { sha256 } from "../crypto-digest";
import { recordHuntEvent } from "../hunt-event-repository";
import { HuntTransitionError } from "../hunt-run-errors";
import { moveHuntRun } from "../hunt-run-move-repository";
import { digestRunId } from "../run-identity";
import { getTeamSettings } from "../team-settings-repository";
import type { AgentWorkspaceScope } from "./claim";
import { toolError } from "./errors";
import { onceForRequest, recordRequestStatement, toolRequest } from "./requests";

/*
  `tools issue …` against the claim's team (docs/plans/agent-workspace-tools.md).

  Agents act directly — create, note, move, update — with one exception:
  anything that would start Auto Hunt execution (status `queued`) becomes a
  pending execution proposal on the issue, which a person approves through the
  existing AcceptIssueExecutionProposal path. Notes are written as the claim's
  Agent with a direct insert, never through the person-message path, so a note
  never enqueues an issue reply job.
*/

export type AgentIssueSummary = {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly status: string;
  readonly paused: boolean;
  readonly priority: number | null;
  readonly updatedAt: string;
};

export type AgentIssueNote = {
  readonly id: string;
  readonly parentMessageId: string | null;
  readonly authorName: string;
  readonly authorIsAgent: boolean;
  readonly body: string;
  readonly createdAt: string;
};

export type AgentIssueDetail = {
  readonly issue: AgentIssueSummary;
  readonly description: string | null;
  readonly workflowStage: string | null;
  readonly resultSummary: string | null;
  readonly parentKey: string | null;
  readonly notes: readonly AgentIssueNote[];
  readonly notesTruncated: boolean;
  readonly pendingExecutionApprovalId: string | null;
};

type RunRow = {
  id: string;
  run_number: number;
  project_id: string;
  title: string;
  status: string;
  stage: string;
  workflow_stage: string | null;
  paused_at: string | null;
  priority: number | null;
  updated_at: string;
  claim_token_hash: string | null;
  dispatch_request_id: string | null;
  issue_description: string | null;
  result_summary: string | null;
  issue_key_prefix: string;
};

const runColumns = `run.id, run.run_number, run.project_id, run.title, run.status, run.stage, run.workflow_stage,
  run.paused_at, run.priority, run.updated_at, run.claim_token_hash, run.dispatch_request_id,
  run.issue_description, run.result_summary, project.issue_key_prefix`;

const runFrom = `from briar_hunt_runs run join briar_projects project on project.id = run.project_id`;

export const agentSettableStatuses = ["backlog", "blocked", "completed", "cancelled"] as const;
type AgentSettableStatus = (typeof agentSettableStatuses)[number];
const listableStatuses = new Set(["backlog", "queued", "running", "blocked", "failed", "completed", "cancelled"]);

const maxDescriptionLength = 100_000;
const maxNoteLength = 10_000;
const shownDescriptionLength = 20_000;
const shownNoteLength = 2_000;
const shownNoteCount = 20;
const shownResultLength = 4_000;
const defaultListLimit = 20;
const maxListLimit = 100;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const keyPattern = /^([A-Za-z0-9]{1,3})-(\d{1,12})$/u;

const clip = (text: string, length: number) => text.length > length ? `${text.slice(0, length)}…` : text;

export const issueSummary = (run: RunRow): AgentIssueSummary => ({
  id: run.id,
  key: formatIssueKey(run.issue_key_prefix, run.run_number),
  title: run.title,
  status: run.status,
  paused: run.paused_at !== null,
  priority: run.priority,
  updatedAt: run.updated_at,
});

/** Finds an issue of the claim's team by id or issue key (current prefix or a transfer alias). */
export async function resolveIssue(db: D1Database, scope: AgentWorkspaceScope, reference: string): Promise<RunRow> {
  const text = reference.trim();
  let run: RunRow | null = null;
  if (uuidPattern.test(text)) {
    run = await db.prepare(`select ${runColumns} ${runFrom} where run.id = ? and run.project_id = ?`)
      .bind(text.toLowerCase(), scope.teamId).first<RunRow>();
  } else {
    const key = keyPattern.exec(text);
    if (key) {
      const prefix = key[1]!.toUpperCase();
      run = await db.prepare(`select ${runColumns} ${runFrom}
        where run.project_id = ? and run.run_number = ? and project.issue_key_prefix = ?`)
        .bind(scope.teamId, Number(key[2]), prefix).first<RunRow>();
      run ??= await db.prepare(`select ${runColumns} ${runFrom}
        join briar_issue_key_aliases alias on alias.run_id = run.id and alias.team_id = run.project_id
        where run.project_id = ? and alias.issue_key = ?`)
        .bind(scope.teamId, `${prefix}-${key[2]}`).first<RunRow>();
    }
  }
  if (!run) throw toolError("not_found", `No issue "${clip(text, 80)}" in this team`);
  return run;
}

async function reloadIssue(db: D1Database, scope: AgentWorkspaceScope, runId: string) {
  return issueSummary(await resolveIssue(db, scope, runId));
}

type ListCursor = { readonly updatedAt: string; readonly id: string };

const encodeCursor = (cursor: ListCursor) => btoa(JSON.stringify([cursor.updatedAt, cursor.id]));

function decodeCursor(cursor: string): ListCursor {
  try {
    const value: unknown = JSON.parse(atob(cursor));
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string") {
      return { updatedAt: value[0], id: value[1] };
    }
  } catch {
    // Falls through to the error below.
  }
  throw toolError("invalid_request", "The cursor is not one this tool returned");
}

export async function listAgentIssues(db: D1Database, scope: AgentWorkspaceScope, input: {
  readonly statuses: readonly string[];
  readonly text: string | null;
  readonly cursor: string | null;
  readonly limit: number | null;
}) {
  if (input.statuses.some((status) => !listableStatuses.has(status))) {
    throw toolError("invalid_request", "Unknown status filter");
  }
  const limit = input.limit ?? defaultListLimit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxListLimit) {
    throw toolError("invalid_request", `--limit must be between 1 and ${maxListLimit}`);
  }
  const cursor = input.cursor === null ? null : decodeCursor(input.cursor);
  const where = ["run.project_id = ?"];
  const bindings: unknown[] = [scope.teamId];
  if (input.statuses.length > 0) {
    where.push(`run.status in (select value from json_each(?))`);
    bindings.push(JSON.stringify(input.statuses));
  }
  const text = input.text?.trim();
  if (text) {
    const key = keyPattern.exec(text);
    where.push(`(instr(lower(run.title), lower(?)) > 0 or instr(lower(coalesce(run.issue_description, '')), lower(?)) > 0
      or run.run_number = ?)`);
    bindings.push(text, text, key ? Number(key[2]) : -1);
  }
  if (cursor) {
    where.push(`(run.updated_at < ? or (run.updated_at = ? and run.id < ?))`);
    bindings.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
  }
  const rows = await db.prepare(`select ${runColumns} ${runFrom} where ${where.join(" and ")}
    order by run.updated_at desc, run.id desc limit ?`)
    .bind(...bindings, limit + 1).all<RunRow>();
  const page = rows.results.slice(0, limit);
  const last = page.at(-1);
  return {
    issues: page.map(issueSummary),
    nextCursor: rows.results.length > limit && last ? encodeCursor({ updatedAt: last.updated_at, id: last.id }) : null,
  };
}

async function pendingExecutionApproval(db: D1Database, runId: string) {
  const row = await db.prepare(`select id from briar_issue_execution_proposals
    where target_run_id = ? and status = 'pending' order by created_at desc limit 1`)
    .bind(runId).first<{ id: string }>();
  return row?.id ?? null;
}

export async function showAgentIssue(db: D1Database, scope: AgentWorkspaceScope, reference: string): Promise<AgentIssueDetail> {
  const run = await resolveIssue(db, scope, reference);
  const [notes, parent, approval] = await Promise.all([
    db.prepare(`select message.id, message.parent_message_id, message.body, message.created_at,
        message.author_agent_id, message.author_agent_name, message.author_agent_provider, author.name as user_name
      from briar_issue_messages message
      left join "user" author on author.id = message.author_user_id
      where message.run_id = ? and message.project_id = ?
      order by message.created_at desc, message.id desc limit ?`)
      .bind(run.id, run.project_id, shownNoteCount + 1)
      .all<{ id: string; parent_message_id: string | null; body: string; created_at: string;
        author_agent_id: string | null; author_agent_name: string | null; author_agent_provider: string | null;
        user_name: string | null }>(),
    db.prepare(`select parent.run_number, project.issue_key_prefix from briar_issue_parent_links link
      join briar_hunt_runs parent on parent.id = link.parent_run_id
      join briar_projects project on project.id = parent.project_id
      where link.child_run_id = ?`)
      .bind(run.id).first<{ run_number: number; issue_key_prefix: string }>(),
    pendingExecutionApproval(db, run.id),
  ]);
  const shown = notes.results.slice(0, shownNoteCount).reverse();
  return {
    issue: issueSummary(run),
    description: run.issue_description === null ? null : clip(run.issue_description, shownDescriptionLength),
    workflowStage: run.workflow_stage,
    resultSummary: run.result_summary === null ? null : clip(run.result_summary, shownResultLength),
    parentKey: parent ? formatIssueKey(parent.issue_key_prefix, parent.run_number) : null,
    notes: shown.map((note) => {
      const isAgent = note.author_agent_provider !== null;
      return {
        id: note.id,
        parentMessageId: note.parent_message_id,
        authorName: note.author_agent_name ??
          (isAgent ? `Agent (${note.author_agent_provider})` : (note.user_name ?? "Unknown person")),
        authorIsAgent: isAgent,
        body: clip(note.body, shownNoteLength),
        createdAt: note.created_at,
      };
    }),
    notesTruncated: notes.results.length > shownNoteCount,
    pendingExecutionApprovalId: approval,
  };
}

const normalizedBody = (body: string, maximum: number, what: string) => {
  const trimmed = body.trim();
  if (trimmed.length < 1) throw toolError("invalid_request", `The ${what} is empty`);
  if (trimmed.length > maximum) throw toolError("invalid_request", `The ${what} exceeds ${maximum} characters`);
  return trimmed;
};

const normalizedTitle = (title: string) => {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > 300) throw toolError("invalid_request", "The title must be 1-300 characters");
  return trimmed;
};

const normalizedPriority = (priority: number | null) => {
  if (priority !== null && (!Number.isSafeInteger(priority) || priority < 1 || priority > 4)) {
    throw toolError("invalid_request", "Priority must be 1 (urgent) to 4 (low)");
  }
  return priority;
};

/** The agent-authored note insert. A direct insert: it never enqueues a reply job. */
function noteStatement(db: D1Database, scope: AgentWorkspaceScope, input: {
  id: string; projectId: string; runId: string; body: string; createdAt: string;
}) {
  return db.prepare(`insert into briar_issue_messages (
      id, project_id, run_id, parent_message_id, author_user_id, author_agent_id, author_agent_name,
      author_agent_provider, body, created_at, updated_at)
    values (?, ?, ?, null, null, ?, ?, ?, ?, ?, ?)`)
    .bind(input.id, input.projectId, input.runId, scope.agent?.id ?? null, scope.agent?.name ?? null,
      scope.provider, input.body, input.createdAt, input.createdAt);
}

/**
 * Puts a pristine backlog issue up for a person's execution approval: an
 * agent note explaining the request, and a pending `briar_issue_execution_proposals`
 * row on that note, exactly the shape an issue-reply execution proposal has.
 * Approval then runs through AcceptIssueExecutionProposal unchanged.
 */
async function requestExecutionApproval(db: D1Database, scope: AgentWorkspaceScope, run: RunRow, input: {
  reason: string | null; occurredAt: string;
}) {
  const existing = await pendingExecutionApproval(db, run.id);
  if (existing) return existing;
  const pristine = run.status === "backlog" && run.stage === "queued" && run.workflow_stage === null &&
    run.claim_token_hash === null && run.dispatch_request_id === null && run.paused_at === null;
  if (!pristine) {
    throw toolError("not_allowed",
      "Only a backlog issue that has not run yet can be put up for execution approval; ask a person to retry or dispatch it");
  }
  const messageId = crypto.randomUUID();
  const proposalId = crypto.randomUUID();
  const body = normalizedBody(
    input.reason === null ? "Requesting approval to run this issue." : `Requesting approval to run this issue: ${input.reason}`,
    maxNoteLength, "approval request");
  const results = await db.batch([
    noteStatement(db, scope, { id: messageId, projectId: run.project_id, runId: run.id, body, createdAt: input.occurredAt }),
    db.prepare(`insert into briar_issue_execution_proposals (
        id, organization_id, project_id, source_kind, channel_id, conversation_run_id, trigger_message_id,
        reply_message_id, target_run_id, target_title, target_run_updated_at, proposed_by_agent_id,
        delegated_by_agent_id, delegated_by_agent_name, created_at, updated_at)
      select ?, project.organization_id, run.project_id, 'issue', null, run.id, ?, ?, run.id, run.title, run.updated_at,
        (select agent.id from briar_project_agents agent where agent.id = ? and agent.project_id = run.project_id),
        null, null, ?, ?
      from briar_hunt_runs run join briar_projects project on project.id = run.project_id
      where run.id = ? and run.project_id = ? and run.status = 'backlog' and run.stage = 'queued'
      returning id`)
      .bind(proposalId, messageId, messageId, scope.agent?.id ?? null, input.occurredAt, input.occurredAt,
        run.id, run.project_id),
  ]);
  if ((results[1]?.results.length ?? 0) !== 1) {
    throw toolError("conflict", "The issue changed while requesting approval; read it again");
  }
  return proposalId;
}

/** Workflow and transition refusals are the team's state, not a server fault. */
async function recordHuntEventForAgent(...args: Parameters<typeof recordHuntEvent>) {
  try {
    return await recordHuntEvent(...args);
  } catch (error) {
    if (error instanceof HuntTransitionError) throw toolError("not_allowed", error.message);
    throw error;
  }
}

function insertParentLink(db: D1Database, input: { teamId: string; childRunId: string; parentRunId: string; createdAt: string }) {
  return db.prepare(`insert into briar_issue_parent_links (project_id, parent_run_id, child_run_id, created_by_user_id, created_at)
    select ?, parent.id, ?, null, ? from briar_hunt_runs parent
    where parent.project_id = ? and parent.id = ? and parent.id <> ?`)
    .bind(input.teamId, input.childRunId, input.createdAt, input.teamId, input.parentRunId, input.childRunId);
}

export async function createAgentIssue(db: D1Database, scope: AgentWorkspaceScope, input: {
  readonly requestKey: string;
  readonly title: string;
  readonly description: string | null;
  readonly priority: number | null;
  readonly parent: string | null;
  readonly requestExecution: boolean;
}) {
  const title = normalizedTitle(input.title);
  const description = input.description === null ? null : normalizedBody(input.description, maxDescriptionLength, "description");
  const priority = normalizedPriority(input.priority);
  const parent = input.parent === null ? null : await resolveIssue(db, scope, input.parent);
  const request = await toolRequest(scope, "issue.create", input.requestKey,
    { title, description, priority, parent: parent?.id ?? null, requestExecution: input.requestExecution });
  const { result, replayed } = await onceForRequest<{ issueId: string }>(db, request, async () => {
    const sourceKey = `briar-agent-tool:${await sha256(`${scope.organizationId}\n${scope.workId}\n${input.requestKey}`)}`;
    const runId = await digestRunId(scope.teamId, "issue", sourceKey);
    const occurredAt = new Date().toISOString();
    const settings = await getTeamSettings(db, scope.teamId);
    const team = await db.prepare(`select name from briar_projects where id = ?`).bind(scope.teamId).first<{ name: string }>();
    if (!team) throw toolError("claim_inactive", "The claim's team no longer exists");
    const stored = { issueId: runId };
    const actorName = scope.agent?.name ?? `${scope.provider} agent`;
    await recordHuntEventForAgent(db, scope.teamId, {
      source: "issue",
      sourceKey,
      title,
      stage: "queued",
      status: "backlog",
      workflowStage: null,
      eventKey: `${sourceKey}:backlog:intake`,
      occurredAt,
      actor: scope.agent ? `agent:${scope.agent.id}` : "briar-agent",
      repository: settings?.github_repository ?? team.name,
      detail: `에이전트 ${actorName}이(가) 작업 중에 만든 이슈입니다.`,
      priority,
      difficulty: null,
      assigneeUserId: null,
      issueCheckpoints: [],
      fullAuto: false,
      requiresClaimToken: true,
      branch: null,
      commitSha: null,
      tracker: null,
      issueDescription: description,
      resultSummary: null,
      structuredResult: null,
      pullRequestUrls: [],
      targetSha: null,
      sourceCreatedAt: occurredAt,
      qaStatus: null,
      stagingQaDetail: null,
      productionQaDetail: null,
      context: {
        origin: "briar-agent-tool",
        issueId: runId,
        workKind: scope.workKind,
        workId: scope.workId,
        createdByAgent: scope.agent ? { id: scope.agent.id, name: scope.agent.name } : null,
        createdByProvider: scope.provider,
      },
      createdByUserId: null,
      preferredAgentProvider: null,
      preferredAgentModel: null,
      preferredAgentEffort: null,
    }, {
      newRunId: runId,
      additionalStatements: ({ recordedAt }) => [
        ...(parent ? [insertParentLink(db, { teamId: scope.teamId, childRunId: runId, parentRunId: parent.id, createdAt: recordedAt })] : []),
        recordRequestStatement(db, request, stored, recordedAt),
      ],
    });
    return stored;
  });
  // Approval is ensured on every call, so a retry after a failure between the
  // create and the proposal still ends with exactly one pending approval.
  const executionApprovalId = input.requestExecution
    ? await requestExecutionApproval(db, scope, await resolveIssue(db, scope, result.issueId),
      { reason: null, occurredAt: new Date().toISOString() })
    : null;
  return { issue: await reloadIssue(db, scope, result.issueId), executionApprovalId, replayed };
}

export async function noteAgentIssue(db: D1Database, scope: AgentWorkspaceScope, input: {
  readonly requestKey: string;
  readonly issue: string;
  readonly body: string;
}) {
  const run = await resolveIssue(db, scope, input.issue);
  const body = normalizedBody(input.body, maxNoteLength, "note");
  const request = await toolRequest(scope, "issue.note", input.requestKey, { issueId: run.id, body });
  const { result, replayed } = await onceForRequest<{ messageId: string; issueId: string }>(db, request, async () => {
    const stored = { messageId: crypto.randomUUID(), issueId: run.id };
    const createdAt = new Date().toISOString();
    await db.batch([
      noteStatement(db, scope, { id: stored.messageId, projectId: run.project_id, runId: run.id, body, createdAt }),
      recordRequestStatement(db, request, stored, createdAt),
    ]);
    return stored;
  });
  return { messageId: result.messageId, issue: await reloadIssue(db, scope, result.issueId), replayed };
}

/** A run whose status the execution lifecycle owns right now. */
const inExecution = (run: RunRow) =>
  run.status === "running" || run.claim_token_hash !== null || run.paused_at !== null ||
  (run.status === "queued" && run.dispatch_request_id !== null);

export async function setAgentIssueStatus(db: D1Database, scope: AgentWorkspaceScope, input: {
  readonly requestKey: string;
  readonly issue: string;
  readonly status: string;
  readonly reason: string | null;
}) {
  const run = await resolveIssue(db, scope, input.issue);
  const reason = input.reason === null || input.reason.trim() === "" ? null : normalizedBody(input.reason, 2_000, "reason");
  if (input.status !== "queued" && !(agentSettableStatuses as readonly string[]).includes(input.status)) {
    throw toolError("not_allowed",
      `An agent can set backlog, blocked, completed or cancelled, or queued to ask for execution approval; ${input.status} belongs to the execution lifecycle`);
  }
  if (scope.executingRunId === run.id) {
    throw toolError("own_run", "This is the issue your run is executing; report its outcome with `briar run` instead");
  }
  const request = await toolRequest(scope, "issue.status", input.requestKey, { issueId: run.id, status: input.status, reason });
  const { result, replayed } = await onceForRequest<{ issueId: string; outcome: string; executionApprovalId: string | null }>(
    db, request, async () => {
      if (inExecution(run)) {
        throw toolError("issue_in_execution", "The issue is being executed; its status belongs to that run until it stops");
      }
      const occurredAt = new Date().toISOString();
      if (input.status === "queued") {
        const executionApprovalId = await requestExecutionApproval(db, scope, run, { reason, occurredAt });
        const stored = { issueId: run.id, outcome: "approval_requested", executionApprovalId };
        await recordRequestStatement(db, request, stored, occurredAt).run();
        return stored;
      }
      let moved: Awaited<ReturnType<typeof moveHuntRun>>;
      try {
        moved = await moveHuntRun(db, scope.teamId, {
          runId: run.id,
          status: input.status as AgentSettableStatus,
          workflowStage: null,
          requestId: `agent-tool:${request.payloadHash.slice(0, 16)}:${input.requestKey}`,
          actor: scope.agent ? `agent:${scope.agent.id}` : "briar-agent",
          occurredAt,
        });
      } catch (error) {
        if (error instanceof HuntTransitionError) throw toolError("not_allowed", error.message);
        throw error;
      }
      if (moved.outcome === "not_found") throw toolError("not_found", "The issue no longer exists");
      const stored = {
        issueId: run.id,
        outcome: moved.outcome === "unchanged" ? "unchanged" : "moved",
        executionApprovalId: null,
      };
      const statements = [recordRequestStatement(db, request, stored, occurredAt)];
      if (reason !== null && stored.outcome === "moved") {
        statements.unshift(noteStatement(db, scope, {
          id: crypto.randomUUID(), projectId: run.project_id, runId: run.id,
          body: `Moved to ${input.status}: ${reason}`, createdAt: occurredAt,
        }));
      }
      await db.batch(statements);
      return stored;
    });
  return {
    issue: await reloadIssue(db, scope, result.issueId),
    outcome: result.outcome,
    executionApprovalId: result.executionApprovalId,
    replayed,
  };
}

export async function updateAgentIssue(db: D1Database, scope: AgentWorkspaceScope, input: {
  readonly requestKey: string;
  readonly issue: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly priority: number | null;
}) {
  if (input.title === null && input.description === null && input.priority === null) {
    throw toolError("invalid_request", "Give at least one of --title, --description or --priority");
  }
  const run = await resolveIssue(db, scope, input.issue);
  const title = input.title === null ? run.title : normalizedTitle(input.title);
  const description = input.description === null
    ? run.issue_description
    : normalizedBody(input.description, maxDescriptionLength, "description");
  const priority = input.priority === null ? run.priority : normalizedPriority(input.priority);
  const request = await toolRequest(scope, "issue.update", input.requestKey,
    { issueId: run.id, title: input.title, description: input.description, priority: input.priority });
  const { result, replayed } = await onceForRequest<{ issueId: string }>(db, request, async () => {
    const stored = { issueId: run.id };
    const updatedAt = new Date().toISOString();
    const [update] = await db.batch([
      db.prepare(`update briar_hunt_runs set title = ?, issue_description = ?, priority = ?, updated_at = ?
        where id = ? and project_id = ? and updated_at = ? returning id`)
        .bind(title, description, priority, updatedAt, run.id, run.project_id, run.updated_at),
      // Recorded only when the guarded update above changed the row.
      db.prepare(`insert into briar_agent_workspace_tool_requests (
          organization_id, work_id, request_key, operation, payload_hash, agent_id, result_json, created_at)
        select ?, ?, ?, ?, ?, ?, ?, ? where exists (
          select 1 from briar_hunt_runs where id = ? and project_id = ? and updated_at = ?)`)
        .bind(scope.organizationId, scope.workId, input.requestKey, request.operation, request.payloadHash,
          scope.agent?.id ?? null, JSON.stringify(stored), updatedAt, run.id, run.project_id, updatedAt),
    ]);
    if ((update?.results.length ?? 0) !== 1) {
      throw toolError("conflict", "The issue changed while updating it; read it again and retry");
    }
    return stored;
  });
  return { issue: await reloadIssue(db, scope, result.issueId), replayed };
}
