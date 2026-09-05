import { create } from "@bufbuild/protobuf";
import {
  buildComputerUseArgs,
  ComputerToolInput,
} from "@briar/agent-exec";
import { ComputerUseChildBindingSchema } from "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";
import type { ComputerUseResult } from "@briar/contracts/gen/agent/v1/computer_use_tool_pb";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ComputerUseBoxClient } from "../src-cli/computer-use-box-client";
import {
  ComputerUseCoordinator,
  type ComputerUseChildSnapshot,
} from "../src-cli/computer-use-coordinator";
import {
  assertDetachedProviderTurnSucceeded,
  runDetachedProviderTurn,
} from "../src-cli/detached-provider-turn";
import { computerUseBrowserProfileDirectory } from
  "../src-cli/computer-use-window-supervisor";
import {
  readComputerUseMcpConfig,
  type ComputerUseMcpConfig,
} from "./computer-use-mcp-config";
import { agentProviderToProto } from "../src/lib/agent-provider-proto";

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
});

const childSnapshotResult = (snapshot: ComputerUseChildSnapshot | null) =>
  textResult(snapshot === null
    ? "No Computer Use child has been started."
    : JSON.stringify(snapshot));

const computerResult = (
  result: ComputerUseResult,
) => {
  if (result.result.case === "error") {
    const failure = result.result.value;
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: [
            `Computer action failed: ${failure.error}`,
            failure.screenshotPath
              ? `Screenshot saved to ${failure.screenshotPath}.`
              : null,
          ].filter(Boolean).join("\n"),
        },
        ...(failure.screenshot
          ? [{
              type: "image" as const,
              data: failure.screenshot,
              mimeType: "image/png",
            }]
          : []),
      ],
    };
  }
  if (result.result.case !== "success") {
    return {
      isError: true,
      content: [{ type: "text" as const, text: "Computer executor returned no result." }],
    };
  }
  const success = result.result.value;
  return {
    content: [
      {
        type: "text" as const,
        text: success.cursorPosition
          ? [
              "Computer action ran on the assigned desktop.",
              success.screenshotPath
                ? `Screenshot saved to ${success.screenshotPath}.`
                : null,
              `Cursor is at (${success.cursorPosition.x}, ${success.cursorPosition.y}).`,
            ].filter(Boolean).join("\n")
          : [
              "Computer action ran on the assigned desktop.",
              success.screenshotPath
                ? `Screenshot saved to ${success.screenshotPath}.`
                : null,
            ].filter(Boolean).join("\n"),
      },
      ...(success.screenshot
        ? [{
            type: "image" as const,
            data: success.screenshot,
            mimeType: "image/png",
          }]
        : []),
    ],
  };
};

const computerUseChildResponsibility = [
  "Operate the assigned desktop to complete one tightly scoped task.",
  "Use Computer to observe and act; every batch returns a fresh screenshot, which you must inspect before the next action and before reporting completion.",
  "Before typing into a field that may contain text, clear it with Control+a and Backspace. Never type after a click failed because focus is uncertain.",
  "Use mouse and keyboard actions for GUI work, and never bypass this boundary with xdotool, CDP, Playwright, Puppeteer, browser page JavaScript, or another shell-driven GUI controller.",
  "Do not ask the user questions from this child run.",
  "Stop and report that human takeover is required for passwords, 2FA, CAPTCHAs, payments, or another step that must be performed by a person.",
  "Sites the user signed in to during an earlier takeover on this computer are usually still signed in, so try the site first and stop for takeover only when a person is actually required.",
].join(" ");

