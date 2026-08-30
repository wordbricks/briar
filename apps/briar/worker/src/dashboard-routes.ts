import {
  isProjectUsageDateRange,
  projectUsageSummaryWindow,
  type ProjectUsageDateRange,
} from "../../src/lib/project-usage-summary";
import { parseExecutionMetrics } from "./agent-result-json";
import type { BriarAuth } from "./auth";
import { statusTrayRunJson } from "./dashboard-json";
import {
  getHuntRunForProject,
  getProject,
  listOrganizationStatusTrayRuns,
  listProjectUsageRuns,
  listProjectUsageTotals,
  listRunUsageRecords,
} from "./db";
import { HttpError, json } from "./http-response";
import { hasOrganizationCapability } from "./organization-access";
import { getOrganizationRole } from "./organization-repository";
import { decodeProjectUsagePeriod } from "./run-request-contract";
import { requireSession } from "./session-auth";
import { projectUsageSummaryJson } from "./usage-json";
import {
  estimateRunExecutionCost,
  loadAgentUsagePricing,
} from "./usage-pricing";

export async function handleDashboardRoute(input: {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
}): Promise<Response | undefined> {
  const { request, url, auth, db } = input;

  const statusTrayRunsMatch = url.pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/status-tray\/runs$/u,
  );
  if (statusTrayRunsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = statusTrayRunsMatch[1];
    const role = await getOrganizationRole(
      db,
      organizationId,
      session.user.id,
    );
    if (!hasOrganizationCapability(role, "organization:read")) {
      throw new HttpError(404, "Organization not found");
    }
    const runs = await listOrganizationStatusTrayRuns(
      db,
      organizationId,
      session.user.id,
    );
    return json({
      runs: runs.map(statusTrayRunJson),
      generatedAt: new Date().toISOString(),
    });
  }

  const projectUsageSummaryMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/usage\/summary$/u,
  );
  if (projectUsageSummaryMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectUsageSummaryMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const period = decodeProjectUsagePeriod(
      new URL(request.url).searchParams.get("period") ?? "day",
    );
    const search = new URL(request.url).searchParams;
    const from = search.get("from");
    const to = search.get("to");
    let range: ProjectUsageDateRange | undefined;
    if (from !== null || to !== null) {
      range = { from: from ?? "", to: to ?? "" };
      if (!isProjectUsageDateRange(range, period)) {
        throw new HttpError(
          400,
          "Usage range is invalid or contains more than 400 timeline buckets",
        );
      }
    }
    const generatedAt = Date.now();
    const window = projectUsageSummaryWindow(period, generatedAt, range);
    const since = new Date(window.startAt).toISOString();
    const until = new Date(window.endAt).toISOString();
    const [runs, totals] = await Promise.all([
      listProjectUsageRuns(db, project.id, since, until),
      listProjectUsageTotals(db, project.id, since, until),
    ]);
    return json(projectUsageSummaryJson(
      runs,
      totals,
      period,
      generatedAt,
      range,
    ));
  }

  const runCostEstimateMatch = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/runs\/([0-9a-f-]+)\/cost-estimate$/u,
  );
  if (runCostEstimateMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const projectId = runCostEstimateMatch[1];
    const runId = runCostEstimateMatch[2];
    const project = await getProject(db, projectId, session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const run = await getHuntRunForProject(db, projectId, runId);
    if (!run) throw new HttpError(404, "Run not found");
    const [usageRecords, loadedPricing] = await Promise.all([
      listRunUsageRecords(
        db,
        projectId,
        runId,
        run.current_attempt,
        run.last_execution_id,
      ),
      loadAgentUsagePricing(),
    ]);
    const metrics = parseExecutionMetrics(run.execution_metrics_json);
    const provider =
      run.preferred_agent_provider ?? run.requested_agent_provider ?? null;
    const model = run.preferred_agent_provider
      ? run.preferred_agent_model
      : run.requested_agent_provider
        ? run.requested_agent_model
        : null;
    return json(
      estimateRunExecutionCost({
        usageRecords,
        loadedPricing,
        fallback:
          metrics && provider
            ? {
                agentProvider: provider,
                model,
                inputTokens: metrics.inputTokens,
                cacheReadTokens: metrics.cacheReadTokens,
                cacheWriteTokens: metrics.cacheWriteTokens,
                outputTokens: metrics.outputTokens,
              }
            : null,
      }),
    );
  }

  return undefined;
}
