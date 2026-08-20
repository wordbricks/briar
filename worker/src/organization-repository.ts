import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { runD1 } from "./d1-runtime";

export const OrganizationRole = Schema.Literals(["owner", "admin", "member"]);
export type OrganizationRole = typeof OrganizationRole.Type;

const OrganizationRow = Schema.Struct({
  id: Schema.mutableKey(Schema.String),
  name: Schema.mutableKey(Schema.String),
  handle: Schema.mutableKey(Schema.String),
  logo: Schema.mutableKey(Schema.NullOr(Schema.String)),
  role: Schema.mutableKey(OrganizationRole),
  created_at: Schema.mutableKey(Schema.String),
});
export type OrganizationRow = typeof OrganizationRow.Type;

const ListOrganizationsRequest = Schema.Struct({ userId: Schema.String });

const findOrganizations = SqlSchema.findAll({
  Request: ListOrganizationsRequest,
  Result: OrganizationRow,
  execute: ({ userId }) =>
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`
        select organization.id, organization.name, organization.handle,
               coalesce(organization.logo_data_url, organization.logo) as logo,
               membership.role,
               organization.created_at
        from briar_organizations organization
        join briar_organization_members membership
          on membership.organization_id = organization.id
        where membership.user_id = ${userId}
        order by organization.created_at, organization.id
      `,
    ),
});

const listOrganizationsEffect = Effect.fn("listOrganizationsEffect")(
  function*(userId: string) {
    return yield* findOrganizations({ userId });
  },
);

export const listOrganizations = (
  db: D1Database,
  userId: string,
): Promise<Array<OrganizationRow>> =>
  runD1(db, listOrganizationsEffect(userId));
