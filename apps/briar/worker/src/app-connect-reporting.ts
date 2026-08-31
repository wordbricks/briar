import {
  OrganizationUsageRange,
  ProjectUsagePeriod,
  ReportingService,
} from "@briar/contracts/gen/briar/app/v1/reporting_pb";
import { Code, ConnectError, type ConnectRouter, type ServiceImpl } from "@connectrpc/connect";
import type { BriarAuth } from "./auth";

import {
  appOrganizationUsageRuns,
  appProjectUsageSummary,
  appRunCostEstimate,
  appStatusTrayRuns,
} from "./app-connect-reporting-mappers";
import { HttpError } from "./http-response";
import {
  getProjectUsageSummaryApplication,
  getRunCostEstimateApplication,
  listOrganizationUsageRunsApplication,
  listStatusTrayRunsApplication,
  ReportingApplicationError,
  reportingApplicationServices,
  type ReportingApplicationServices,
} from "./reporting-application";
import { decodeRequestSync } from "./request-schema";
import {
  decodeProjectUsageDateRange,
  decodeProjectUsagePeriod,
  decodeUsageRangeDays,
} from "./run-request-contract";
import { UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";

export type AppConnectReportingInput = {
  readonly request: Request;
  readonly auth: BriarAuth;
  readonly db: D1Database;
};

const decodeUuid = decodeRequestSync(UuidString);

const organizationUsageDays = (range: OrganizationUsageRange): 7 | 30 | 90 => {
  switch (range) {
    case OrganizationUsageRange.ORGANIZATION_USAGE_RANGE_7_DAYS:
      return decodeUsageRangeDays(7);
    case OrganizationUsageRange.ORGANIZATION_USAGE_RANGE_30_DAYS:
      return decodeUsageRangeDays(30);
    case OrganizationUsageRange.ORGANIZATION_USAGE_RANGE_90_DAYS:
      return decodeUsageRangeDays(90);
    case OrganizationUsageRange.ORGANIZATION_USAGE_RANGE_UNSPECIFIED:
      throw new ConnectError("Organization usage range is required", Code.InvalidArgument);
    default:
      throw new ConnectError(`Unknown organization usage range: ${range}`, Code.InvalidArgument);
  }
};

const projectUsagePeriod = (period: ProjectUsagePeriod) => {
  switch (period) {
    case ProjectUsagePeriod.DAY:
      return decodeProjectUsagePeriod("day");
    case ProjectUsagePeriod.WEEK:
      return decodeProjectUsagePeriod("week");
    case ProjectUsagePeriod.MONTH:
      return decodeProjectUsagePeriod("month");
    case ProjectUsagePeriod.UNSPECIFIED:
      throw new ConnectError("Project usage period is required", Code.InvalidArgument);
    default:
      throw new ConnectError(`Unknown project usage period: ${period}`, Code.InvalidArgument);
  }
};

const throwApplicationError = (error: unknown): never => {
  if (!(error instanceof ReportingApplicationError)) throw error;
  switch (error.reason) {
    case "organization_not_found":
    case "project_not_found":
    case "run_not_found":
      throw new HttpError(404, error.message);
    case "invalid_usage_range":
      throw new HttpError(400, error.message);
  }
};

const withApplicationErrors = async <A>(operation: Promise<A>) => {
  try {
    return await operation;
  } catch (error) {
    return throwApplicationError(error);
  }
};

export const createAppReportingService = (
  { request, auth, db }: AppConnectReportingInput,
  services: ReportingApplicationServices = reportingApplicationServices,
): ServiceImpl<typeof ReportingService> => ({
  listOrganizationUsageRuns: async (input) => {
    const session = await requireSession(auth, request);
    const result = await withApplicationErrors(
      listOrganizationUsageRunsApplication(
        {
          db,
          organizationId: decodeUuid(input.organizationId),
          userId: session.user.id,
          days: organizationUsageDays(input.range),
        },
        services,
      ),
    );
    return appOrganizationUsageRuns(result);
  },

  getProjectUsageSummary: async (input) => {
    const session = await requireSession(auth, request);
    const range =
      input.fromDate !== undefined || input.toDate !== undefined
        ? decodeProjectUsageDateRange({
            from: input.fromDate,
            to: input.toDate,
          })
        : undefined;
    const result = await withApplicationErrors(
      getProjectUsageSummaryApplication({
        db,
        projectId: decodeUuid(input.projectId),
        userId: session.user.id,
        period: projectUsagePeriod(input.period),
        range,
      }),
    );
    return appProjectUsageSummary(result);
  },

  listStatusTrayRuns: async (input) => {
    const session = await requireSession(auth, request);
    const result = await withApplicationErrors(
      listStatusTrayRunsApplication({
        db,
        organizationId: decodeUuid(input.organizationId),
        userId: session.user.id,
      }),
    );
    return appStatusTrayRuns(result);
  },

  getRunCostEstimate: async (input) => {
    const session = await requireSession(auth, request);
    const result = await withApplicationErrors(
      getRunCostEstimateApplication(
        {
          db,
          projectId: decodeUuid(input.projectId),
          runId: decodeUuid(input.runId),
          userId: session.user.id,
        },
        services,
      ),
    );
    return appRunCostEstimate(result);
  },
});

export const registerAppReportingService = (
  router: ConnectRouter,
  input: AppConnectReportingInput,
  services?: ReportingApplicationServices,
) => router.service(ReportingService, createAppReportingService(input, services));
