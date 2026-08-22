import type { HuntRunRow } from "./hunt-run-model";

const parseJsonArray = (value: string) => {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
};

export const issueSubscribers = (
  run: Pick<HuntRunRow, "subscribers_json">,
) =>
  parseJsonArray(run.subscribers_json ?? "[]").flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const subscriber = value as Record<string, unknown>;
    return typeof subscriber.userId === "string" &&
        typeof subscriber.subscribedAt === "string"
      ? [{
          userId: subscriber.userId,
          subscribedAt: subscriber.subscribedAt,
        }]
      : [];
  });
