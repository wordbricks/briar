import { createClient } from "@connectrpc/connect";
import {
  ReportingService,
} from "@briar/contracts/gen/briar/app/v1/reporting_pb";
import type { UsageRangeDays } from "../agent-usage-overview";
import type {
  TeamUsageDateRange,
  TeamUsagePeriod,
} from "../team-usage-summary";
import { appCallOptions, appTransport } from "./core";
import {
  organizationUsageRangeToProto,
  organizationUsageReportFromProto,
  projectUsagePeriodToProto,
  projectUsageSummaryFromProto,
  runCostEstimateFromProto,
  statusTrayRunsFromProto,
} from "./reporting-mappers";

const reportingClient = appTransport
  ? createClient(ReportingService, appTransport)
  : undefined;

const requireReportingClient = () => {
  if (!reportingClient) {
    throw new Error("Briar API URL이 설정되지 않았습니다.");
  }
  return reportingClient;
};

export async function loadAgentUsageReport(
  token: string,
  organizationId: string,
  days: UsageRangeDays = 90,
  signal?: AbortSignal,
) {
  return organizationUsageReportFromProto(
    await requireReportingClient().listOrganizationUsageRuns(
      { organizationId, range: organizationUsageRangeToProto(days) },
      appCallOptions(token, signal),
    ),
  );
}

export async function loadProjectUsageSummary(
  token: string,
  projectId: string,
  period: TeamUsagePeriod = "day",
  range?: TeamUsageDateRange,
  signal?: AbortSignal,
) {
  return projectUsageSummaryFromProto(
    await requireReportingClient().getProjectUsageSummary(
      {
        projectId,
        period: projectUsagePeriodToProto(period),
        fromDate: range?.from,
        toDate: range?.to,
      },
      appCallOptions(token, signal),
    ),
  );
}

export async function loadStatusTrayRuns(
  token: string,
  organizationId: string,
  signal?: AbortSignal,
) {
  return statusTrayRunsFromProto(
    await requireReportingClient().listStatusTrayRuns(
      { organizationId },
      appCallOptions(token, signal),
    ),
  );
}

export async function loadRunCostEstimate(
  token: string,
  projectId: string,
  runId: string,
  signal?: AbortSignal,
) {
  return runCostEstimateFromProto(
    await requireReportingClient().getRunCostEstimate(
      { projectId, runId },
      appCallOptions(token, signal),
    ),
  );
}
