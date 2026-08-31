import { describe, expect, it } from "vitest";
import { channelMessageAuthorJson } from "./channels";

const userAuthorRow = {
  author_user_id: "user-1",
  author_name: "Ada",
  author_email: "ada@example.com",
  author_image: null,
  author_agent_id: null,
  author_agent_name: null,
  author_agent_provider: null,
  author_agent_image: null,
  author_webhook_id: null,
  author_webhook_name: null,
} as const;

describe("channel message author mapping", () => {
  it.each([
    ["author_user_id", "user id"],
    ["author_name", "user name"],
    ["author_email", "user email"],
  ] as const)("rejects a blank user author %s", (field, label) => {
    expect(() => channelMessageAuthorJson({
      ...userAuthorRow,
      [field]: "",
    })).toThrow(`Channel message author ${label} is missing`);
  });
});
