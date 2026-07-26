export type ApiScopedProject = {
  id: string;
  apiUrl?: string;
};

export function normalizeApiUrl(apiUrl: string): string {
  return apiUrl.trim().replace(/\/+$/u, "");
}

export function sameApiEnvironment(left: string, right: string): boolean {
  return normalizeApiUrl(left) === normalizeApiUrl(right);
}

export function selectProjectForApi<T extends ApiScopedProject>(
  projects: T[],
  apiUrl: string,
  requestedProjectId?: string,
): T | undefined {
  if (requestedProjectId) {
    const requested = projects.find((project) => project.id === requestedProjectId);
    return requested &&
      (!requested.apiUrl || sameApiEnvironment(requested.apiUrl, apiUrl))
      ? requested
      : undefined;
  }

  return (
    projects.find(
      (project) =>
        Boolean(project.apiUrl) && sameApiEnvironment(project.apiUrl!, apiUrl),
    ) ?? projects.find((project) => !project.apiUrl)
  );
}
