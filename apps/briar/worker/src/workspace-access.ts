import type { WorkspaceRole } from "./workspace-repository";

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
} as const satisfies Record<WorkspaceRole, readonly WorkspaceCapability[]>;

export const hasWorkspaceCapability = (
  role: WorkspaceRole | null,
  capability: WorkspaceCapability,
) =>
  role !== null &&
  (roleCapabilities[role] as readonly WorkspaceCapability[]).includes(
    capability,
  );
