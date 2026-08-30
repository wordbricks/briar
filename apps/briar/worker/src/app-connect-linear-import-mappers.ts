import { create } from "@bufbuild/protobuf";
import {
  ConnectLinearImportResponseSchema,
  ImportLinearIssuesResponseSchema,
  LinearImportViewerSchema,
  LinearTeamSchema,
  LinearWorkflowStateSchema,
  ListLinearImportStatesResponseSchema,
} from "@briar/contracts/gen/briar/app/v1/linear_import_pb";
import { Code, ConnectError } from "@connectrpc/connect";
import type {
  LinearTeam,
  LinearViewer,
  LinearWorkflowState,
} from "./linear";

const internal = (message: string): never => {
  throw new ConnectError(message, Code.Internal);
};

const uint32 = (value: number, field: string) => {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    return internal(`Invalid uint32 ${field} in LinearImportService response`);
  }
  return value;
};

const appLinearTeam = (team: LinearTeam) => create(LinearTeamSchema, {
  id: team.id,
  name: team.name,
  key: team.key,
});

export const appLinearImportConnection = (result: {
  readonly viewer: LinearViewer;
  readonly teams: LinearTeam[];
}) => create(ConnectLinearImportResponseSchema, {
  viewer: create(LinearImportViewerSchema, {
    name: result.viewer.name,
    email: result.viewer.email ?? undefined,
    organizationName: result.viewer.organizationName,
  }),
  teams: result.teams.map(appLinearTeam),
});

export const appLinearImportStates = (states: LinearWorkflowState[]) =>
  create(ListLinearImportStatesResponseSchema, {
    states: states.map((state) => {
      if (!Number.isFinite(state.position)) {
        return internal("Invalid Linear workflow state position");
      }
      return create(LinearWorkflowStateSchema, {
        id: state.id,
        name: state.name,
        type: state.type,
        color: state.color,
        position: state.position,
        teamId: state.teamId,
        teamKey: state.teamKey,
        teamName: state.teamName,
      });
    }),
  });

export const appLinearImportResult = (result: {
  readonly failed: number;
  readonly imported: number;
  readonly skipped: number;
  readonly total: number;
  readonly truncated: boolean;
}) => {
  const imported = uint32(result.imported, "imported");
  const skipped = uint32(result.skipped, "skipped");
  const failed = uint32(result.failed, "failed");
  const total = uint32(result.total, "total");
  if (imported + skipped + failed !== total) {
    return internal("Inconsistent Linear import result counts");
  }
  return create(ImportLinearIssuesResponseSchema, {
    imported,
    skipped,
    failed,
    total,
    truncated: result.truncated,
  });
};
