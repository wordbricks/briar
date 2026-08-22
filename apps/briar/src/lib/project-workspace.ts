/** Folder name of a repository path, used as the project name when connecting one. */
export function repositoryProjectName(repositoryPath: string): string {
  const segments = repositoryPath
    .trim()
    .replace(/[\\/]+$/u, "")
    .split(/[\\/]/u);
  return segments[segments.length - 1]?.trim() ?? "";
}

/** Repository name from a GitHub SSH clone URL, or null when the URL is invalid. */
export function githubSshRepositoryName(repositoryUrl: string): string | null {
  const path = repositoryUrl
    .trim()
    .replace(/^git@github\.com:/u, "")
    .replace(/^ssh:\/\/git@github\.com\//u, "");
  if (path === repositoryUrl.trim()) return null;
  const segments = path.split("/");
  if (segments.length !== 2) return null;
  const owner = segments[0] ?? "";
  const repository = (segments[1] ?? "").replace(/\.git$/u, "");
  const validSegment = (segment: string) =>
    Boolean(segment) &&
    segment !== "." &&
    segment !== ".." &&
    /^[A-Za-z0-9_.-]+$/u.test(segment);
  return validSegment(owner) && validSegment(repository) ? repository : null;
}
