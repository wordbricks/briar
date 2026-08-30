import { create } from "@bufbuild/protobuf";
import { RunStatus } from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  ConnectLinearImportResponseSchema,
  ImportLinearIssuesResponseSchema,
  LinearImportViewerSchema,
  LinearTeamSchema,
} from "@briar/contracts/gen/briar/app/v1/linear_import_pb";
import { describe, expect, it } from "vitest";
import {
  linearImportConnectResultFromProto,
  linearImportResultFromProto,
  linearStatusMappingsToProto,
} from "./linear-import";

describe("Linear import Connect boundary", () => {
  it("encodes board statuses and workflow stages as typed oneofs", () => {
    const mappings = linearStatusMappingsToProto({
      backlog: { status: "backlog", workflowStage: null },
      active: { status: "running", workflowStage: "implementing" },
      done: { status: "completed", workflowStage: null },
    });

    expect(mappings.map((mapping) => ({
      stateId: mapping.stateId,
      placement: mapping.placement,
    }))).toEqual([
      {
        stateId: "backlog",
        placement: { case: "status", value: RunStatus.BACKLOG },
      },
      {
        stateId: "active",
        placement: { case: "workflowStageId", value: "implementing" },
      },
      {
        stateId: "done",
        placement: { case: "status", value: RunStatus.COMPLETED },
      },
    ]);
  });

  it("fails closed on missing identity and inconsistent domain results", () => {
    expect(() => linearImportConnectResultFromProto(create(
      ConnectLinearImportResponseSchema,
      {},
    ))).toThrow("linearImport.viewer is missing");

    expect(linearImportConnectResultFromProto(create(
      ConnectLinearImportResponseSchema,
      {
        viewer: create(LinearImportViewerSchema, {
          name: "Lina",
          organizationName: "Briar",
        }),
        teams: [create(LinearTeamSchema, {
          id: "team-1",
          name: "Core",
          key: "CORE",
        })],
      },
    ))).toEqual({
      viewer: { name: "Lina", email: null, organizationName: "Briar" },
      teams: [{ id: "team-1", name: "Core", key: "CORE" }],
    });

    expect(() => linearStatusMappingsToProto({
      active: { status: "running", workflowStage: null },
    })).toThrow("requires a workflow stage");
    expect(() => linearImportResultFromProto(create(
      ImportLinearIssuesResponseSchema,
      { imported: 1, total: 2 },
    ))).toThrow("counts are inconsistent");
  });
});
