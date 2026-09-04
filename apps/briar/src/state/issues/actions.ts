import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo } from "react";

import {
  acceptIssueActionProposal as acceptRemoteIssueActionProposal,
  acceptIssueExecutionProposal as acceptRemoteIssueExecutionProposal,
  acceptIssueReworkProposal as acceptRemoteIssueReworkProposal,
  acceptIssueSkillExecutionProposal as acceptRemoteIssueSkillExecutionProposal,
  addIssueDependency as addRemoteIssueDependency,
  addRelatedIssue as addRemoteRelatedIssue,
  cancelHuntRun,
  completeIssueResultReview as completeRemoteIssueResultReview,
  createIssue as createRemoteIssue,
  deleteIssue as deleteRemoteIssue,
  isApiErrorStatus,
  loadIssueAttachment,
  moveHuntRun,
  moveIssueToPlanningProject as moveRemoteIssueToPlanningProject,
  removeIssueDependency as removeRemoteIssueDependency,
  removeIssueParent as removeRemoteIssueParent,
  removeRelatedIssue as removeRemoteRelatedIssue,
  resumeHuntRun,
  retryHuntRun,
  reworkPausedHuntRun,
  setIssueParent as setRemoteIssueParent,
  transferIssue as transferRemoteIssue,
  unassignHuntRun,
  updateIssue as updateRemoteIssue,
  updateIssueCheckpoints as updateRemoteIssueCheckpoints,
  updateIssueExecutionPreferences as updateRemoteIssueExecutionPreferences,
  updateIssueSubscription as updateRemoteIssueSubscription,
} from "../../lib/api";
import {
  progressForAutoHuntRun,
  workflowWithAdditionalCheckpoints,
  type AutoHuntWorkflowCheckpoint,
} from "../../lib/auto-hunt-contract";
import { canonicalizeIssueAttachmentReferences } from "../../lib/issue-markdown";
import type {
  AgentSkillExecutionApprovalInput,
  AgentSkillExecutionProposal,
  CreateIssueInput,
  HuntEvent,
  HuntRun,
  HuntRunPlacement,
  IssueAttachment,
  IssueExecutionApprovalInput,
  IssueExecutionPreferences,
  IssueExecutionProposal,
  IssueProposedAction,
  IssueResultReview,
  IssueDependencyReference,
  UpdateIssueInput,
} from "../../types";
import { createAgentSessionActions } from "../agent-sessions/actions";
import { demoOrganization, demoUser, emptyDashboard } from "../demo-fixtures";
import { runAtom, teamRunIdsAtom, teamRunsAtom } from "../entities/runs";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { demoMode as platformDemoMode } from "../platform";
import { planningProjectsAtom } from "../planning/atoms";
import { useRegistry, type AtomRegistry } from "../registry";
import {
  clearRunDetail,
  issueMessagesAtom,
  runEventsAtom,
} from "../run-detail/atoms";
import { sessionErrorAtom, tokenAtom, userAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { getTeamSyncLoader } from "../sync/loader";
import { applyRunPatch, applyRunPatches } from "../sync/optimistic";
import { getTeamActions } from "../team/actions";
import {
  activeTeamIdAtom,
  loadedTeamIdAtom,
  renderedTeamSettingsAtom,
  teamsAtom,
} from "../team/atoms";
import {
  beginIssueMutation,
  pendingIssueMutationAtom,
  recoveryErrorAtom,
} from "./atoms";

/*
  Every user triggered write to an issue or a run.

  These were twenty five `useCallback`s in `useBriar`, each rebuilding a whole
  `DashboardPayload` through `setDashboard` and each listing `dashboard` in its
  dependency array — so every polling tick rebuilt all of them. They now read
  the store through the registry at call time and write through
  `applySyncEvent`, which makes their identity stable for the lifetime of the
  registry and confines a one run edit to that run's subscribers.

  What did not change is the shape of each flow: which guard throws which
  message, whether the server or the local patch goes first, and what demo mode
  substitutes for the server.
*/

/** Remote writes the issue and run actions perform. */
export interface IssueActionApi {
  readonly acceptIssueActionProposal: typeof acceptRemoteIssueActionProposal;
  readonly acceptIssueExecutionProposal: typeof acceptRemoteIssueExecutionProposal;
  readonly acceptIssueReworkProposal: typeof acceptRemoteIssueReworkProposal;
  readonly acceptIssueSkillExecutionProposal: typeof acceptRemoteIssueSkillExecutionProposal;
  readonly addIssueDependency: typeof addRemoteIssueDependency;
  readonly addRelatedIssue: typeof addRemoteRelatedIssue;
  readonly cancelHuntRun: typeof cancelHuntRun;
  readonly completeIssueResultReview: typeof completeRemoteIssueResultReview;
  readonly createIssue: typeof createRemoteIssue;
  readonly deleteIssue: typeof deleteRemoteIssue;
  readonly loadIssueAttachment: typeof loadIssueAttachment;
  readonly moveHuntRun: typeof moveHuntRun;
  readonly moveIssueToPlanningProject: typeof moveRemoteIssueToPlanningProject;
  readonly removeIssueDependency: typeof removeRemoteIssueDependency;
  readonly removeIssueParent: typeof removeRemoteIssueParent;
  readonly removeRelatedIssue: typeof removeRemoteRelatedIssue;
  readonly resumeHuntRun: typeof resumeHuntRun;
  readonly retryHuntRun: typeof retryHuntRun;
  readonly reworkPausedHuntRun: typeof reworkPausedHuntRun;
  readonly setIssueParent: typeof setRemoteIssueParent;
  readonly transferIssue: typeof transferRemoteIssue;
  readonly unassignHuntRun: typeof unassignHuntRun;
  readonly updateIssue: typeof updateRemoteIssue;
  readonly updateIssueCheckpoints: typeof updateRemoteIssueCheckpoints;
  readonly updateIssueExecutionPreferences: typeof updateRemoteIssueExecutionPreferences;
  readonly updateIssueSubscription: typeof updateRemoteIssueSubscription;
}

export const liveIssueActionApi: IssueActionApi = {
  acceptIssueActionProposal: acceptRemoteIssueActionProposal,
  acceptIssueExecutionProposal: acceptRemoteIssueExecutionProposal,
  acceptIssueReworkProposal: acceptRemoteIssueReworkProposal,
  acceptIssueSkillExecutionProposal: acceptRemoteIssueSkillExecutionProposal,
  addIssueDependency: addRemoteIssueDependency,
  addRelatedIssue: addRemoteRelatedIssue,
  cancelHuntRun,
  completeIssueResultReview: completeRemoteIssueResultReview,
  createIssue: createRemoteIssue,
  deleteIssue: deleteRemoteIssue,
  loadIssueAttachment,
  moveHuntRun,
  moveIssueToPlanningProject: moveRemoteIssueToPlanningProject,
  removeIssueDependency: removeRemoteIssueDependency,
  removeIssueParent: removeRemoteIssueParent,
  removeRelatedIssue: removeRemoteRelatedIssue,
  resumeHuntRun,
  retryHuntRun,
  reworkPausedHuntRun,
  setIssueParent: setRemoteIssueParent,
  transferIssue: transferRemoteIssue,
  unassignHuntRun,
  updateIssue: updateRemoteIssue,
  updateIssueCheckpoints: updateRemoteIssueCheckpoints,
  updateIssueExecutionPreferences: updateRemoteIssueExecutionPreferences,
  updateIssueSubscription: updateRemoteIssueSubscription,
};

export interface IssueActionDeps {
  readonly api?: Partial<IssueActionApi> | undefined;
  /**
   * Overrides the platform's demo flag. It is a build-time constant that is
   * always off under the test runner, so the demo branches would otherwise be
   * unreachable from a test.
   */
  readonly demoMode?: boolean | undefined;
}

/** The four fields a run carries about another run it is linked to. */
const issueReference = (run: HuntRun): IssueDependencyReference => ({
  id: run.id,
  runNumber: run.runNumber,
  title: run.title,
  status: run.status,
});

/**
 * Drops every link to `removedRunId` from a run, returning the run unchanged
 * when it had none. Deleting or transferring an issue leaves dangling
 * references behind otherwise, and the unchanged case is what keeps the other
 * rows of the board from re-rendering.
 */
const withoutLinksTo = (removedRunId: string) => (run: HuntRun): HuntRun => {
  const prerequisites = run.prerequisites ?? [];
  const dependents = run.dependents ?? [];
  const subIssues = run.subIssues ?? [];
  const relatedIssues = run.relatedIssues ?? [];
  const links = (candidates: readonly IssueDependencyReference[]) =>
    candidates.filter((candidate) => candidate.id !== removedRunId);
  const nextPrerequisites = links(prerequisites);
  const nextDependents = links(dependents);
  const nextSubIssues = links(subIssues);
  const nextRelatedIssues = links(relatedIssues);
  const orphaned = run.parent?.id === removedRunId;
  if (
    !orphaned &&
    nextPrerequisites.length === prerequisites.length &&
    nextDependents.length === dependents.length &&
    nextSubIssues.length === subIssues.length &&
    nextRelatedIssues.length === relatedIssues.length
  ) {
    return run;
  }
  return {
    ...run,
    prerequisites: nextPrerequisites,
    dependents: nextDependents,
    parent: orphaned ? null : run.parent,
    subIssues: nextSubIssues,
    relatedIssues: nextRelatedIssues,
  };
};

/**
 * Every issue and run write, bound to one registry. The shape is inferred from
 * the object below so each action keeps the exact result type its `useBriar`
 * callback had, demo branch included.
 */
export type IssueActions = ReturnType<typeof createIssueActions>;

export function createIssueActions(
  registry: AtomRegistry,
  deps: IssueActionDeps = {},
) {
  const api: IssueActionApi = { ...liveIssueActionApi, ...deps.api };
  const demoMode = deps.demoMode ?? platformDemoMode;
  const loader = getTeamSyncLoader(registry);
  /*
    Idempotency keys for the two writes the server deduplicates: a resume or a
    rework retried after a network failure must not queue the work twice. They
    were refs on the hook and are module state of the factory now, which is the
    same lifetime — one per registry.
  */
  const resumeRequestIds = new Map<string, string>();
  const reworkRequestIds = new Map<string, string>();

  const agentSessions = createAgentSessionActions(registry);
  const setError = (error: string | null) =>
    registry.set(sessionErrorAtom, error);
  const messageOf = (caught: unknown) =>
    caught instanceof Error ? caught.message : String(caught);
  const refresh = (mode: "delta" | "snapshot" = "snapshot") =>
    loader.refresh(registry.get(activeTeamIdAtom), mode);

  const requireToken = () => {
    const token = registry.get(tokenAtom);
    if (!token) throw new Error("로그인이 필요합니다.");
    return token;
  };

  const teamRunIds = (teamId: string) =>
    registry.get(teamRunIdsAtom(teamId)) ?? [];

  /**
   * One run of the board on screen, or `null` when that board does not list it.
   * The store is organization wide, so the membership check is what keeps these
   * actions reading the same list the `dashboard.runs.find` they replaced did.
   */
  const boardRun = (teamId: string, runId: string): HuntRun | null =>
    teamRunIds(teamId).includes(runId) ? registry.get(runAtom(runId)) : null;

  /**
   * The selected team, when its board is the one on screen — the
   * `!activeProjectId || !dashboard` guard every one of these actions opened
   * with — together with a lookup into that board's runs.
   */
  const requireBoard = (message: string) => {
    const teamId = registry.get(loadedTeamIdAtom);
    if (teamId === null) throw new Error(message);
    return {
      teamId,
      boardRun: (runId: string) => boardRun(teamId, runId),
    };
  };

  /** Prepends one locally generated event to a run's loaded history. */
  const recordRunEvent = (runId: string, event: HuntEvent) => {
    registry.update(runEventsAtom(runId), (events) => [event, ...events]);
  };

  return {
    async addIssue(projectId: string, input: CreateIssueInput) {
      if (registry.get(pendingIssueMutationAtom)?.kind === "creating") {
        throw new Error("이슈 생성이 이미 진행 중입니다.");
      }
      const planningProjects = registry.get(planningProjectsAtom);
      const planningProject = planningProjects.find(
        (candidate) => candidate.id === projectId,
      );
      const teamId = planningProject?.teamId ?? projectId;
      const project = registry
        .get(teamsAtom)
        .find((candidate) => candidate.id === teamId);
      if (!project || (!demoMode && !planningProject)) {
        throw new Error("이슈를 추가할 프로젝트가 없습니다.");
      }
      const clientIssueId =
        input.clientIssueId ?? crypto.randomUUID().toLowerCase();
      const endMutation = beginIssueMutation(registry, { kind: "creating" });
      setError(null);
      try {
        if (demoMode) {
          // The board the new issue lands on, when it is the one on screen:
          // its settings decide the workflow and repository the run inherits,
          // and its runs decide the next issue number. A team that is not on
          // screen starts from an empty board instead.
          const onActiveBoard = registry.get(loadedTeamIdAtom) === teamId;
          const emptyBoard = emptyDashboard(project);
          const baseSettings =
            registry.get(renderedTeamSettingsAtom(teamId)) ??
            emptyBoard.settings;
          const baseRuns =
            (onActiveBoard ? registry.get(teamRunsAtom(teamId)) : null) ?? [];
          const occurredAt = new Date().toISOString();
          const issueId = crypto.randomUUID();
          const sourceKey = `briar-issue:${issueId}`;
          const attachments: IssueAttachment[] = input.attachments.map(
            (file) => ({
              id: crypto.randomUUID(),
              filename: file.name,
              contentType: file.type,
              byteSize: file.size,
              url: URL.createObjectURL(file),
            }),
          );
          const issueDescription = canonicalizeIssueAttachmentReferences(
            input.description,
            input.attachmentReferences ?? [],
            attachments.map((attachment) => attachment.id),
          );
          const detail =
            input.status === "backlog"
              ? "Briar 앱에서 생성된 이슈가 백로그에 추가되었습니다."
              : "Briar 앱에서 생성된 이슈가 처리를 기다리고 있습니다.";
          const initialEvent: HuntEvent = {
            id: crypto.randomUUID(),
            attempt: 1,
            revision: 1,
            status: input.status,
            workflowStage: null,
            detail,
            actor: "briar-app",
            qaStatus: null,
            trackerState: null,
            pullRequestUrls: [],
            targetSha: null,
            occurredAt,
            recordedAt: occurredAt,
          };
          const baseWorkflow = baseSettings.checkpointPolicy
            ? {
                ...baseSettings.workflow,
                execution: {
                  checkpoints: baseSettings.checkpointPolicy.effective,
                },
              }
            : baseSettings.workflow;
          const user = registry.get(userAtom);
          const run: HuntRun = {
            id: crypto.randomUUID(),
            workspaceId: project.organizationId ?? demoOrganization.id,
            teamId,
            projectId,
            projectName: planningProject?.name ?? null,
            runNumber:
              Math.max(
                0,
                ...baseRuns.map((candidate) => candidate.runNumber),
              ) + 1,
            currentAttempt: 1,
            currentRevision: 1,
            source: "issue",
            sourceKey,
            title: input.title.trim(),
            status: input.status,
            workflowStage: null,
            workflow: input.fullAuto
              ? { ...baseWorkflow, execution: { checkpoints: [] } }
              : workflowWithAdditionalCheckpoints(
                  baseWorkflow,
                  input.checkpoints ?? [],
                ),
            issueCheckpoints: input.fullAuto ? [] : (input.checkpoints ?? []),
            fullAuto: input.fullAuto ?? false,
            progress: input.status === "backlog" ? 0 : 5,
            detail,
            priority: input.priority,
            difficulty: input.difficulty,
            assigneeUserId:
              input.assigneeUserId === undefined
                ? (user?.id ?? null)
                : input.assigneeUserId,
            subscribers: [{ userId: demoUser.id, subscribedAt: occurredAt }],
            preferredProvider: input.preferredProvider ?? null,
            preferredModel: input.preferredModel ?? null,
            preferredEffort: input.preferredEffort ?? null,
            repository: baseSettings.githubRepository ?? project.name,
            branch: null,
            commitSha: null,
            tracker: null,
            issueDescription,
            attachments,
            resultSummary: null,
            structuredResult: null,
            pullRequestUrls: [],
            targetSha: null,
            sourceCreatedAt: occurredAt,
            stagingQaStatus: null,
            productionQaStatus: null,
            stagingQaDetail: null,
            productionQaDetail: null,
            context: {
              origin: "briar-app",
              issueId,
              attachmentCount: attachments.length,
              fullAuto: input.fullAuto ?? false,
            },
            claimedBy: null,
            claimedAt: null,
            leaseExpiresAt: null,
            claimAttempts: 0,
            startedAt: occurredAt,
            updatedAt: occurredAt,
            completedAt: null,
            lastEventAt: occurredAt,
            eventCount: 1,
          };
          Atom.batch(() => {
            registry.set(runEventsAtom(run.id), [initialEvent]);
            registry.set(activeTeamIdAtom, teamId);
            registry.set(activeOrganizationIdAtom, project.organizationId);
            if (onActiveBoard) {
              applySyncEvent(registry, { kind: "run-changed", run, teamId });
            } else {
              applySyncEvent(registry, {
                kind: "team-snapshot",
                teamId,
                payload: { ...emptyBoard, runs: [run] },
              });
            }
          });
          return {
            runId: run.id,
            sourceKey,
            stage: "queued" as const,
            status: input.status,
          };
        }
        const token = requireToken();
        if (!planningProject) {
          throw new Error("이슈를 추가할 프로젝트가 없습니다.");
        }
        const result = await api.createIssue(
          token,
          { teamId, planningProjectId: planningProject.id },
          { ...input, clientIssueId },
        );
        if (teamId === registry.get(activeTeamIdAtom)) {
          await refresh();
        } else {
          getTeamActions(registry).selectTeam(teamId);
        }
        return result;
      } catch (caught) {
        setError(messageOf(caught));
        throw caught;
      } finally {
        endMutation();
      }
    },

    async moveIssueProject(
      runId: string,
      sourceProjectId: string,
      targetProjectId: string,
    ) {
      const { teamId } = requireBoard("이슈를 이동할 팀이 없습니다.");
      const target = registry
        .get(planningProjectsAtom)
        .find((project) => project.id === targetProjectId);
      if (!target || target.teamId !== teamId) {
        throw new Error("같은 팀의 프로젝트로만 이슈를 이동할 수 있습니다.");
      }
      setError(null);
      try {
        if (demoMode) {
          applyRunPatch(registry, runId, (run) => ({
            ...run,
            projectId: target.id,
            projectName: target.name,
            updatedAt: new Date().toISOString(),
          }));
          return { outcome: "moved" as const };
        }
        const token = requireToken();
        const result = await api.moveIssueToPlanningProject(
          token,
          sourceProjectId,
          runId,
          targetProjectId,
        );
        await refresh();
        return result;
      } catch (caught) {
        setError(messageOf(caught));
        throw caught;
      }
    },

    async readIssueAttachment(attachment: IssueAttachment) {
      const token = registry.get(tokenAtom);
      if (!token && !attachment.url.startsWith("blob:")) {
        throw new Error("첨부 파일을 열려면 로그인이 필요합니다.");
      }
      return api.loadIssueAttachment(token ?? "", attachment);
    },

    async editIssue(runId: string, input: UpdateIssueInput) {
      const { teamId, boardRun } = requireBoard(
        "이슈를 수정할 프로젝트가 없습니다.",
      );
      const endMutation = beginIssueMutation(registry, {
        kind: "updating",
        runId,
      });
      setError(null);
      try {
        if (demoMode) {
          const updatedAt = new Date().toISOString();
          const addedAttachments: IssueAttachment[] = input.attachments.map(
            (file) => ({
              id: crypto.randomUUID(),
              filename: file.name,
              contentType: file.type,
              byteSize: file.size,
              url: URL.createObjectURL(file),
            }),
          );
          const canonicalDescription = canonicalizeIssueAttachmentReferences(
            input.description,
            input.attachmentReferences ?? [],
            addedAttachments.map((attachment) => attachment.id),
          );
          const keptOf = (attachments: readonly IssueAttachment[]) =>
            input.keptAttachmentIds
              ? attachments.filter((attachment) =>
                  input.keptAttachmentIds?.includes(attachment.id),
                )
              : attachments;
          applyRunPatch(registry, runId, (run) => ({
            ...run,
            title: input.title.trim(),
            issueDescription: canonicalDescription,
            priority: input.priority,
            difficulty: input.difficulty,
            assigneeUserId:
              input.assigneeUserId === undefined
                ? (run.assigneeUserId ?? null)
                : input.assigneeUserId,
            attachments: [...keptOf(run.attachments), ...addedAttachments],
            updatedAt,
          }));
          return {
            runId,
            title: input.title.trim(),
            description: canonicalDescription,
            priority: input.priority,
            difficulty: input.difficulty,
            assigneeUserId: input.assigneeUserId ?? null,
            attachments: [
              ...keptOf(
                boardRun(runId)?.attachments ??
                  [],
              ),
              ...addedAttachments,
            ],
          };
        }
        const token = requireToken();
        const result = await api.updateIssue(token, teamId, runId, input);
        await refresh();
        return result;
      } catch (caught) {
        setError(messageOf(caught));
        throw caught;
      } finally {
        endMutation();
      }
    },

    async editIssueSubscription(runId: string, subscribed: boolean) {
      const { teamId, boardRun } = requireBoard(
        "이슈 구독을 변경할 수 없습니다.",
      );
      const user = registry.get(userAtom);
      if (!user) throw new Error("이슈 구독을 변경할 수 없습니다.");
      setError(null);
      try {
        if (demoMode) {
          const run = boardRun(runId);
          if (!subscribed && run?.assigneeUserId === user.id) {
            throw new Error("담당자는 이슈 구독을 해제할 수 없습니다.");
          }
          const existing = run?.subscribers ?? [];
          const subscribers = subscribed
            ? existing.some((subscriber) => subscriber.userId === user.id)
              ? existing
              : [
                  ...existing,
                  { userId: user.id, subscribedAt: new Date().toISOString() },
                ]
            : existing.filter((subscriber) => subscriber.userId !== user.id);
          applyRunPatch(registry, runId, (candidate) => ({
            ...candidate,
            subscribers,
          }));
          return { runId, subscribers };
        }
        const token = requireToken();
        const result = await api.updateIssueSubscription(
          token,
          teamId,
          runId,
          subscribed,
        );
        applyRunPatch(registry, runId, (run) => ({
          ...run,
          subscribers: result.subscribers,
        }));
        return result;
      } catch (caught) {
        setError(messageOf(caught));
        throw caught;
      }
    },

    async editIssueExecutionPreferences(
      runId: string,
      input: IssueExecutionPreferences,
    ) {
      const { teamId } = requireBoard("이슈를 수정할 프로젝트가 없습니다.");
      const endMutation = beginIssueMutation(registry, {
        kind: "updating",
        runId,
      });
      setError(null);
      try {
        if (demoMode) {
          applyRunPatch(registry, runId, (run) => ({
            ...run,
            preferredProvider: input.provider,
            preferredModel: input.model,
            preferredEffort: input.effort,
            updatedAt: new Date().toISOString(),
          }));
          return { runId, ...input };
        }
        const token = requireToken();
        const result = await api.updateIssueExecutionPreferences(
          token,
          teamId,
          runId,
          input,
        );
        await refresh();
        return result;
      } catch (caught) {
        setError(messageOf(caught));
        throw caught;
      } finally {
        endMutation();
      }
    },

    async editIssueCheckpoints(
      runId: string,
      checkpoints: AutoHuntWorkflowCheckpoint[],
    ) {
      const { teamId } = requireBoard("이슈를 수정할 프로젝트가 없습니다.");
      const endMutation = beginIssueMutation(registry, {
        kind: "updating",
        runId,
      });
      setError(null);
      try {
        if (demoMode) {
          const updatedAt = new Date().toISOString();
          applyRunPatch(registry, runId, (run) => {
            const previousBoundaries = new Set(
              (run.issueCheckpoints ?? []).map(
                (checkpoint) => `${checkpoint.stage}:${checkpoint.position}`,
              ),
            );
            const baseWorkflow = {
              ...run.workflow,
              execution: {
                checkpoints: run.workflow.execution.checkpoints.filter(
                  (checkpoint) =>
                    !previousBoundaries.has(
                      `${checkpoint.stage}:${checkpoint.position}`,
                    ),
                ),
              },
            };
            return {
              ...run,
              workflow: workflowWithAdditionalCheckpoints(
                baseWorkflow,
                checkpoints,
              ),
              issueCheckpoints: checkpoints,
              updatedAt,
            };
          });
          return { runId, checkpoints };
        }
        const token = requireToken();
        const result = await api.updateIssueCheckpoints(
          token,
          teamId,
          runId,
          checkpoints,
        );
        await refresh();
        return result;
      } catch (caught) {
        setError(messageOf(caught));
        throw caught;
      } finally {
        endMutation();
      }
    },

    async completeResultReview(runId: string): Promise<IssueResultReview> {
      const { teamId, boardRun } = requireBoard(
        "검수를 기록할 이슈 또는 로그인 정보가 없습니다.",
      );
      const user = registry.get(userAtom);
      if (!user) {
        throw new Error("검수를 기록할 이슈 또는 로그인 정보가 없습니다.");
      }
      setError(null);
      try {
        const existing = boardRun(runId)?.resultReviews?.find(
          (review) => review.userId === user.id,
        );
        let review = existing;
        if (!review) {
          if (demoMode) {
            review = {
              userId: user.id,
              name: user.name,
              username: user.username ?? null,
              image: user.image ?? null,
              completedAt: new Date().toISOString(),
            };
          } else {
            const token = requireToken();
            review = await api.completeIssueResultReview(token, teamId, runId);
          }
        }
        const completed = review;
        applyRunPatch(registry, runId, (run) =>
          (run.resultReviews ?? []).some(
            (candidate) => candidate.userId === completed.userId,
          )
            ? run
            : {
                ...run,
                resultReviews: [...(run.resultReviews ?? []), completed],
              },
        );
        return completed;
      } catch (caught) {
        setError(messageOf(caught));
        throw caught;
      }
    },

    async changeIssueDependency(
      dependentRunId: string,
      prerequisiteRunId: string,
      action: "add" | "remove",
    ) {
      const { teamId, boardRun } = requireBoard(
        "의존성을 수정할 프로젝트가 없습니다.",
      );
      const endMutation = beginIssueMutation(registry, {
        kind: "updating",
        runId: dependentRunId,
      });
      setError(null);
      try {
        if (demoMode) {
          const prerequisite = boardRun(prerequisiteRunId);
          const dependent = boardRun(dependentRunId);
          if (!prerequisite || !dependent) return;
          Atom.batch(() => {
            applyRunPatch(registry, dependentRunId, (run) => ({
              ...run,
              prerequisites:
                action === "add"
                  ? [
                      ...(run.prerequisites ?? []).filter(
                        (candidate) => candidate.id !== prerequisiteRunId,
                      ),
                      issueReference(prerequisite),
                    ]
                  : (run.prerequisites ?? []).filter(
                      (candidate) => candidate.id !== prerequisiteRunId,
                    ),
            }));
            applyRunPatch(registry, prerequisiteRunId, (run) => ({
              ...run,
              dependents:
                action === "add"
                  ? [
                      ...(run.dependents ?? []).filter(
                        (candidate) => candidate.id !== dependentRunId,
                      ),
                      issueReference(dependent),
                    ]
                  : (run.dependents ?? []).filter(
                      (candidate) => candidate.id !== dependentRunId,
                    ),
            }));
          });
          return;
        }
        const token = requireToken();
        if (action === "add") {
          await api.addIssueDependency(
            token,
            teamId,
            dependentRunId,
            prerequisiteRunId,
          );
        } else {
          await api.removeIssueDependency(
            token,
            teamId,
            dependentRunId,
            prerequisiteRunId,
          );
        }
        await refresh();
      } catch (caught) {
        setError(messageOf(caught));
        throw caught;
      } finally {
        endMutation();
      }
    },

    async changeIssueParent(childRunId: string, parentRunId: string | null) {
      const { teamId, boardRun } = requireBoard(
        "계층을 수정할 프로젝트가 없습니다.",
      );
      const endMutation = beginIssueMutation(registry, {
        kind: "updating",
        runId: childRunId,
      });
      setError(null);
      try {
        if (!demoMode) {
          const token = requireToken();
          if (parentRunId) {
            await api.setIssueParent(token, teamId, childRunId, parentRunId);
          } else {
            await api.removeIssueParent(token, teamId, childRunId);
          }
          await refresh();
          return;
        }
        const child = boardRun(childRunId);
        const parent = parentRunId
          ? boardRun(parentRunId)
          : null;
        if (!child || (parentRunId && !parent)) return;
        applyRunPatches(registry, teamRunIds(teamId), (run) => {
          if (run.id === childRunId) {
            return { ...run, parent: parent ? issueReference(parent) : null };
          }
          const withoutChild = (run.subIssues ?? []).filter(
            (candidate) => candidate.id !== childRunId,
          );
          if (run.id === parentRunId) {
            return {
              ...run,
              subIssues: [...withoutChild, issueReference(child)],
            };
          }
          return withoutChild.length === (run.subIssues ?? []).length
            ? run
            : { ...run, subIssues: withoutChild };
        });
      } catch (caught) {
        setError(messageOf(caught));
        throw caught;
      } finally {
        endMutation();
      }
    },

    async changeRelatedIssue(
      runId: string,
      relatedRunId: string,
      action: "add" | "remove",
    ) {
      const { teamId, boardRun } = requireBoard(
        "관련 이슈를 수정할 프로젝트가 없습니다.",
      );
      const endMutation = beginIssueMutation(registry, {
        kind: "updating",
        runId,
      });
      setError(null);
      try {
        if (!demoMode) {
          const token = requireToken();
          if (action === "add") {
            await api.addRelatedIssue(token, teamId, runId, relatedRunId);
          } else {
            await api.removeRelatedIssue(token, teamId, runId, relatedRunId);
          }
          await refresh();
          return;
        }
        const left = boardRun(runId);
        const right = boardRun(relatedRunId);
        if (!left || !right) return;
        applyRunPatches(registry, [runId, relatedRunId], (run) => {
          const other = run.id === runId ? right : left;
          const remaining = (run.relatedIssues ?? []).filter(
            (candidate) => candidate.id !== other.id,
          );
          return {
            ...run,
            relatedIssues:
              action === "add"
                ? [...remaining, issueReference(other)]
                : remaining,
          };
        });
      } catch (caught) {
        setError(messageOf(caught));
        throw caught;
      } finally {
        endMutation();
      }
    },

    async removeIssue(runId: string) {
      const { teamId } = requireBoard("이슈를 삭제할 프로젝트가 없습니다.");
      const endMutation = beginIssueMutation(registry, {
        kind: "deleting",
        runId,
      });
      setError(null);
      try {
        if (!demoMode) {
          const token = requireToken();
          await api.deleteIssue(token, teamId, runId);
        }
        Atom.batch(() => {
          applyRunPatches(
            registry,
            teamRunIds(teamId).filter((candidate) => candidate !== runId),
            withoutLinksTo(runId),
          );
          applySyncEvent(registry, { kind: "run-deleted", teamId, runId });
          clearRunDetail(registry, runId);
        });
      } catch (caught) {
        setError(messageOf(caught));
        throw caught;
      } finally {
        endMutation();
      }
    },

    async transferIssue(runId: string, targetProjectId: string) {
      const { teamId } = requireBoard("이슈를 옮길 프로젝트가 없습니다.");
      if (targetProjectId === teamId) {
        throw new Error("같은 프로젝트로는 옮길 수 없습니다.");
      }
      const endMutation = beginIssueMutation(registry, {
        kind: "deleting",
        runId,
      });
      setError(null);
      try {
        if (!demoMode) {
          const token = requireToken();
          await api.transferIssue(token, teamId, runId, targetProjectId);
        }
        Atom.batch(() => {
          applyRunPatches(
            registry,
            teamRunIds(teamId).filter((candidate) => candidate !== runId),
            withoutLinksTo(runId),
          );
          applySyncEvent(registry, { kind: "run-deleted", teamId, runId });
          clearRunDetail(registry, runId);
        });
      } catch (caught) {
        setError(messageOf(caught));
        throw caught;
      } finally {
        endMutation();
      }
    },

    async acceptConversationIssueAction(
      runId: string,
      proposal: IssueProposedAction,
    ) {
      const { teamId } = requireBoard("변경할 이슈 처리 작업이 없습니다.");
      if (demoMode) {
        throw new Error("데모에서는 이슈 변경 제안을 수락할 수 없습니다.");
      }
      const token = requireToken();
      const result =
        proposal.type === "request_issue_rework"
          ? await api.acceptIssueReworkProposal(
              token,
              teamId,
              runId,
              proposal.id,
            )
          : await api.acceptIssueActionProposal(
              token,
              teamId,
              runId,
              proposal.id,
            );
      const materializedExecutionProposal =
        "executionProposal" in result ? result.executionProposal : null;
      registry.update(issueMessagesAtom(runId), (messages) =>
        messages.map((message) =>
          message.proposedAction?.id === proposal.id
            ? {
                ...message,
                proposedAction: result.proposal,
                executionProposal:
                  materializedExecutionProposal ?? message.executionProposal,
              }
            : message,
        ),
      );
      await refresh();
      return result.proposal;
    },

    async acceptConversationIssueExecution(
      runId: string,
      proposal: IssueExecutionProposal,
      input: IssueExecutionApprovalInput,
    ) {
      const { teamId } = requireBoard("실행할 이슈 처리 작업이 없습니다.");
      if (demoMode) {
        throw new Error("데모에서는 이슈 실행을 승인할 수 없습니다.");
      }
      const token = requireToken();
      const result = await api.acceptIssueExecutionProposal(
        token,
        teamId,
        runId,
        proposal.id,
        input,
      );
      registry.update(issueMessagesAtom(runId), (messages) =>
        messages.map((message) =>
          message.executionProposal?.id === proposal.id
            ? { ...message, executionProposal: result.proposal }
            : message,
        ),
      );
      await refresh();
      return result.proposal;
    },

    async acceptConversationSkillExecution(
      runId: string,
      proposal: AgentSkillExecutionProposal,
      input: AgentSkillExecutionApprovalInput,
    ) {
      const { teamId } = requireBoard("실행할 프로젝트 Agent Skill이 없습니다.");
      if (demoMode) {
        throw new Error("데모에서는 Agent Skill 실행을 승인할 수 없습니다.");
      }
      const token = requireToken();
      const result = await api.acceptIssueSkillExecutionProposal(
        token,
        teamId,
        runId,
        proposal,
        input,
      );
      // The session the server started for the approved skill, taken in so the
      // agent views list it without waiting for the next sync page.
      if (result.session) agentSessions.adoptRemoteSession(result.session);
      registry.update(issueMessagesAtom(runId), (messages) =>
        messages.map((message) =>
          message.skillExecutionProposal?.id === proposal.id
            ? { ...message, skillExecutionProposal: result.proposal }
            : message,
        ),
      );
      await refresh();
      return result.proposal;
    },

    async recoverRun(runId: string, action: "retry" | "cancel") {
      const { teamId } = requireBoard("복구할 이슈 처리 작업이 없습니다.");
      const endMutation = beginIssueMutation(registry, {
        kind: "recovering",
        runId,
      });
      registry.set(recoveryErrorAtom, null);
      try {
        if (demoMode) {
          const occurredAt = new Date().toISOString();
          Atom.batch(() => {
            applyRunPatch(registry, runId, (run) => {
              const attempt =
                action === "retry" ? run.currentAttempt + 1 : run.currentAttempt;
              const status = action === "retry" ? "queued" : "cancelled";
              const detail =
                action === "retry"
                  ? `이슈 처리 ${attempt}차 시도를 요청했습니다.`
                  : "사용자가 이슈 처리 작업을 취소했습니다.";
              recordRunEvent(run.id, {
                id: crypto.randomUUID(),
                attempt,
                revision: action === "retry" ? 1 : run.currentRevision,
                status,
                workflowStage: action === "retry" ? null : run.workflowStage,
                detail,
                actor: "briar-app",
                qaStatus: null,
                trackerState: run.tracker?.state ?? null,
                pullRequestUrls: [],
                targetSha: null,
                occurredAt,
                recordedAt: occurredAt,
              });
              return {
                ...run,
                currentAttempt: attempt,
                currentRevision: action === "retry" ? 1 : run.currentRevision,
                status,
                workflowStage: action === "retry" ? null : run.workflowStage,
                progress: action === "retry" ? 5 : run.progress,
                detail,
                branch: action === "retry" ? null : run.branch,
                commitSha: action === "retry" ? null : run.commitSha,
                claimedBy: null,
                claimedAt: null,
                leaseExpiresAt: null,
                completedAt: action === "cancel" ? occurredAt : null,
                updatedAt: occurredAt,
                lastEventAt: occurredAt,
                eventCount: run.eventCount + 1,
              };
            });
          });
          return;
        }
        const token = requireToken();
        if (action === "retry") {
          await api.retryHuntRun(token, teamId, runId);
        } else {
          await api.cancelHuntRun(token, teamId, runId);
        }
        await refresh();
      } catch (caught) {
        registry.set(recoveryErrorAtom, messageOf(caught));
        throw caught;
      } finally {
        endMutation();
      }
    },

    async resumeRun(runId: string) {
      const { teamId, boardRun } = requireBoard(
        "재개할 이슈 처리 작업이 없습니다.",
      );
      const endMutation = beginIssueMutation(registry, {
        kind: "recovering",
        runId,
      });
      registry.set(recoveryErrorAtom, null);
      try {
        if (demoMode) {
          const occurredAt = new Date().toISOString();
          applyRunPatch(registry, runId, (run) => {
            const currentIndex = run.workflow.stages.findIndex(
              (stage) => stage.id === run.workflowStage,
            );
            const workflowStage =
              run.workflow.stages[currentIndex + 1]?.id ?? run.workflowStage;
            const status = "running";
            const detail = "사용자가 일시정지된 워크플로우를 재개했습니다.";
            recordRunEvent(run.id, {
              id: crypto.randomUUID(),
              attempt: run.currentAttempt,
              revision: run.currentRevision,
              status,
              workflowStage,
              detail,
              actor: "briar-app",
              qaStatus: null,
              trackerState: run.tracker?.state ?? null,
              pullRequestUrls: run.pullRequestUrls,
              targetSha: run.targetSha,
              occurredAt,
              recordedAt: occurredAt,
            });
            return {
              ...run,
              status,
              workflowStage,
              pausedAt: null,
              progress: progressForAutoHuntRun(
                status,
                workflowStage,
                run.workflow,
              ),
              detail,
              claimedBy: null,
              claimedAt: null,
              leaseExpiresAt: null,
              completedAt: null,
              updatedAt: occurredAt,
              lastEventAt: occurredAt,
              eventCount: run.eventCount + 1,
            };
          });
          return;
        }
        const token = requireToken();
        const checkpoint = boardRun(runId)?.checkpoint;
        if (!checkpoint) {
          throw new Error(
            "이 앱 버전에서는 현재 대기 지점을 안전하게 확인할 수 없습니다. 새로고침하거나 앱을 업데이트해 주세요.",
          );
        }
        const identity = `${runId}:${checkpoint.key}:${checkpoint.attempt}:${checkpoint.revision}`;
        const requestId = resumeRequestIds.get(identity) ?? crypto.randomUUID();
        resumeRequestIds.set(identity, requestId);
        try {
          await api.resumeHuntRun(
            token,
            teamId,
            runId,
            {
              key: checkpoint.key,
              attempt: checkpoint.attempt,
              revision: checkpoint.revision,
            },
            requestId,
          );
          resumeRequestIds.delete(identity);
        } catch (caught) {
          if (isApiErrorStatus(caught, 409)) {
            resumeRequestIds.delete(identity);
            await refresh();
            throw new Error(
              "대기 지점이 이미 변경되었습니다. 최신 상태를 다시 불러왔습니다.",
            );
          }
          throw caught;
        }
        await refresh();
      } catch (caught) {
        registry.set(recoveryErrorAtom, messageOf(caught));
        throw caught;
      } finally {
        endMutation();
      }
    },

    async reworkRun(
      runId: string,
      input: { workflowStage: string; reason: string },
    ) {
      const { teamId, boardRun } = requireBoard(
        "재작업할 이슈 처리 작업이 없습니다.",
      );
      const reason = input.reason.trim();
      if (!reason) throw new Error("수정할 내용을 입력해 주세요.");
      const endMutation = beginIssueMutation(registry, {
        kind: "recovering",
        runId,
      });
      registry.set(recoveryErrorAtom, null);
      try {
        const run = boardRun(runId);
        const checkpoint = run?.checkpoint;
        if (!run || !checkpoint) {
          throw new Error(
            "현재 대기 지점을 안전하게 확인할 수 없습니다. 새로고침한 뒤 다시 시도해 주세요.",
          );
        }
        if (demoMode) {
          const occurredAt = new Date().toISOString();
          const nextRevision = run.currentRevision + 1;
          Atom.batch(() => {
            recordRunEvent(run.id, {
              id: crypto.randomUUID(),
              attempt: run.currentAttempt,
              revision: nextRevision,
              status: "queued",
              workflowStage: input.workflowStage,
              detail: reason,
              actor: "briar-app",
              qaStatus: null,
              trackerState: run.tracker?.state ?? null,
              pullRequestUrls: run.pullRequestUrls,
              targetSha: null,
              occurredAt,
              recordedAt: occurredAt,
            });
            applyRunPatch(registry, runId, (candidate) => ({
              ...candidate,
              status: "queued",
              workflowStage: input.workflowStage,
              currentRevision: nextRevision,
              pausedAt: null,
              waitingCheckpoint: null,
              checkpoint: null,
              progress: progressForAutoHuntRun(
                "queued",
                input.workflowStage,
                candidate.workflow,
              ),
              detail: reason,
              resultSummary: null,
              structuredResult: null,
              commitSha: null,
              targetSha: null,
              claimedBy: null,
              claimedAt: null,
              leaseExpiresAt: null,
              updatedAt: occurredAt,
              lastEventAt: occurredAt,
              eventCount: candidate.eventCount + 1,
            }));
          });
          return;
        }
        const token = requireToken();
        const identity = [
          runId,
          checkpoint.key,
          checkpoint.attempt,
          checkpoint.revision,
          input.workflowStage,
          reason,
        ].join(":");
        const requestId = reworkRequestIds.get(identity) ?? crypto.randomUUID();
        reworkRequestIds.set(identity, requestId);
        try {
          await api.reworkPausedHuntRun(
            token,
            teamId,
            runId,
            {
              workflowStage: input.workflowStage,
              reason,
              checkpoint: {
                key: checkpoint.key,
                attempt: checkpoint.attempt,
                revision: checkpoint.revision,
              },
            },
            requestId,
          );
          reworkRequestIds.delete(identity);
        } catch (caught) {
          if (isApiErrorStatus(caught, 409)) {
            reworkRequestIds.delete(identity);
            await refresh();
            throw new Error(
              "대기 지점이 이미 변경되었습니다. 최신 상태를 다시 불러왔습니다.",
            );
          }
          throw caught;
        }
        await refresh();
      } catch (caught) {
        registry.set(recoveryErrorAtom, messageOf(caught));
        throw caught;
      } finally {
        endMutation();
      }
    },

    async moveRun(runId: string, placement: HuntRunPlacement) {
      const { teamId } = requireBoard("이동할 이슈 처리 작업이 없습니다.");
      const endMutation = beginIssueMutation(registry, {
        kind: "recovering",
        runId,
      });
      registry.set(recoveryErrorAtom, null);
      try {
        if (demoMode) {
          const occurredAt = new Date().toISOString();
          applyRunPatch(registry, runId, (run) => {
            const workflowStage =
              placement.status === "backlog" || placement.status === "queued"
                ? null
                : placement.status === "running"
                  ? placement.workflowStage
                  : run.workflowStage;
            const currentAttempt =
              placement.status === "queued"
                ? run.currentAttempt + 1
                : run.currentAttempt;
            const currentStageIndex = run.workflow.stages.findIndex(
              (stage) => stage.id === run.workflowStage,
            );
            const targetStageIndex = run.workflow.stages.findIndex(
              (stage) => stage.id === workflowStage,
            );
            const isRegression =
              placement.status === "running" &&
              currentStageIndex >= 0 &&
              targetStageIndex >= 0 &&
              targetStageIndex < currentStageIndex;
            const currentRevision =
              placement.status === "queued"
                ? 1
                : isRegression
                  ? run.currentRevision + 1
                  : run.currentRevision;
            const targetLabel =
              placement.status === "running"
                ? run.workflow.stages.find(
                    (stage) => stage.id === workflowStage,
                  )?.label
                : {
                    backlog: "백로그",
                    queued: "대기",
                    blocked: "차단",
                    failed: "실패",
                    completed: "완료",
                    cancelled: "취소",
                  }[placement.status];
            const detail = `사용자가 작업을 ${targetLabel ?? placement.status} 상태로 이동했습니다.`;
            recordRunEvent(run.id, {
              id: crypto.randomUUID(),
              attempt: currentAttempt,
              revision: currentRevision,
              status: placement.status,
              workflowStage,
              detail,
              actor: "briar-app",
              qaStatus: null,
              trackerState: run.tracker?.state ?? null,
              pullRequestUrls: run.pullRequestUrls,
              targetSha: run.targetSha,
              occurredAt,
              recordedAt: occurredAt,
            });
            return {
              ...run,
              currentAttempt,
              currentRevision,
              status: placement.status,
              workflowStage,
              progress: progressForAutoHuntRun(
                placement.status,
                workflowStage,
                run.workflow,
              ),
              detail,
              commitSha: isRegression ? null : run.commitSha,
              targetSha: isRegression ? null : run.targetSha,
              resultSummary: isRegression ? null : run.resultSummary,
              claimedBy: null,
              claimedAt: null,
              leaseExpiresAt: null,
              completedAt: ["completed", "cancelled"].includes(placement.status)
                ? occurredAt
                : null,
              updatedAt: occurredAt,
              lastEventAt: occurredAt,
              eventCount: run.eventCount + 1,
            };
          });
          return;
        }
        const token = requireToken();
        await api.moveHuntRun(token, teamId, runId, placement);
        await refresh();
      } catch (caught) {
        registry.set(recoveryErrorAtom, messageOf(caught));
        throw caught;
      } finally {
        endMutation();
      }
    },

    async unassignRun(projectId: string, runId: string) {
      const token = registry.get(tokenAtom);
      if (!token) throw new Error("로그인이 필요합니다.");
      await api.unassignHuntRun(token, projectId, runId);
      await refresh("delta");
    },
  };
}

/**
 * The issue actions bound to the surrounding registry. The identity is stable
 * for the registry's lifetime, so a component may pass one straight to a
 * `React.memo` child without defeating it.
 */
export function useIssueActions(deps: IssueActionDeps = {}): IssueActions {
  const registry = useRegistry();
  const { api, demoMode } = deps;
  return useMemo(
    () => createIssueActions(registry, { api, demoMode }),
    [api, demoMode, registry],
  );
}
