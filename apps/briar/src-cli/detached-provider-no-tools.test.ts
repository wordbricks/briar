import { create } from "@bufbuild/protobuf";
import { RunnerToParentSchema } from
  "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";
import {
  AgentActivityKind,
  AgentEventDirection,
} from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import {
  agentProviders,
  type AgentProvider,
} from "../src/lib/agent-provider";
import { supportsDetachedProviderClassification } from
  "../src/lib/detached-provider-capabilities";
import {
  DetachedClassificationToolAttemptError,
  runDetachedProviderClassification,
  type RunIsolatedClassificationTurn,
} from "./detached-provider-no-tools";
import {
  DetachedProviderStopUnconfirmedError,
  type DetachedProviderTurnInput,
  type DetachedProviderTurnResult,
} from "./detached-provider-turn";
import { runWithSingleRoutingToolRetry } from "./dm-reply-routing";
import { describe, expect, it, vi } from "vitest";

const input = (provider: AgentProvider = "claude"): DetachedProviderTurnInput => ({
  agent: {
    id: "router",
    name: "Router",
    provider,
    model: "configured-model",
    effort: "medium",
    responsibility: "Original Agent responsibility that must not reach routing.",
    skills: [],
  },
  prompt: "Inspect production logs.",
  workspacePath: "/isolated",
  fullAccess: false,
  readOnly: true,
  executionTools: "disabled",
  conversationId: null,
  attachments: [],
  skillCatalog: null,
  outputSchema: { type: "object" },
  environment: { HOME: "/isolated-home" },
  signal: new AbortController().signal,
});

const completed = (): DetachedProviderTurnResult => ({
  completed: true,
  exitCode: 0,
  stderr: "",
  runnerError: null,
  resultText: '{"action":"new","targetJobId":null,"response":null}',
  conversationId: "provider-session-must-not-escape",
});

