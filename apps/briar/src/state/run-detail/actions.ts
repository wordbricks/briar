import { useMemo } from "react";

import {
  createIssueMessage as createRemoteIssueMessage,
  deleteIssueMessage as deleteRemoteIssueMessage,
  editIssueMessage as editRemoteIssueMessage,
  loadIssueMessages as loadRemoteIssueMessages,
  loadRunEvents as loadRemoteRunEvents,
  loadRunEvidence as loadRemoteRunEvidence,
  loadRunEvidenceImage as loadRemoteRunEvidenceImage,
} from "../../lib/api";
import { mergeIssueMessages } from "../../lib/issue-message-merge";
import type {
  HuntEvent,
  IssueMessage,
  IssueMessageSendResult,
  RunEvidence,
  RunEvidenceImage,
} from "../../types";
import { demoUser } from "../demo-fixtures";
import { demoMode as platformDemoMode } from "../platform";
import { useRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { activeTeamIdAtom } from "../team/atoms";
import {
  issueMessagesAtom,
  runEventsAtom,
  runEvidenceAtom,
  touchRunDetail,
} from "./atoms";

/*
  Loading and writing one run's detail.

  These were `useBriar` callbacks over three refs. Moving them onto the
  `state/run-detail` families is what makes a fetched page reach the view on its
  own instead of waiting for the next unrelated render, and keeps the reads out
  of the facade's dependency graph.
*/

/** Remote reads and writes the run detail actions perform. */
export interface RunDetailActionApi {
  readonly createIssueMessage: typeof createRemoteIssueMessage;
  readonly deleteIssueMessage: typeof deleteRemoteIssueMessage;
  readonly editIssueMessage: typeof editRemoteIssueMessage;
  readonly loadIssueMessages: typeof loadRemoteIssueMessages;
  readonly loadRunEvents: typeof loadRemoteRunEvents;
  readonly loadRunEvidence: typeof loadRemoteRunEvidence;
  readonly loadRunEvidenceImage: typeof loadRemoteRunEvidenceImage;
}

export const liveRunDetailActionApi: RunDetailActionApi = {
  createIssueMessage: createRemoteIssueMessage,
  deleteIssueMessage: deleteRemoteIssueMessage,
  editIssueMessage: editRemoteIssueMessage,
  loadIssueMessages: loadRemoteIssueMessages,
  loadRunEvents: loadRemoteRunEvents,
  loadRunEvidence: loadRemoteRunEvidence,
  loadRunEvidenceImage: loadRemoteRunEvidenceImage,
};

export interface RunDetailActionDeps {
  readonly api?: Partial<RunDetailActionApi> | undefined;
  /**
   * Overrides the platform's demo flag. It is a build-time constant that is
   * always off under the test runner, so the demo branches would otherwise be
   * unreachable from a test.
   */
  readonly demoMode?: boolean | undefined;
}

export interface AddIssueMessageInput {
  readonly body: string;
  readonly clientMessageId?: string | undefined;
  readonly parentMessageId: string | null;
  readonly mentionedUserIds?: string[] | undefined;
  readonly mentionedAgentIds?: string[] | undefined;
  readonly attachments?: File[] | undefined;
  readonly attachmentReferences?: string[] | undefined;
}

export interface RunDetailActions {
  readonly readIssueMessages: (runId: string) => Promise<IssueMessage[]>;
  readonly readRunEvents: (runId: string) => Promise<HuntEvent[]>;
  readonly readRunEvidence: (runId: string) => Promise<RunEvidence[]>;
  readonly readRunEvidenceImage: (image: RunEvidenceImage) => Promise<Blob>;
  readonly addIssueMessage: (
    runId: string,
    input: AddIssueMessageInput,
  ) => Promise<IssueMessageSendResult>;
  readonly updateIssueMessage: (
    runId: string,
    messageId: string,
    input: { body: string; mentionedUserIds?: string[] },
  ) => Promise<IssueMessage>;
  readonly removeIssueMessage: (
    runId: string,
    messageId: string,
  ) => Promise<void>;
}

/**
 * A message and every reply beneath it, transitively. Deleting a message hides
 * its whole subtree, and the server answers the same way.
 */
function withDescendantIds(
  messages: readonly IssueMessage[],
  messageId: string,
): Set<string> {
  const deleted = new Set<string>([messageId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of messages) {
      if (
        candidate.parentMessageId &&
        deleted.has(candidate.parentMessageId) &&
        !deleted.has(candidate.id)
      ) {
        deleted.add(candidate.id);
        changed = true;
      }
    }
  }
  return deleted;
}

export function createRunDetailActions(
  registry: AtomRegistry,
  deps: RunDetailActionDeps = {},
): RunDetailActions {
  const api: RunDetailActionApi = { ...liveRunDetailActionApi, ...deps.api };
  const demoMode = deps.demoMode ?? platformDemoMode;

  const requireTeam = (message: string) => {
    const teamId = registry.get(activeTeamIdAtom);
    if (!teamId) throw new Error(message);
    return teamId;
  };

  const requireToken = (message: string) => {
    const token = registry.get(tokenAtom);
    if (!token) throw new Error(message);
    return token;
  };

  /** Appends a message locally, keeping its parent's reply count honest. */
  const cacheMessage = (runId: string, message: IssueMessage) => {
    registry.update(issueMessagesAtom(runId), (current) => [
      ...current.map((candidate) =>
        candidate.id === message.parentMessageId
          ? { ...candidate, replyCount: candidate.replyCount + 1 }
          : candidate,
      ),
      message,
    ]);
    return message;
  };

  const replaceMessage = (
    runId: string,
    messageId: string,
    message: IssueMessage,
  ) => {
    registry.update(issueMessagesAtom(runId), (current) =>
      current.map((candidate) =>
        candidate.id === messageId ? message : candidate,
      ),
    );
    return message;
  };

  const dropMessageSubtree = (runId: string, messageId: string) => {
    const current = registry.get(issueMessagesAtom(runId));
    const deleted = withDescendantIds(current, messageId);
    registry.set(
      issueMessagesAtom(runId),
      current.filter((candidate) => !deleted.has(candidate.id)),
    );
  };

  return {
    async readIssueMessages(runId) {
      const teamId = requireTeam("메시지를 불러올 프로젝트가 없습니다.");
      touchRunDetail(registry, runId);
      if (demoMode) return registry.get(issueMessagesAtom(runId));
      const token = requireToken("메시지를 불러오려면 로그인이 필요합니다.");
      const messages = await api.loadIssueMessages(token, teamId, runId);
      const merged = mergeIssueMessages(
        registry.get(issueMessagesAtom(runId)),
        messages,
      );
      registry.set(issueMessagesAtom(runId), merged);
      return merged;
    },

    async readRunEvents(runId) {
      const teamId = requireTeam("이벤트를 불러올 프로젝트가 없습니다.");
      touchRunDetail(registry, runId);
      if (demoMode) return registry.get(runEventsAtom(runId));
      const token = requireToken("이벤트를 불러오려면 로그인이 필요합니다.");
      const events = await api.loadRunEvents(token, teamId, runId);
      registry.set(runEventsAtom(runId), events);
      return events;
    },

    async readRunEvidence(runId) {
      const teamId = requireTeam("증빙을 불러올 프로젝트가 없습니다.");
      touchRunDetail(registry, runId);
      if (demoMode) return registry.get(runEvidenceAtom(runId));
      const token = requireToken("증빙을 불러오려면 로그인이 필요합니다.");
      const evidence = await api.loadRunEvidence(token, teamId, runId);
      registry.set(runEvidenceAtom(runId), evidence);
      return evidence;
    },

    async readRunEvidenceImage(image) {
      const token = requireToken("증빙 이미지를 불러오려면 로그인이 필요합니다.");
      return api.loadRunEvidenceImage(token, image);
    },

    async addIssueMessage(runId, input) {
      const body = input.body.trim();
      if (!body && !input.attachments?.length) {
        throw new Error("메시지나 이미지를 추가해 주세요.");
      }
      const teamId = requireTeam("메시지를 보낼 프로젝트가 없습니다.");
      if (demoMode) {
        const createdAt = new Date().toISOString();
        const message = cacheMessage(runId, {
          id: input.clientMessageId ?? crypto.randomUUID(),
          runId,
          parentMessageId: input.parentMessageId,
          body,
          attachments: (input.attachments ?? []).map((file, index) => ({
            id: input.attachmentReferences?.[index] ?? crypto.randomUUID(),
            filename: file.name,
            contentType: file.type,
            byteSize: file.size,
            url: URL.createObjectURL(file),
          })),
          author: {
            id: demoUser.id,
            name: demoUser.name,
            image: demoUser.image ?? null,
            provider: null,
          },
          replyCount: 0,
          proposedAction: null,
          executionProposal: null,
          skillExecutionProposal: null,
          createdAt,
          updatedAt: createdAt,
        });
        return { message, agentReply: null };
      }
      const token = requireToken("메시지를 보내려면 로그인이 필요합니다.");
      const created = await api.createIssueMessage(token, teamId, runId, {
        body,
        clientMessageId: input.clientMessageId,
        parentMessageId: input.parentMessageId,
        mentionedUserIds: input.mentionedUserIds,
        mentionedAgentIds: input.mentionedAgentIds,
        attachments: input.attachments,
        attachmentReferences: input.attachmentReferences,
      });
      return {
        message: cacheMessage(runId, created.message),
        agentReply: null,
        agentReplyJob: created.agentReply,
        agentReplyJobs:
          created.agentReplies ??
          (created.agentReply ? [created.agentReply] : []),
      };
    },

    async updateIssueMessage(runId, messageId, input) {
      const body = input.body.trim();
      if (!body) throw new Error("메시지 내용을 입력해 주세요.");
      const teamId = requireTeam("수정할 프로젝트가 없습니다.");
      if (demoMode) {
        const existing = registry
          .get(issueMessagesAtom(runId))
          .find((candidate) => candidate.id === messageId);
        return replaceMessage(runId, messageId, {
          ...existing,
          body,
          updatedAt: new Date().toISOString(),
        } as IssueMessage);
      }
      const token = requireToken("메시지를 수정하려면 로그인이 필요합니다.");
      const updated = await api.editIssueMessage(
        token,
        teamId,
        runId,
        messageId,
        { body, mentionedUserIds: input.mentionedUserIds },
      );
      return replaceMessage(runId, messageId, updated);
    },

    async removeIssueMessage(runId, messageId) {
      const teamId = requireTeam("삭제할 프로젝트가 없습니다.");
      if (!demoMode) {
        const token = requireToken("메시지를 삭제하려면 로그인이 필요합니다.");
        await api.deleteIssueMessage(token, teamId, runId, messageId);
      }
      dropMessageSubtree(runId, messageId);
    },
  };
}

export function useRunDetailActions(
  deps: RunDetailActionDeps = {},
): RunDetailActions {
  const registry = useRegistry();
  const { api, demoMode } = deps;
  return useMemo(
    () => createRunDetailActions(registry, { api, demoMode }),
    [api, demoMode, registry],
  );
}
