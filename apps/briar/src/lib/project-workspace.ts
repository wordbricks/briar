/** Folder name of a repository path, used as the project name when connecting one. */
export function repositoryProjectName(repositoryPath: string): string {
  const segments = repositoryPath
    .trim()
    .replace(/[\\/]+$/u, "")
    .split(/[\\/]/u);
  return segments[segments.length - 1]?.trim() ?? "";
}

export type GithubRepositoryReference = {
  fullName: string;
  name: string;
};

/** Repository identity from a GitHub HTTPS or SSH clone URL. */
export function githubRepositoryFromUrl(
  repositoryUrl: string,
): GithubRepositoryReference | null {
  const value = repositoryUrl.trim().replace(/\/+$/u, "");
  const prefixes = [
    "https://github.com/",
    "git@github.com:",
    "ssh://git@github.com/",
  ];
  const prefix = prefixes.find((candidate) => value.startsWith(candidate));
  if (!prefix) return null;

  const path = value.slice(prefix.length);
  const segments = path.split("/");
  if (segments.length !== 2) return null;
  const owner = segments[0] ?? "";
  const repository = (segments[1] ?? "").replace(/\.git$/u, "");
  const validSegment = (segment: string) =>
    Boolean(segment) &&
    segment !== "." &&
    segment !== ".." &&
    /^[A-Za-z0-9_.-]+$/u.test(segment);
  if (!validSegment(owner) || !validSegment(repository)) return null;

  return {
    fullName: `${owner}/${repository}`,
    name: repository,
  };
}
