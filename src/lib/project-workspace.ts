/** Folder name of a repository path, used as the project name when connecting one. */
export function repositoryProjectName(repositoryPath: string): string {
  const segments = repositoryPath
    .trim()
    .replace(/[\\/]+$/u, "")
    .split(/[\\/]/u);
  return segments[segments.length - 1]?.trim() ?? "";
}
