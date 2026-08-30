import type { OrganizationRole } from "./organization-repository";

export type OrganizationCapability =
  | "organization:read"
  | "organization:update"
  | "organization:delete"
  | "members:manage"
  | "invitations:manage"
  | "projects:manage"
  | "development:manage"
  | "conversations:write"
  | "issues:write"
  | "issues:execute"
  | "results:review";

const roleCapabilities = {
  owner: [
    "organization:read",
    "organization:update",
    "organization:delete",
    "members:manage",
    "invitations:manage",
    "projects:manage",
    "development:manage",
    "conversations:write",
    "issues:write",
    "issues:execute",
    "results:review",
  ],
  "co-owner": [
    "organization:read",
    "organization:update",
    "members:manage",
    "invitations:manage",
    "projects:manage",
    "development:manage",
    "conversations:write",
    "issues:write",
    "issues:execute",
    "results:review",
  ],
  developer: [
    "organization:read",
    "development:manage",
    "conversations:write",
    "issues:write",
    "issues:execute",
    "results:review",
  ],
  editor: [
    "organization:read",
    "conversations:write",
    "issues:write",
    "results:review",
  ],
  viewer: ["organization:read"],
} as const satisfies Record<OrganizationRole, readonly OrganizationCapability[]>;

export const hasOrganizationCapability = (
  role: OrganizationRole | null,
  capability: OrganizationCapability,
) =>
  role !== null &&
  (roleCapabilities[role] as readonly OrganizationCapability[]).includes(
    capability,
  );
