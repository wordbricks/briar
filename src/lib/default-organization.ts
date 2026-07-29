import type { Organization, SessionUser } from "../types";

type DefaultOrganizationDependencies = {
  createOrganization: (
    token: string,
    input: { name: string; handle: string },
  ) => Promise<{ organization: Organization }>;
  loadOrganizations: (token: string) => Promise<Organization[]>;
};

export function defaultOrganizationInput(user: SessionUser) {
  const ownerName =
    user.name.trim() || user.email.split("@")[0]?.trim() || "Briar";
  const normalizedUserId = user.id
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 50);

  return {
    name: ownerName,
    handle: `organization-${normalizedUserId || crypto.randomUUID().replaceAll("-", "")}`,
  };
}

export async function ensureDefaultOrganization(
  token: string,
  user: SessionUser,
  organizations: Organization[],
  dependencies: DefaultOrganizationDependencies,
) {
  if (organizations.length > 0) return organizations;

  try {
    const result = await dependencies.createOrganization(
      token,
      defaultOrganizationInput(user),
    );
    return [result.organization];
  } catch (error) {
    // Another signed-in client may have created the deterministic default
    // organization at the same time. Reload before surfacing the failure.
    const refreshedOrganizations =
      await dependencies.loadOrganizations(token);
    if (refreshedOrganizations.length > 0) return refreshedOrganizations;
    throw error;
  }
}
