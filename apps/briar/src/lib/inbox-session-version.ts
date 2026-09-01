const inboxSessionVersionPrefix = "session:v1:";

export function inboxSessionMessageVersion(
  status: string,
  occurredAt: string,
) {
  return `${inboxSessionVersionPrefix}${status}:${occurredAt}`;
}
