import type { PointerEvent as ReactPointerEvent, Ref } from "react";

import { type AutoHuntWorkflowCheckpoint } from "@/lib/auto-hunt-contract";
import { type AgentProvider } from "@/lib/team-llm";
import type {
  HuntRun,
  HuntRunPlacement,
  IssueExecutionPreferences,
  PlanningProject,
  Project,
} from "@/types";

/*
  What a board row needs besides its own id.

  The board used to build a fresh closure per run per render — forty of them on
  a card — which is what stopped `React.memo` from ever helping. These two
  objects replace that: the handlers take the run they act on, so one identity
  serves every card, and the shared values are memoised once by the board. A
  card whose run did not change therefore sees the same props and does not
  render again, even when its column does. It is the shape `MessageRowHandlers`
  introduced for the channel conversation.
*/

/** Everything a row can ask the board to do, bound to the run it passes back. */
export interface BoardHandlers {
  readonly changeCheckpoints: (
    run: HuntRun,
    checkpoints: AutoHuntWorkflowCheckpoint[],
  ) => void;
  readonly changePreferences: (
    run: HuntRun,
    preferences: IssueExecutionPreferences,
  ) => void;
  readonly changePriority: (run: HuntRun, priority: number | null) => void;
  readonly changeProject?: (run: HuntRun, projectId: string) => void;
  readonly changeTeam?: (run: HuntRun, teamId: string) => void;
  readonly createInColumn: (placement: HuntRunPlacement | null) => void;
  readonly edit: (run: HuntRun) => void;
  readonly move: (run: HuntRun, placement: HuntRunPlacement) => void;
  readonly open: (run: HuntRun) => void;
  /** Opening from the keyboard, which only knows the id it moved to. */
  readonly openById: (runId: string) => void;
  readonly processNow?: (run: HuntRun) => void;
  readonly remove: (run: HuntRun) => void;
  readonly transfer?: (run: HuntRun) => void;
}

/** The pointer drag the kanban owns, bound to the card the event came from. */
export interface BoardPointerHandlers {
  readonly cancel: (run: HuntRun, event: ReactPointerEvent<HTMLElement>) => void;
  readonly down: (run: HuntRun, event: ReactPointerEvent<HTMLElement>) => void;
  readonly move: (run: HuntRun, event: ReactPointerEvent<HTMLElement>) => void;
  readonly up: (run: HuntRun, event: ReactPointerEvent<HTMLElement>) => void;
  /** True once a drop happened, so the click that follows it is swallowed. */
  readonly consumeSuppressedClick: () => boolean;
}

/** The values every card on one board shares. */
export interface BoardCardContext {
  readonly availableProviders: AgentProvider[];
  /**
   * The phone board, whose cards have no context menu, keep their assignment
   * badges on terminal issues and scope the planning projects differently.
   */
  readonly companionMode: boolean;
  readonly cursorRunId: string | null;
  readonly deletingIssueId: string | null;
  readonly draggedRunId: string | null;
  readonly getItemRef: (runId: string) => Ref<HTMLDivElement>;
  readonly handlers: BoardHandlers;
  readonly issueKeyPrefix: string | undefined;
  readonly onCursor: (runId: string) => void;
  readonly planningProjects: Array<Pick<PlanningProject, "id" | "name" | "teamId">>;
  readonly pointer: BoardPointerHandlers;
  readonly processingIssueIds: ReadonlySet<string>;
  readonly recoveringRunId: string | null;
  readonly teamId: string;
  readonly teams: Array<Pick<Project, "id" | "name">>;
  readonly token: string | null;
  readonly updatingIssueId: string | null;
}
