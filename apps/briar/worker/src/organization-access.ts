import type { OrganizationRole } from "./organization-repository";

export const canManageOrganization = (role: OrganizationRole | null) =>
  role === "owner" || role === "admin";
