export type SettingsAccountTarget =
  | { scope: "application" }
  | { scope: "workspace"; workspaceId: string }
  | { scope: "project"; projectId: string };

export type SettingsAccountSelection =
  | { scope: "workspace"; workspaceId: string }
  | { scope: "project"; projectId: string }
  | null;

export function settingsAccountSelection(
  target: SettingsAccountTarget,
  activeWorkspaceId: string | null,
  activeProjectId: string | null,
): SettingsAccountSelection {
  if (target.scope === "workspace") {
    return target.workspaceId === activeWorkspaceId
      ? null
      : { scope: "workspace", workspaceId: target.workspaceId };
  }
  if (target.scope === "project") {
    return target.projectId === activeProjectId
      ? null
      : { scope: "project", projectId: target.projectId };
  }
  return null;
}
