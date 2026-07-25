/** How a project is started: from a repository that already exists, or from scratch. */
export type ProjectStartMode = "existing" | "new";

/** Folder name of a repository path, used as the project name when connecting one. */
export function repositoryProjectName(repositoryPath: string): string {
  const segments = repositoryPath
    .trim()
    .replace(/[\\/]+$/u, "")
    .split(/[\\/]/u);
  return segments[segments.length - 1]?.trim() ?? "";
}

/** Mirrors the folder naming Briar uses when it creates a repository for a new project. */
export function projectFolderName(name: string): string {
  return name
    .trim()
    .replace(/[\p{Cc}\s/\\:*?"<>|]/gu, "-")
    .replace(/^[-.]+|[-.]+$/gu, "");
}

/** Where a brand-new project's repository will live, for previewing before creation. */
export function projectWorkspacePath(
  workspaceRoot: string | null,
  name: string,
): string | null {
  const folder = projectFolderName(name);
  if (!workspaceRoot || !folder) return null;
  return `${workspaceRoot.replace(/\/+$/u, "")}/${folder}`;
}
