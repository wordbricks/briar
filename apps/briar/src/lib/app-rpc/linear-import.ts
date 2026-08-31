import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import {
  LinearImportService,
  LinearStatusMappingSchema,
  type ConnectLinearImportResponse,
  type ImportLinearIssuesResponse,
  type LinearStatusMapping as LinearStatusMappingMessage,
  type ListLinearImportStatesResponse,
} from "@briar/contracts/gen/briar/app/v1/linear_import_pb";
import type {
  LinearImportConnectResult,
  LinearImportResult,
  LinearImportStatesResult,
  LinearStatusMapping,
} from "../linear-import";
import { appCallOptions, appTransport } from "./core";
import {
  requiredMessage,
  runStatusToProto,
} from "./mappers";

const linearImportClient = appTransport
  ? createClient(LinearImportService, appTransport)
  : undefined;

const requireLinearImportClient = () => {
  if (!linearImportClient) {
    throw new Error("Briar API URL이 설정되지 않았습니다.");
  }
  return linearImportClient;
};

export const linearImportConnectResultFromProto = (
  response: ConnectLinearImportResponse,
): LinearImportConnectResult => {
  const viewer = requiredMessage(response.viewer, "linearImport.viewer");
  return {
    viewer: {
      name: viewer.name,
      email: viewer.email ?? null,
      organizationName: viewer.organizationName,
    },
    teams: response.teams.map((team) => ({
      id: team.id,
      name: team.name,
      key: team.key,
    })),
  };
};

export async function connectLinearImport(
  token: string,
  projectId: string,
  apiKey: string,
) {
  return linearImportConnectResultFromProto(
    await requireLinearImportClient().connectLinearImport(
      { projectId, apiKey },
      appCallOptions(token),
    ),
  );
}

export const linearImportStatesFromProto = (
  response: ListLinearImportStatesResponse,
): LinearImportStatesResult => ({
  states: response.states.map((state) => {
    if (!Number.isFinite(state.position)) {
      throw new Error("linearImport.state.position must be finite");
    }
    return {
      id: state.id,
      name: state.name,
      type: state.type,
      color: state.color,
      position: state.position,
      teamId: state.teamId,
      teamKey: state.teamKey,
      teamName: state.teamName,
    };
  }),
});

export async function loadLinearImportStates(
  token: string,
  projectId: string,
  input: { apiKey: string; teamIds: string[] },
) {
  return linearImportStatesFromProto(
    await requireLinearImportClient().listLinearImportStates(
      { projectId, apiKey: input.apiKey, teamIds: input.teamIds },
      appCallOptions(token),
    ),
  );
}

export const linearStatusMappingsToProto = (
  mappings: LinearStatusMapping,
): LinearStatusMappingMessage[] => Object.entries(mappings).map(
  ([stateId, placement]) => {
    if (placement.status === "running") {
      if (!placement.workflowStage) {
        throw new Error(`Linear state ${stateId} requires a workflow stage`);
      }
      return create(LinearStatusMappingSchema, {
        stateId,
        placement: {
          case: "workflowStageId",
          value: placement.workflowStage,
        },
      });
    }
    if (placement.workflowStage !== null) {
      throw new Error(
        `Linear state ${stateId} cannot combine a board status with a workflow stage`,
      );
    }
    return create(LinearStatusMappingSchema, {
      stateId,
      placement: {
        case: "status",
        value: runStatusToProto(placement.status),
      },
    });
  },
);

export const linearImportResultFromProto = (
  response: ImportLinearIssuesResponse,
): LinearImportResult => {
  if (response.imported + response.skipped + response.failed !== response.total) {
    throw new Error("Linear import result counts are inconsistent");
  }
  return {
    imported: response.imported,
    skipped: response.skipped,
    failed: response.failed,
    total: response.total,
    truncated: response.truncated,
  };
};

export async function importLinearIssues(
  token: string,
  projectId: string,
  input: {
    apiKey: string;
    teamIds: string[];
    statusMapping: LinearStatusMapping;
  },
) {
  return linearImportResultFromProto(
    await requireLinearImportClient().importLinearIssues(
      {
        projectId,
        apiKey: input.apiKey,
        teamIds: input.teamIds,
        statusMappings: linearStatusMappingsToProto(input.statusMapping),
      },
      appCallOptions(token),
    ),
  );
}
