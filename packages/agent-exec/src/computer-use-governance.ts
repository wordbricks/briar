import type {
  ComputerUseArgs,
  ComputerUseResult,
} from "@briar/contracts/gen/agent/v1/computer_use_tool_pb";
import type { ControlledComputerUseExecutor } from "./computer-use-resource";
import {
  summarizeComputerUseActions,
  type ComputerUseActionSummary,
} from "./computer-use-resource";

export type ComputerUsePolicyReview = {
  readonly displayIndex: number;
  readonly summary: ComputerUseActionSummary;
  readonly descriptionProvided: boolean;
};

export type ComputerUsePolicyDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

export interface ComputerUsePolicyBarrier {
  review(input: ComputerUsePolicyReview): Promise<ComputerUsePolicyDecision>;
}

export const unattendedComputerUsePolicyBarrier: ComputerUsePolicyBarrier = {
  review: async () => ({ allowed: true }),
};

export class ComputerUsePolicyBlockedError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "ComputerUsePolicyBlockedError";
  }
}

export type ComputerUseAuditEvent = ComputerUsePolicyReview & {
  readonly durationMs: number;
  readonly outcome: "success" | "action_error" | "executor_error";
  readonly completedActionCount: number | null;
};

export interface ComputerUseAuditSink {
  record(event: ComputerUseAuditEvent): void | Promise<void>;
}

export class GovernedComputerUseExecutor implements ControlledComputerUseExecutor {
  constructor(
    private readonly executor: ControlledComputerUseExecutor,
    private readonly policy: ComputerUsePolicyBarrier =
      unattendedComputerUsePolicyBarrier,
    private readonly audit?: ComputerUseAuditSink,
  ) {}

  async execute(
    args: ComputerUseArgs,
    options: { readonly signal?: AbortSignal; readonly displayIndex?: number },
  ): Promise<ComputerUseResult> {
    const displayIndex = options.displayIndex;
    if (displayIndex === undefined) {
      throw new Error("Computer Use governance requires a display index");
    }
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    const review = {
      displayIndex,
      summary: summarizeComputerUseActions(args.actions),
      descriptionProvided: Boolean(args.description?.trim()),
    };
    const decision = await this.policy.review(review);
    if (!decision.allowed) {
      throw new ComputerUsePolicyBlockedError(decision.reason);
    }
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    const started = performance.now();
    try {
      const result = await this.executor.execute(args, options);
      const resultValue = result.result.value;
      await this.record({
        ...review,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        outcome: result.result.case === "error" ? "action_error" : "success",
        completedActionCount: resultValue?.actionCount ?? null,
      });
      return result;
    } catch (error) {
      await this.record({
        ...review,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        outcome: "executor_error",
        completedActionCount: null,
      });
      throw error;
    }
  }

  private async record(event: ComputerUseAuditEvent): Promise<void> {
    try {
      await this.audit?.record(event);
    } catch {
      // Audit telemetry must not change the action result.
    }
  }
}
