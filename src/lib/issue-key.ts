export const defaultIssueKeyPrefix = "AH";
export const issueKeyPrefixPattern = /^[A-Z0-9]{1,3}$/u;

export function normalizeIssueKeyPrefix(value: string): string {
  return value.trim().toUpperCase();
}

export function isIssueKeyPrefix(value: string): boolean {
  return issueKeyPrefixPattern.test(normalizeIssueKeyPrefix(value));
}

export function formatIssueKey(
  prefix: string | null | undefined,
  runNumber: number,
): string {
  const normalized = prefix ? normalizeIssueKeyPrefix(prefix) : "";
  return `${isIssueKeyPrefix(normalized) ? normalized : defaultIssueKeyPrefix}-${runNumber}`;
}
