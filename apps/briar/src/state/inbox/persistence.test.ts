/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";

import type { InboxMessage } from "./model";
import {
  INBOX_STORAGE_PREFIX,
  inboxStorageKey,
  readInboxState,
  readInboxStorage,
  writeInboxStorage,
} from "./persistence";

/*
  The record `hooks/useInbox.ts` wrote, read by the module that replaced it.

  An app that upgrades into `state/inbox` has to find yesterday's inbox where it
  left it, so the key and the JSON shape are pinned here rather than inferred
  from a round trip through the new writer.
*/

const message = (id: string, version: string): InboxMessage => ({
  id,
  kind: "issue",
  projectId: "team-a",
  projectName: "Team A",
  targetId: "run-1",
  title: "Fix it",
  occurredAt: "2026-09-01T00:00:00.000Z",
  version,
  runNumber: 1,
  status: "failed",
  workflowStage: null,
  priority: null,
  structuredResult: null,
});

describe("inbox storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keys the record by account, under the shipped prefix", () => {
    expect(INBOX_STORAGE_PREFIX).toBe("briar.inbox.v1");
    expect(inboxStorageKey("user-1")).toBe("briar.inbox.v1:user-1");
    expect(inboxStorageKey(null)).toBe("briar.inbox.v1:signed-out");
  });

  it("reads a record the previous implementation wrote", () => {
    window.localStorage.setItem(
      "briar.inbox.v1:user-1",
      JSON.stringify({
        messages: [message("issue:run-1", "v1")],
        readVersions: { "issue:run-1": "v0" },
      }),
    );

    expect(readInboxState("briar.inbox.v1:user-1")).toEqual({
      storageKey: "briar.inbox.v1:user-1",
      messages: [message("issue:run-1", "v1")],
      readVersions: { "issue:run-1": "v0" },
    });
  });

  it("round trips what it writes", () => {
    const storage = {
      messages: [message("issue:run-1", "v2")],
      readVersions: { "issue:run-1": "v2" },
    };
    writeInboxStorage("briar.inbox.v1:user-1", storage);

    expect(
      JSON.parse(
        window.localStorage.getItem("briar.inbox.v1:user-1") ?? "null",
      ),
    ).toEqual(storage);
    expect(readInboxStorage("briar.inbox.v1:user-1")).toEqual(storage);
  });

  it("reads an absent, malformed or half-typed record as an empty inbox", () => {
    expect(readInboxStorage("briar.inbox.v1:missing")).toEqual({
      messages: [],
      readVersions: {},
    });

    window.localStorage.setItem("briar.inbox.v1:broken", "{ not json");
    expect(readInboxStorage("briar.inbox.v1:broken")).toEqual({
      messages: [],
      readVersions: {},
    });

    window.localStorage.setItem(
      "briar.inbox.v1:odd",
      JSON.stringify({ messages: [null, { noId: true }], readVersions: [] }),
    );
    expect(readInboxStorage("briar.inbox.v1:odd")).toEqual({
      messages: [],
      readVersions: {},
    });
  });
});
