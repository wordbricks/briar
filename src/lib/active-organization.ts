import type { Organization, Project } from "../types";

const storageKeyPrefix = "briar.active-organization.v1";

const storageKeyFor = (userId: string) =>
  `${storageKeyPrefix}:${encodeURIComponent(userId)}`;

export function readActiveOrganizationId(userId: string) {
  try {
    return window.localStorage.getItem(storageKeyFor(userId));
  } catch {
    return null;
  }
}

export function writeActiveOrganizationId(
  userId: string,
  organizationId: string,
) {
  try {
    window.localStorage.setItem(storageKeyFor(userId), organizationId);
  } catch {
    // Keep the active organization in memory when storage is unavailable.
  }
}

export function resolveActiveAccountSelection(
  userId: string,
  organizations: Organization[],
  projects: Project[],
) {
  const storedOrganizationId = readActiveOrganizationId(userId);
  const activeOrganizationId =
    organizations.find(
      (organization) => organization.id === storedOrganizationId,
    )?.id ??
    organizations.find(
      (organization) => organization.id === projects[0]?.organizationId,
    )?.id ??
    organizations[0]?.id ??
    null;
  const activeProjectId =
    projects.find(
      (project) => project.organizationId === activeOrganizationId,
    )?.id ?? null;

  return { activeOrganizationId, activeProjectId };
}
