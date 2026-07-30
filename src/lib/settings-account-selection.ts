export type SettingsAccountTarget =
  | { scope: "application" }
  | { scope: "organization"; organizationId: string }
  | { scope: "project"; projectId: string };

export type SettingsAccountSelection =
  | { scope: "organization"; organizationId: string }
  | { scope: "project"; projectId: string }
  | null;

export function settingsAccountSelection(
  target: SettingsAccountTarget,
  activeOrganizationId: string | null,
  activeProjectId: string | null,
): SettingsAccountSelection {
  if (target.scope === "organization") {
    return target.organizationId === activeOrganizationId
      ? null
      : { scope: "organization", organizationId: target.organizationId };
  }
  if (target.scope === "project") {
    return target.projectId === activeProjectId
      ? null
      : { scope: "project", projectId: target.projectId };
  }
  return null;
}
