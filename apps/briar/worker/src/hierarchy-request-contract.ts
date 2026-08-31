import * as Schema from "effect/Schema";
import { strictSchema, trimmedText, UuidString } from "./schema-codecs";
import { decodeRequestSync } from "./request-schema";

export const PlanningProjectStatus = Schema.Literals([
  "planned",
  "active",
  "completed",
  "cancelled",
]);
export type PlanningProjectStatus = typeof PlanningProjectStatus.Type;

const ProjectDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u),
);
const ProjectColor = Schema.String.check(
  Schema.isPattern(/^#[0-9a-f]{6}$/iu),
);

export const PlanningProjectCreateInput = strictSchema(Schema.Struct({
  name: trimmedText(1, 100),
  description: Schema.optional(
    Schema.Trim.check(Schema.isMaxLength(10_000)),
  ),
  status: Schema.optional(PlanningProjectStatus),
  leadUserId: Schema.optional(Schema.NullOr(UuidString)),
  startDate: Schema.optional(Schema.NullOr(ProjectDate)),
  targetDate: Schema.optional(Schema.NullOr(ProjectDate)),
  icon: Schema.optional(
    Schema.NullOr(trimmedText(1, 200)),
  ),
  color: Schema.optional(Schema.NullOr(ProjectColor)),
  sortOrder: Schema.optional(Schema.Int),
}));

export const PlanningProjectUpdateInput = strictSchema(Schema.Struct({
  name: Schema.optional(trimmedText(1, 100)),
  description: Schema.optional(
    Schema.Trim.check(Schema.isMaxLength(10_000)),
  ),
  status: Schema.optional(PlanningProjectStatus),
  leadUserId: Schema.optional(Schema.NullOr(UuidString)),
  startDate: Schema.optional(Schema.NullOr(ProjectDate)),
  targetDate: Schema.optional(Schema.NullOr(ProjectDate)),
  icon: Schema.optional(Schema.NullOr(trimmedText(1, 200))),
  color: Schema.optional(Schema.NullOr(ProjectColor)),
  sortOrder: Schema.optional(Schema.Int),
}).check(
  Schema.makeFilter((input) =>
    Object.keys(input).length > 0
      ? undefined
      : "At least one project change is required"
  ),
));

export const IssueProjectMoveInput = strictSchema(Schema.Struct({
  targetProjectId: UuidString,
}));

export const decodePlanningProjectCreateInput = decodeRequestSync(
  PlanningProjectCreateInput,
);
export const decodePlanningProjectUpdateInput = decodeRequestSync(
  PlanningProjectUpdateInput,
);
export const decodeIssueProjectMoveInput = decodeRequestSync(
  IssueProjectMoveInput,
);
