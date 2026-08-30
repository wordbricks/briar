import type { BriarAuth } from "./auth";
import { HttpError, json } from "./http-response";
import { hasOrganizationCapability } from "./organization-access";
import { getOrganizationRole } from "./organization-repository";
import { decodeUsageRangeDays } from "./run-request-contract";
import { requireSession } from "./session-auth";
import {
  estimateOrganizationUsageCosts,
  loadAgentUsagePricing,
} from "./usage-pricing";
import {
  listOrganizationUsageCostRecords,
  listOrganizationUsageExecutionAttempts,
  listOrganizationUsageRecords,
  listOrganizationUsageRuns,
  type OrganizationCostRecordRow,
  type OrganizationUsageRecordRow,
  type RunExecutionAttemptRow,
} from "./usage-repository";
import {
  organizationUsageQuerySince,
  organizationUsageRunJson,
} from "./usage-json";

export type OrganizationUsageRouteInput = {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
};

export async function handleOrganizationUsageRoute(
  { request, url, auth, db }: OrganizationUsageRouteInput,
): Promise<Response | undefined> {
  const match = url.pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/usage\/runs$/u,
  );
  if (!match || request.method !== "GET") return undefined;

  const session = await requireSession(auth, request);
  const organizationId = match[1];
  const role = await getOrganizationRole(db, organizationId, session.user.id);
  if (!hasOrganizationCapability(role, "organization:read")) {
    throw new HttpError(404, "Organization not found");
  }
  const days = decodeUsageRangeDays(url.searchParams.get("days") ?? "90");
  const generatedAt = Date.now();
  const since = organizationUsageQuerySince(days, generatedAt);
  const [runs, attempts, usageRecords, costRecords, loadedPricing] =
    await Promise.all([
      listOrganizationUsageRuns(db, organizationId, since),
      listOrganizationUsageExecutionAttempts(db, organizationId, since),
      listOrganizationUsageRecords(db, organizationId, since),
      listOrganizationUsageCostRecords(db, organizationId, since),
      loadAgentUsagePricing(),
    ]);
  const attemptsByRun = new Map<string, RunExecutionAttemptRow[]>();
  for (const attempt of attempts) {
    attemptsByRun.set(attempt.run_id, [
      ...(attemptsByRun.get(attempt.run_id) ?? []),
      attempt,
    ]);
  }
  const usageRecordsByRun = new Map<string, OrganizationUsageRecordRow[]>();
  for (const record of usageRecords) {
    usageRecordsByRun.set(record.run_id, [
      ...(usageRecordsByRun.get(record.run_id) ?? []),
      record,
    ]);
  }
  const costRecordsByRun = new Map<string, OrganizationCostRecordRow[]>();
  for (const record of costRecords) {
    costRecordsByRun.set(record.run_id, [
      ...(costRecordsByRun.get(record.run_id) ?? []),
      record,
    ]);
  }
  return json({
    runs: runs.map((run) =>
      organizationUsageRunJson(run, {
        attempts: attemptsByRun.get(run.id),
        records: usageRecordsByRun.get(run.id),
        costRecords: costRecordsByRun.get(run.id),
        estimatedCostRecords: estimateOrganizationUsageCosts({
          usageRecords: usageRecordsByRun.get(run.id) ?? [],
          costRecords: costRecordsByRun.get(run.id) ?? [],
          table: loadedPricing.table,
        }),
      })
    ),
    generatedAt: new Date(generatedAt).toISOString(),
    pricing: loadedPricing.pricing,
  });
}
