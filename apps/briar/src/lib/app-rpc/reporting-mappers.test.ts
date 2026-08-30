import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { RunStatus } from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  AgentUsageCostRecordSchema,
  AgentUsageEstimatedCostRecordSchema,
  AgentUsagePricingSchema,
  AgentUsagePricingStatus,
  AgentUsageRunSchema,
  GetProjectUsageSummaryResponseSchema,
  ListOrganizationUsageRunsResponseSchema,
  ListStatusTrayRunsResponseSchema,
  ProjectUsagePeriod,
  StatusTrayRunSchema,
} from "@briar/contracts/gen/briar/app/v1/reporting_pb";
import { AgentExecutionModelSource } from "@briar/contracts/gen/briar/types/v1/agent_execution_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { describe, expect, it } from "vitest";
import {
  organizationUsageReportFromProto,
  projectUsageSummaryFromProto,
  statusTrayRunsFromProto,
} from "./reporting-mappers";

const observedAt = timestampFromDate(new Date("2026-08-31T00:00:00.000Z"));

describe("Reporting protobuf mapping", () => {
  it("keeps provider-reported and model-priced cost ledgers distinct", () => {
    const report = organizationUsageReportFromProto(create(
      ListOrganizationUsageRunsResponseSchema,
      {
        generatedAt: observedAt,
        pricing: create(AgentUsagePricingSchema, {
          status: AgentUsagePricingStatus.LIVE,
          source: "pricing-source",
          fetchedAt: observedAt,
          knownModels: 12,
        }),
        runs: [create(AgentUsageRunSchema, {
          id: "run-1",
          projectId: "project-1",
          status: RunStatus.RUNNING,
          startedAt: observedAt,
          updatedAt: observedAt,
          costRecords: [create(AgentUsageCostRecordSchema, {
            executionId: "execution-1",
            projectId: "project-1",
            runAttempt: 1,
            claimAttempt: 1,
            claimedAt: observedAt,
            costKey: "provider-cost-1",
            agentProvider: AgentProvider.CODEX,
            modelSource: AgentExecutionModelSource.PROVIDER_REPORTED,
            source: "provider",
            amountUsdTicks: 25n,
            observedAt,
            recordedAt: observedAt,
          })],
          estimatedCostRecords: [create(AgentUsageEstimatedCostRecordSchema, {
            executionId: "execution-1",
            projectId: "project-1",
            runAttempt: 1,
            claimAttempt: 1,
            claimedAt: observedAt,
            usageKey: "usage-1",
            agentProvider: AgentProvider.CODEX,
            modelSource: AgentExecutionModelSource.PROVIDER_REPORTED,
            observedAt,
            usageSource: "provider",
            pricingKey: "openai/model",
            amountUsdTicks: 20n,
          })],
        })],
      },
    ));

    expect(report.runs[0]?.costRecords).toMatchObject([
      { costSource: "providerReported", amountUsdTicks: 25 },
    ]);
    expect(report.runs[0]?.estimatedCostRecords).toMatchObject([
      { costSource: "modelPriced", amountUsdTicks: 20 },
    ]);
  });

  it("rejects wire states and 64-bit values the UI domain cannot represent", () => {
    const completedRun = create(StatusTrayRunSchema, {
      projectId: "project-1",
      projectName: "Project",
      id: "run-1",
      title: "Run",
      status: RunStatus.COMPLETED,
      startedAt: observedAt,
      updatedAt: observedAt,
      lastEventAt: observedAt,
    });
    expect(() => statusTrayRunsFromProto(create(
      ListStatusTrayRunsResponseSchema,
      { generatedAt: observedAt, runs: [completedRun] },
    ))).toThrow("Status tray run must be running");

    const summary = create(GetProjectUsageSummaryResponseSchema, {
      period: ProjectUsagePeriod.DAY,
      rangeStart: observedAt,
      rangeEnd: observedAt,
      generatedAt: observedAt,
      totalTokens: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
    });
    expect(() => projectUsageSummaryFromProto(summary)).toThrow(
      "projectUsageSummary.totalTokens is outside JavaScript's safe integer range",
    );

    summary.totalTokens = 0n;
    summary.period = ProjectUsagePeriod.UNSPECIFIED;
    expect(() => projectUsageSummaryFromProto(summary)).toThrow(
      "Project usage period is missing",
    );
  });
});
