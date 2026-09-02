import { create } from "@bufbuild/protobuf";
import { ComputerUseChildBindingSchema } from "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";
import { AgentProvider } from
  "@briar/contracts/gen/briar/types/v1/provider_pb";
import { describe, expect, it, vi } from "vitest";
import {
  ComputerUseChildOccupiedError,
  ComputerUseCoordinator,
  type ComputerUseChildTurnRunner,
} from "./computer-use-coordinator";

const binding = create(ComputerUseChildBindingSchema, {
  parentRunId: "parent-1",
  agentId: "agent-1",
  managedComputerId: "computer-1",
  displayIndex: 2,
  ownerToken: "owner-token",
  provider: AgentProvider.CLAUDE,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ComputerUseCoordinator", () => {
  it("allows only one active child and retains the display binding", async () => {
    let finish!: () => void;
    const runner: ComputerUseChildTurnRunner = {
      run: vi.fn(async ({ binding: childBinding, onConversationId }) => {
        expect(childBinding.displayIndex).toBe(2);
        expect(childBinding.ownerToken).toBe("owner-token");
        expect(childBinding.provider).toBe(AgentProvider.CLAUDE);
        onConversationId("conversation-1");
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { conversationId: "conversation-1", resultText: "done" };
      }),
    };
    const coordinator = new ComputerUseCoordinator(
      binding,
      runner,
      () => new Date("2026-09-02T00:00:00.000Z"),
      () => "child-1",
    );

    const started = coordinator.start("Open the settings page");
    expect(started.childRunId).toBe("child-1");
    expect(() => coordinator.start("Second task")).toThrow(
      ComputerUseChildOccupiedError,
    );
    await flush();
    finish();
    await flush();
    expect(coordinator.check()).toMatchObject({
      state: "completed",
      conversationId: "conversation-1",
      result: "done",
    });
  });

  it("steers a running child by restarting the same conversation", async () => {
    const prompts: string[] = [];
    const conversations: Array<string | null> = [];
    const runner: ComputerUseChildTurnRunner = {
      run: vi.fn<ComputerUseChildTurnRunner["run"]>(({ prompt, conversationId, signal, onConversationId }) => {
        prompts.push(prompt);
        conversations.push(conversationId);
        onConversationId("conversation-1");
        if (prompts.length === 2) {
          return Promise.resolve({
            conversationId: "conversation-1",
            resultText: "steered",
          });
        }
        return new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      }),
    };
    const coordinator = new ComputerUseCoordinator(binding, runner);
    coordinator.start("Open the account page");
    await flush();
    coordinator.message("Use the work account");
    await flush();
    await flush();

    expect(prompts[1]).toContain("Use the work account");
    expect(conversations).toEqual([null, "conversation-1"]);
    expect(coordinator.check()?.state).toBe("completed");
  });

  it("pauses input before human takeover", async () => {
    const runner: ComputerUseChildTurnRunner = {
      run: ({ signal }) => new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
    };
    const coordinator = new ComputerUseCoordinator(binding, runner);
    coordinator.start("Sign in");
    await flush();
    expect(coordinator.requestHumanTakeover().state).toBe("waiting_for_human");
    await flush();
    expect(coordinator.check()?.state).toBe("waiting_for_human");
  });
});
