import * as Schema from "effect/Schema";
import { IsoDateTimeUtc } from "./date-time";
import { defineOperation } from "./operation";

type MutableFields<Fields extends Schema.Struct.Fields> = {
  readonly [Key in keyof Fields]: Schema.mutableKey<Fields[Key]>;
};

const mutableStruct = <const Fields extends Schema.Struct.Fields>(
  fields: Fields,
): Schema.Struct<MutableFields<Fields>> => {
  const mutableFields = {} as {
    -readonly [Key in keyof Fields]: Schema.mutableKey<Fields[Key]>;
  };
  for (const key of Reflect.ownKeys(fields) as Array<keyof Fields>) {
    mutableFields[key] = Schema.mutableKey(fields[key]);
  }
  return Schema.Struct(mutableFields);
};

const mutableArray = <S extends Schema.Top>(item: S) =>
  Schema.mutable(Schema.Array(item));

export const mobileProjectSchema = mutableStruct({
  id: Schema.String.check(Schema.isUUID()),
  name: Schema.String,
  issueKeyPrefix: Schema.String.check(
    Schema.isPattern(/^[A-Z0-9]{1,3}$/u),
  ),
  scheduleTabEnabled: Schema.Boolean,
  icon: Schema.NullOr(Schema.String),
  organizationId: Schema.String.check(Schema.isUUID()),
  organizationName: Schema.String,
  role: Schema.Literals([
    "owner",
    "co-owner",
    "developer",
    "editor",
    "viewer",
  ]),
  createdAt: IsoDateTimeUtc,
}).annotate({ identifier: "Project" });

export type MobileProject = typeof mobileProjectSchema.Type;

export const mobileProjectsResponseSchema = mutableStruct({
  projects: mutableArray(mobileProjectSchema),
}).annotate({ identifier: "ProjectsResponse" });

export type MobileProjectsResponse = typeof mobileProjectsResponseSchema.Type;

export const listProjectsOperation = defineOperation({
  id: "listProjects",
  method: "GET",
  path: "/projects",
  security: "bearer",
  errors: [{ status: 401, responseComponent: "Error" }],
  response: {
    status: 200,
    description: "Projects visible to the authenticated user",
    contentType: "application/json",
    component: "ProjectsResponse",
    schema: mobileProjectsResponseSchema,
  },
});
