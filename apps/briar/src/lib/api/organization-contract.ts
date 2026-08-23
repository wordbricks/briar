import * as Schema from "effect/Schema";
import {
  DataImageString,
  defaulted,
  mutableArray,
  UuidString,
} from "./schema-helpers";

export const OrganizationResponse = Schema.Struct({
  id: UuidString,
  name: Schema.String,
  handle: Schema.String,
  logo: defaulted(Schema.NullOr(DataImageString), null),
  role: Schema.Literals(["owner", "admin", "member"]),
  createdAt: Schema.String,
});
export type OrganizationResponse = typeof OrganizationResponse.Type;

const OrganizationsResponse = mutableArray(OrganizationResponse);

export const decodeOrganizationResponse = Schema.decodeUnknownSync(
  OrganizationResponse,
);
export const decodeOrganizationsResponse = Schema.decodeUnknownSync(
  OrganizationsResponse,
);
