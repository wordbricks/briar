import type { WorkspaceRole } from "../types";

export type WorkspaceCapability =
  | "workspace:read"
  | "workspace:update"
  | "workspace:delete"
  | "members:manage"
  | "invitations:manage"
  | "projects:manage"
  | "development:manage"
  | "conversations:write"
  | "issues:write"
  | "issues:execute"
  | "results:review";

export const organizationAssignableRoles = [
  "co-owner",
  "developer",
  "editor",
  "viewer",
] as const;

const roleCapabilities = {
  owner: [
    "workspace:read",
    "workspace:update",
    "workspace:delete",
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
    "workspace:read",
    "workspace:update",
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
    "workspace:read",
    "development:manage",
    "conversations:write",
    "issues:write",
    "issues:execute",
    "results:review",
  ],
  editor: [
    "workspace:read",
    "conversations:write",
    "issues:write",
    "results:review",
  ],
  viewer: ["workspace:read"],
} as const satisfies Record<
  WorkspaceRole,
  readonly WorkspaceCapability[]
>;

export const hasWorkspaceCapability = (
  role: WorkspaceRole | null | undefined,
  capability: WorkspaceCapability,
) => Boolean(
  role &&
    (roleCapabilities[role] as readonly WorkspaceCapability[]).includes(
      capability,
    ),
);
