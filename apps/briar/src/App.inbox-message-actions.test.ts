import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve("src", "App.tsx"), "utf8");

describe("Inbox issue message actions", () => {
  it("binds message editing and deletion to the issue opened in Inbox detail", () => {
    const inboxDetailStart = appSource.indexOf(
      "const renderInboxDetailContent =",
    );
    const inboxDetailEnd = appSource.indexOf(
      "const inboxDetailLabel =",
      inboxDetailStart,
    );
    const inboxDetailSource = appSource.slice(inboxDetailStart, inboxDetailEnd);

    expect(inboxDetailStart).toBeGreaterThan(-1);
    expect(inboxDetailEnd).toBeGreaterThan(inboxDetailStart);
    expect(inboxDetailSource).toContain(
      "briar.updateIssueMessage(inboxDetailRun.id, messageId, input)",
    );
    expect(inboxDetailSource).toContain(
      "briar.removeIssueMessage(inboxDetailRun.id, messageId)",
    );
  });
});
