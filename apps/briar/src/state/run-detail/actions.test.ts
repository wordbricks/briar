import { describe, expect, it } from "vitest";

import type { IssueMessage } from "../../types";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { activeTeamIdAtom } from "../team/atoms";
import {
  createRunDetailActions,
  type RunDetailActionApi,
  type RunDetailActions,
} from "./actions";
import { issueMessagesAtom, runEventsAtom, runEvidenceAtom } from "./atoms";

const teamId = "team-a";
const runId = "run-1";

const messageOf = (
  id: string,
  overrides: Partial<IssueMessage> = {},
): IssueMessage => ({
  id,
  runId,
  parentMessageId: null,
  body: id,
  attachments: [],
  author: { id: "user-1", name: "Tester", image: null, provider: null },
  replyCount: 0,
  proposedAction: null,
  executionProposal: null,
  skillExecutionProposal: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...overrides,
});

/** In-memory stand-in for the run detail RPCs. */
class RunDetailServer {
  messages: IssueMessage[] = [];
  readonly calls: string[] = [];

  readonly api: RunDetailActionApi = {
    createIssueMessage: async (_token, projectId, targetRunId, input) => {
      this.calls.push(`create:${projectId}:${targetRunId}`);
      return {
        message: messageOf("server-created", {
          body: input.body,
          parentMessageId: input.parentMessageId,
        }),
        agentReply: null,
        agentReplies: [],
      };
    },
    deleteIssueMessage: async (_token, projectId, targetRunId, messageId) => {
      this.calls.push(`delete:${projectId}:${targetRunId}:${messageId}`);
    },
    editIssueMessage: async (
      _token,
      projectId,
      targetRunId,
      messageId,
      input,
    ) => {
      this.calls.push(`edit:${projectId}:${targetRunId}:${messageId}`);
      return messageOf(messageId, { body: input.body });
    },
    loadIssueMessages: async (_token, projectId, targetRunId) => {
      this.calls.push(`messages:${projectId}:${targetRunId}`);
      return this.messages;
    },
    loadRunEvents: async (_token, projectId, targetRunId) => {
      this.calls.push(`events:${projectId}:${targetRunId}`);
      return [];
    },
    loadRunEvidence: async (_token, projectId, targetRunId) => {
      this.calls.push(`evidence:${projectId}:${targetRunId}`);
      return [];
    },
    loadRunEvidenceImage: async () => new Blob(),
  };
}

interface Harness {
  readonly actions: RunDetailActions;
  readonly registry: AtomRegistry;
  readonly server: RunDetailServer;
}

const harness = (
  options: { token?: string | null; demoMode?: boolean } = {},
): Harness => {
  const registry = createTestRegistry();
  registry.set(activeTeamIdAtom, teamId);
  registry.set(tokenAtom, options.token === undefined ? "token" : options.token);
  const server = new RunDetailServer();
  const actions = createRunDetailActions(registry, {
    api: server.api,
    demoMode: options.demoMode ?? false,
  });
  return { actions, registry, server };
};

describe("run detail reads", () => {
  it("merges fetched messages onto the ones already loaded", async () => {
    const { actions, registry, server } = harness();
    registry.set(issueMessagesAtom(runId), [messageOf("local-1")]);
    server.messages = [messageOf("local-1", { body: "edited" })];

    const merged = await actions.readIssueMessages(runId);

    expect(merged.map((message) => message.body)).toEqual(["edited"]);
    expect(registry.get(issueMessagesAtom(runId))).toEqual(merged);
  });

  it("stores fetched events and evidence on the run's atoms", async () => {
    const { actions, registry } = harness();
    await actions.readRunEvents(runId);
    await actions.readRunEvidence(runId);
    expect(registry.get(runEventsAtom(runId))).toEqual([]);
    expect(registry.get(runEvidenceAtom(runId))).toEqual([]);
  });

  it("reads the cached collections without a request in demo mode", async () => {
    const { actions, registry, server } = harness({
      demoMode: true,
      token: null,
    });
    registry.set(issueMessagesAtom(runId), [messageOf("demo-1")]);
    await expect(actions.readIssueMessages(runId)).resolves.toEqual([
      messageOf("demo-1"),
    ]);
    expect(server.calls).toEqual([]);
  });

  it("refuses to read without a team or a token", async () => {
    const { actions, registry } = harness({ token: null });
    await expect(actions.readIssueMessages(runId)).rejects.toThrow(
      "메시지를 불러오려면 로그인이 필요합니다.",
    );
    registry.set(activeTeamIdAtom, null);
    await expect(actions.readRunEvents(runId)).rejects.toThrow(
      "이벤트를 불러올 프로젝트가 없습니다.",
    );
  });
});

describe("issue messages", () => {
  it("appends a sent message and bumps its parent's reply count", async () => {
    const { actions, registry } = harness();
    registry.set(issueMessagesAtom(runId), [messageOf("server-created")]);

    await actions.addIssueMessage(runId, {
      body: " hello ",
      parentMessageId: "server-created",
    });

    const messages = registry.get(issueMessagesAtom(runId));
    expect(messages).toHaveLength(2);
    expect(messages[0]?.replyCount).toBe(1);
    expect(messages[1]?.body).toBe("hello");
  });

  it("rejects an empty message before touching the server", async () => {
    const { actions, server } = harness();
    await expect(
      actions.addIssueMessage(runId, { body: "   ", parentMessageId: null }),
    ).rejects.toThrow("메시지나 이미지를 추가해 주세요.");
    expect(server.calls).toEqual([]);
  });

  it("creates the message locally in demo mode", async () => {
    const { actions, registry, server } = harness({
      demoMode: true,
      token: null,
    });
    const result = await actions.addIssueMessage(runId, {
      body: "demo",
      parentMessageId: null,
    });
    expect(result.message.body).toBe("demo");
    expect(registry.get(issueMessagesAtom(runId))).toHaveLength(1);
    expect(server.calls).toEqual([]);
  });

  it("replaces an edited message in place", async () => {
    const { actions, registry } = harness();
    registry.set(issueMessagesAtom(runId), [
      messageOf("m-1"),
      messageOf("m-2"),
    ]);
    await actions.updateIssueMessage(runId, "m-2", { body: "edited" });
    expect(
      registry.get(issueMessagesAtom(runId)).map((message) => message.body),
    ).toEqual(["m-1", "edited"]);
  });

  it("deletes a message together with its replies", async () => {
    const { actions, registry, server } = harness();
    registry.set(issueMessagesAtom(runId), [
      messageOf("root"),
      messageOf("reply", { parentMessageId: "root" }),
      messageOf("nested", { parentMessageId: "reply" }),
      messageOf("other"),
    ]);

    await actions.removeIssueMessage(runId, "root");

    expect(
      registry.get(issueMessagesAtom(runId)).map((message) => message.id),
    ).toEqual(["other"]);
    expect(server.calls).toEqual([`delete:${teamId}:${runId}:root`]);
  });

  it("refuses to send without a token", async () => {
    const { actions } = harness({ token: null });
    await expect(
      actions.addIssueMessage(runId, { body: "hi", parentMessageId: null }),
    ).rejects.toThrow("메시지를 보내려면 로그인이 필요합니다.");
  });
});
