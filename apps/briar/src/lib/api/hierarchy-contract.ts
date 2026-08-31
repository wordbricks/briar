import * as Schema from "effect/Schema";
import { mutableArray, UuidString } from "./schema-helpers";

export const PlanningProjectResponse = Schema.Struct({
  id: UuidString,
  workspaceId: UuidString,
  workspaceName: Schema.String,
  teamId: UuidString,
  teamName: Schema.String,
  name: Schema.String,
  description: Schema.String,
  status: Schema.Literals(["planned", "active", "completed", "cancelled"]),
  leadUserId: Schema.NullOr(Schema.String),
  leadName: Schema.NullOr(Schema.String),
  startDate: Schema.NullOr(Schema.String),
  targetDate: Schema.NullOr(Schema.String),
  icon: Schema.NullOr(Schema.String),
  color: Schema.NullOr(Schema.String),
  sortOrder: Schema.Int,
  isDefault: Schema.Boolean,
  role: Schema.Literals([
    "owner",
    "co-owner",
    "developer",
    "editor",
    "viewer",
  ]),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export const decodePlanningProjectResponse = Schema.decodeUnknownSync(
  PlanningProjectResponse,
);
export const decodePlanningProjectsResponse = Schema.decodeUnknownSync(
  mutableArray(PlanningProjectResponse),
);