export const computerUseChildEnvironment = (
  displayIndex: number,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv => ({
  ...environment,
  DISPLAY: `:${displayIndex}`,
  BRIAR_BROWSER_PROFILE_DIRECTORY:
    computerUseBrowserProfileDirectory(displayIndex),
});

const registerComputerTools = async (
  server: McpServer,
  config: ComputerUseMcpConfig,
) => {
  const client = await ComputerUseBoxClient.connect();
  const executor = client.executorFor(config.binding);
  const execute = async (raw: unknown, toolCallId: string, signal: AbortSignal) =>
    computerResult(await executor.execute(
      buildComputerUseArgs({
        raw,
        toolCallId,
        viewport: config.viewport,
        bindUnmappedCharacters: true,
      }),
      { signal },
    ));

  if (config.runKind === "computerUse") {
    server.registerTool("Computer", {
      description:
        "Control the assigned desktop with screenshot, click, move, drag, type, key, scroll, or wait. A screenshot is appended after every action batch.",
      inputSchema: ComputerToolInput,
    }, (input, extra) => execute(input, String(extra.requestId), extra.signal));
    return null;
  }

  server.registerTool("Screenshot", {
    description: "Capture the assigned desktop without changing it.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, (_input, extra) => execute(
    { action: "screenshot" },
    String(extra.requestId),
    extra.signal,
  ));

  const parentBinding = create(ComputerUseChildBindingSchema, {
    ...config.binding,
    provider: agentProviderToProto(config.binding.provider),
  });
  const coordinator = new ComputerUseCoordinator(parentBinding, {
    run: async ({ binding, prompt, conversationId, signal, onConversationId }) => {
      const result = await runDetachedProviderTurn({
        agent: {
          id: binding.childRunId,
          name: "Computer Use",
          provider: config.binding.provider,
          model: config.model,
          effort: config.effort,
          responsibility: computerUseChildResponsibility,
          skills: [],
          computerUsePolicy: "unattended",
        },
        prompt,
        workspacePath: config.workspaceRoot,
        fullAccess: true,
        conversationId,
        skillCatalog: null,
        runKind: "computerUse",
        computerUseBinding: binding,
        computerUseMcpServerPath: config.mcpServerPath,
        environment: computerUseChildEnvironment(binding.displayIndex),
        signal,
        onConversationId,
      });
      assertDetachedProviderTurnSucceeded(result);
      return {
        conversationId: result.conversationId,
        resultText: result.resultText,
      };
    },
  });

  server.registerTool("StartComputerUse", {
    description:
      "Start one background Computer Use child for a small, self-contained desktop task. Only one child may run on this screen.",
    inputSchema: { task: z.string().min(1).max(8_000) },
  }, ({ task }) => childSnapshotResult(coordinator.start(task)));
  server.registerTool("CheckSubagent", {
    description: "Check the current Computer Use child state and result.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, () => childSnapshotResult(coordinator.check()));
  server.registerTool("MessageSubagent", {
    description:
      "Steer the active Computer Use child. Its current provider turn is safely restarted in the same conversation with the new guidance.",
    inputSchema: { message: z.string().min(1).max(8_000) },
  }, ({ message }) => childSnapshotResult(coordinator.message(message)));
  server.registerTool("StopSubagent", {
    description: "Stop the active Computer Use child before it changes the desktop again.",
    inputSchema: {},
  }, () => childSnapshotResult(coordinator.stop()));
  server.registerTool("RequestHumanTakeover", {
    description:
      "Pause the active Computer Use child before a person takes control of the same assigned screen. Ask the user to open this Agent's screen, then wait for confirmation before resuming with MessageSubagent. A sign-in completed during the takeover is kept for every Agent on this computer.",
    inputSchema: { reason: z.string().max(2_000).optional() },
  }, ({ reason }) => {
    const snapshot = coordinator.requestHumanTakeover();
    return textResult(JSON.stringify({
      ...snapshot,
      humanTakeover: {
        agentId: config.binding.agentId,
        managedComputerId: config.binding.managedComputerId,
        reason: reason?.trim() || null,
      },
    }));
  });
  return coordinator;
};

const configArgument = (arguments_: readonly string[]): string => {
  const index = arguments_.indexOf("--config");
  const value = index < 0 ? undefined : arguments_[index + 1];
  if (!value) throw new Error("Computer Use MCP requires --config PATH");
  return value;
};

export async function runComputerUseMcpServer(
  arguments_: readonly string[] = process.argv.slice(2),
) {
  const config = await readComputerUseMcpConfig(configArgument(arguments_));
  const server = new McpServer({ name: "briar-computer", version: "1.0.0" });
  const coordinator = await registerComputerTools(server, config);
  const shutdown = () => {
    if (coordinator === null) return;
    const state = coordinator.check();
    if (state && ["starting", "running", "waiting_for_human"].includes(state.state)) {
      coordinator.stop();
    }
  };
  process.once("SIGTERM", shutdown);
  process.stdin.once("end", shutdown);
  await server.connect(new StdioServerTransport());
}

if (import.meta.main) {
  void runComputerUseMcpServer().catch((error) => {
    console.error(
      `[briar-computer-use-mcp] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
