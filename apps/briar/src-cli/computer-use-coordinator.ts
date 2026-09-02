import { randomUUID } from "node:crypto";
import type { ComputerUseChildBinding } from "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";

export type ComputerUseChildState =
  | "starting"
  | "running"
  | "waiting_for_human"
  | "completed"
  | "failed"
  | "stopped";

export type ComputerUseChildSnapshot = {
  readonly childRunId: string;
  readonly parentRunId: string;
  readonly state: ComputerUseChildState;
  readonly task: string;
  readonly conversationId: string | null;
  readonly result: string | null;
  readonly error: string | null;
  readonly startedAt: string;
  readonly updatedAt: string;
};

export type ComputerUseChildTurnResult = {
  readonly conversationId: string | null;
  readonly resultText: string | null;
};

export interface ComputerUseChildTurnRunner {
  run(input: {
    readonly binding: ComputerUseChildBinding;
    readonly prompt: string;
    readonly conversationId: string | null;
    readonly signal: AbortSignal;
    readonly onConversationId: (conversationId: string) => void;
  }): Promise<ComputerUseChildTurnResult>;
}

type ChildCommand = "message" | "stop" | "takeover" | null;

type ChildRecord = {
  binding: ComputerUseChildBinding;
  state: ComputerUseChildState;
  task: string;
  conversationId: string | null;
  result: string | null;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  command: ChildCommand;
  pendingMessages: string[];
  controller: AbortController | null;
};

const activeStates = new Set<ComputerUseChildState>([
  "starting",
  "running",
  "waiting_for_human",
]);

export class ComputerUseChildOccupiedError extends Error {
  constructor(readonly child: ComputerUseChildSnapshot) {
    super(`Computer Use child ${child.childRunId} is already ${child.state}`);
    this.name = "ComputerUseChildOccupiedError";
  }
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class ComputerUseCoordinator {
  private current: ChildRecord | null = null;

  constructor(
    private readonly parentBinding: ComputerUseChildBinding,
    private readonly runner: ComputerUseChildTurnRunner,
    private readonly now: () => Date = () => new Date(),
    private readonly allocateId: () => string = randomUUID,
  ) {}

  start(task: string): ComputerUseChildSnapshot {
    const normalizedTask = task.trim();
    if (!normalizedTask) throw new Error("Computer Use task is required");
    if (this.current && activeStates.has(this.current.state)) {
      throw new ComputerUseChildOccupiedError(this.snapshot(this.current));
    }
    const at = this.now().toISOString();
    const childRunId = this.allocateId();
    const record: ChildRecord = {
      binding: { ...this.parentBinding, childRunId },
      state: "starting",
      task: normalizedTask,
      conversationId: null,
      result: null,
      error: null,
      startedAt: at,
      updatedAt: at,
      command: null,
      pendingMessages: [],
      controller: null,
    };
    this.current = record;
    void this.drive(record, normalizedTask);
    return this.snapshot(record);
  }

  check(): ComputerUseChildSnapshot | null {
    return this.current ? this.snapshot(this.current) : null;
  }

  message(message: string): ComputerUseChildSnapshot {
    const record = this.requireActive();
    const normalizedMessage = message.trim();
    if (!normalizedMessage) throw new Error("Computer Use message is required");
    record.pendingMessages.push(normalizedMessage);
    record.command = "message";
    record.updatedAt = this.now().toISOString();
    if (record.state === "waiting_for_human") {
      record.state = "starting";
      void this.drive(record, this.nextMessagePrompt(record));
    } else {
      record.controller?.abort(new Error("Computer Use child is being steered"));
    }
    return this.snapshot(record);
  }

  stop(): ComputerUseChildSnapshot {
    const record = this.requireActive();
    record.command = "stop";
    record.state = "stopped";
    record.updatedAt = this.now().toISOString();
    record.controller?.abort(new Error("Computer Use child was stopped"));
    return this.snapshot(record);
  }

  requestHumanTakeover(): ComputerUseChildSnapshot {
    const record = this.requireActive();
    record.command = "takeover";
    record.state = "waiting_for_human";
    record.updatedAt = this.now().toISOString();
    record.controller?.abort(
      new Error("Computer Use child paused for human takeover"),
    );
    return this.snapshot(record);
  }

  private requireActive(): ChildRecord {
    if (!this.current || !activeStates.has(this.current.state)) {
      throw new Error("No active Computer Use child");
    }
    return this.current;
  }

  private nextMessagePrompt(record: ChildRecord): string {
    const messages = record.pendingMessages.splice(0);
    record.command = null;
    return [
      "Continue the same desktop task with this new guidance:",
      ...messages.map((message) => `- ${message}`),
    ].join("\n");
  }

  private async drive(record: ChildRecord, initialPrompt: string): Promise<void> {
    let prompt = initialPrompt;
    while (this.current === record && activeStates.has(record.state)) {
      if (record.command === "message") prompt = this.nextMessagePrompt(record);
      record.state = "running";
      record.updatedAt = this.now().toISOString();
      const controller = new AbortController();
      record.controller = controller;
      try {
        const result = await this.runner.run({
          binding: record.binding,
          prompt,
          conversationId: record.conversationId,
          signal: controller.signal,
          onConversationId: (conversationId) => {
            if (this.current !== record) return;
            record.conversationId = conversationId;
            record.updatedAt = this.now().toISOString();
          },
        });
        if (this.current !== record) return;
        record.conversationId = result.conversationId ?? record.conversationId;
        if (record.command === "message") {
          prompt = this.nextMessagePrompt(record);
          continue;
        }
        if (record.command === "takeover" || record.command === "stop") return;
        record.state = "completed";
        record.result = result.resultText;
        record.updatedAt = this.now().toISOString();
        return;
      } catch (error) {
        if (this.current !== record) return;
        if (record.command === "message") {
          prompt = this.nextMessagePrompt(record);
          continue;
        }
        if (record.command === "takeover" || record.command === "stop") return;
        record.state = "failed";
        record.error = errorMessage(error);
        record.updatedAt = this.now().toISOString();
        return;
      } finally {
        if (record.controller === controller) record.controller = null;
      }
    }
  }

  private snapshot(record: ChildRecord): ComputerUseChildSnapshot {
    return {
      childRunId: record.binding.childRunId,
      parentRunId: record.binding.parentRunId,
      state: record.state,
      task: record.task,
      conversationId: record.conversationId,
      result: record.result,
      error: record.error,
      startedAt: record.startedAt,
      updatedAt: record.updatedAt,
    };
  }
}