describe("detached provider classification", () => {
  it.each(agentProviders)(
    "routes %s through the same isolated ordinary adapter boundary",
    async (provider) => {
      const run = vi.fn<RunIsolatedClassificationTurn>(async (turn) => {
        expect(turn).toMatchObject({
          fullAccess: false,
          readOnly: true,
          executionTools: "disabled",
          conversationId: null,
          attachments: [],
          organizationContextManifestPath: null,
          skillCatalog: null,
          outputSchema: undefined,
          runKind: "parent",
          computerUseMcpServerPath: null,
          dmMessageMcpServerPath: null,
          environment: { HOME: "/isolated-home" },
          agent: {
            provider,
            skills: [],
            activeSkill: null,
            computerUsePolicy: "disabled",
            scope: undefined,
          },
        });
        expect(turn.agent.responsibility).toContain("Classify only");
        expect(turn.agent.responsibility).not.toContain(
          "Original Agent responsibility",
        );
        expect(turn.computerUseBinding).toBeUndefined();
        expect(turn.delegationTargets).toBeUndefined();
        expect(turn.dmMessagePublicationBinding).toBeUndefined();
        expect(turn.prompt).toContain(
          "Return one JSON object without code fences",
        );
        expect(turn.prompt).toContain('{"type":"object"}');
        return completed();
      });

      expect(supportsDetachedProviderClassification(provider)).toBe(true);
      await expect(runDetachedProviderClassification(input(provider), run))
        .resolves.toMatchObject({
          completed: true,
          conversationId: null,
        });
      expect(run).toHaveBeenCalledOnce();
    },
  );

  it("rejects unsupported providers and every non-isolated caller context before dispatch", async () => {
    const run = vi.fn<RunIsolatedClassificationTurn>();
    expect(
      supportsDetachedProviderClassification("unknown" as AgentProvider),
    ).toBe(false);
    await expect(runDetachedProviderClassification(
      input("unknown" as AgentProvider),
      run,
    )).rejects.toThrow("detached_provider_no_tools_unsupported");

    const invalid: DetachedProviderTurnInput[] = [
      { ...input(), executionTools: undefined },
      { ...input(), fullAccess: true },
      { ...input(), readOnly: false },
      { ...input(), conversationId: "existing-session" },
      {
        ...input(),
        attachments: [{
          type: "image",
          path: "/tmp/a",
          name: "a",
          mimeType: "image/png",
        }],
      },
      { ...input(), organizationContextManifestPath: "/tmp/context.json" },
      {
        ...input(),
        delegationTargets: [{
          agentId: "agent",
          agentName: "Agent",
          projectId: "project",
          projectName: "Project",
          responsibility: "Act",
          skills: [],
        }],
      },
      {
        ...input(),
        skillCatalog: {
          rootPath: "/tmp/skills",
        } as NonNullable<DetachedProviderTurnInput["skillCatalog"]>,
      },
      {
        ...input(),
        computerUseBinding: {} as NonNullable<
          DetachedProviderTurnInput["computerUseBinding"]
        >,
      },
      { ...input(), computerUseMcpServerPath: "/tmp/computer.sock" },
      {
        ...input(),
        dmMessagePublicationBinding: {} as NonNullable<
          DetachedProviderTurnInput["dmMessagePublicationBinding"]
        >,
      },
      { ...input(), dmMessageMcpServerPath: "/tmp/dm.sock" },
      { ...input(), runKind: "computerUse" },
      { ...input(), onPayload: vi.fn() },
      { ...input(), onConversationId: vi.fn() },
    ];
    for (const candidate of invalid) {
      await expect(runDetachedProviderClassification(candidate, run))
        .rejects.toThrow("detached_provider_no_tools_invalid_context");
    }
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    "activityStarted",
    "activityDelta",
    "activityCompleted",
  ] as const)(
    "aborts and discards a decision after normalized %s",
    async (eventCase) => {
      let runnerSignal: AbortSignal | undefined;
      const run = vi.fn<RunIsolatedClassificationTurn>(async (turn) => {
        runnerSignal = turn.signal;
        const value = eventCase === "activityDelta"
          ? { id: "tool-1", delta: "running" }
          : {
              id: "tool-1",
              kind: AgentActivityKind.COMMAND,
              title: "Run command",
              text: "touch /tmp/forbidden",
              ...(eventCase === "activityCompleted" ? { status: 1 } : {}),
            };
        await turn.onPayload!(create(RunnerToParentSchema, {
          payload: {
            case: "event",
            value: {
              direction: AgentEventDirection.SERVER,
              normalized: { event: { case: eventCase, value } },
            },
          },
        }));
        return completed();
      });
      await expect(runDetachedProviderClassification(input(), run))
        .rejects.toThrow("detached_provider_no_tools_tool_attempted");
      expect(runnerSignal?.aborted).toBe(true);
    },
  );

  it("reports only bounded safe action metadata", async () => {
    const run = vi.fn<RunIsolatedClassificationTurn>(async (turn) => {
      await turn.onPayload!(create(RunnerToParentSchema, {
        payload: {
          case: "event",
          value: {
            direction: AgentEventDirection.SERVER,
            normalized: { event: { case: "activityStarted", value: {
              id: "tool-1",
              kind: AgentActivityKind.TOOL,
              title: "StructuredOutput",
              text: "secret arguments that must not escape",
            } } },
          },
        },
      }));
      return completed();
    });
    const error = await runDetachedProviderClassification(input(), run)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DetachedClassificationToolAttemptError);
    expect(error).toMatchObject({
      diagnostic: {
        eventCase: "activityStarted",
        kind: "tool",
        title: "StructuredOutput",
      },
    });
    expect((error as Error).message).not.toContain("secret arguments");
  });

  it("does not mistake MESSAGE activities for provider actions", async () => {
    const run = vi.fn<RunIsolatedClassificationTurn>(async (turn) => {
      for (const event of [
        { case: "activityStarted" as const, value: {
          id: "message-1", kind: AgentActivityKind.MESSAGE,
          title: "Assistant response", text: "",
        } },
        { case: "activityDelta" as const, value: {
          id: "message-1", delta: "plain JSON",
        } },
        { case: "activityCompleted" as const, value: {
          id: "message-1", kind: AgentActivityKind.MESSAGE,
          title: "Assistant response", text: "plain JSON", status: 1,
        } },
      ]) {
        await turn.onPayload!(create(RunnerToParentSchema, {
          payload: {
            case: "event",
            value: {
              direction: AgentEventDirection.SERVER,
              normalized: { event },
            },
          },
        }));
      }
      return completed();
    });
    await expect(runDetachedProviderClassification(input(), run))
      .resolves.toMatchObject({ completed: true });
  });

  it("preserves an unconfirmed stop instead of translating it to a tool attempt", async () => {
    const stopError = new DetachedProviderStopUnconfirmedError();
    const run = vi.fn<RunIsolatedClassificationTurn>(async (turn) => {
      try {
        await turn.onPayload!(create(RunnerToParentSchema, {
          payload: {
            case: "approval",
            value: { id: "tool-1", toolName: "Bash", input: {} },
          },
        }));
      } catch {
        throw stopError;
      }
      return completed();
    });
    await expect(runDetachedProviderClassification(input(), run))
      .rejects.toBe(stopError);
  });

  it("aborts and discards a decision after a provider approval request", async () => {
    let runnerSignal: AbortSignal | undefined;
    const run = vi.fn<RunIsolatedClassificationTurn>(async (turn) => {
      runnerSignal = turn.signal;
      await turn.onPayload!(create(RunnerToParentSchema, {
        payload: {
          case: "approval",
          value: { id: "tool-1", toolName: "Bash", input: {} },
        },
      }));
      return completed();
    });
    await expect(runDetachedProviderClassification(input(), run))
      .rejects.toThrow("detached_provider_no_tools_tool_attempted");
    expect(runnerSignal?.aborted).toBe(true);
  });

  it("retries a confirmed tool attempt once and never retries other failures", async () => {
    const toolAttempt = new DetachedClassificationToolAttemptError({
      eventCase: "approval",
      toolName: "StructuredOutput",
    });
    const successfulRetry = vi.fn(async (retry: boolean) => {
      if (!retry) throw toolAttempt;
      return "decision";
    });
    await expect(runWithSingleRoutingToolRetry(successfulRetry))
      .resolves.toBe("decision");
    expect(successfulRetry.mock.calls).toEqual([[false], [true]]);

    const secondToolAttempt = vi.fn(async () => { throw toolAttempt; });
    await expect(runWithSingleRoutingToolRetry(secondToolAttempt))
      .rejects.toBe(toolAttempt);
    expect(secondToolAttempt).toHaveBeenCalledTimes(2);

    const stopError = new DetachedProviderStopUnconfirmedError();
    const unconfirmedStop = vi.fn(async () => { throw stopError; });
    await expect(runWithSingleRoutingToolRetry(unconfirmedStop))
      .rejects.toBe(stopError);
    expect(unconfirmedStop).toHaveBeenCalledOnce();
  });
});
