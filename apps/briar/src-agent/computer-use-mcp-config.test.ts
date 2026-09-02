import { create } from "@bufbuild/protobuf";
import { access } from "node:fs/promises";
import {
  AgentRunKind,
  ApprovalPolicy,
  ComputerUseChildBindingSchema,
  RunRequestSchema,
  SandboxMode,
} from "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";
import { AgentProvider } from
  "@briar/contracts/gen/briar/types/v1/provider_pb";
import * as Result from "effect/Result";
import { describe, expect, it } from "vitest";
import { decodeRunnerRequest } from "./runner-request";
import {
  prepareComputerUseMcp,
  readComputerUseMcpConfig,
} from "./computer-use-mcp-config";

describe("Computer Use MCP config", () => {
  it("writes a private, short-lived ACP server config", async () => {
    const decoded = decodeRunnerRequest(create(RunRequestSchema, {
      message: "Use the desktop",
      workspaceRoot: "/tmp/workspace",
      approvalPolicy: ApprovalPolicy.NEVER,
      sandboxMode: SandboxMode.DANGER_FULL_ACCESS,
      runKind: AgentRunKind.PARENT,
      computerUseBinding: create(ComputerUseChildBindingSchema, {
        parentRunId: "parent-1",
        agentId: "agent-1",
        managedComputerId: "computer-1",
        displayIndex: 2,
        ownerToken: "owner_token_1234567890",
        provider: AgentProvider.CLAUDE,
      }),
      computerUseMcpServerPath: "/opt/briar/bin/briar-computer-use-mcp.js",
    }));
    if (Result.isFailure(decoded)) throw decoded.failure;
    const prepared = await prepareComputerUseMcp(decoded.success);
    const configPath = prepared.servers[0]?.args[2];
    expect(configPath).toBeTruthy();
    expect(await readComputerUseMcpConfig(configPath!)).toMatchObject({
      runKind: "parent",
      binding: {
        displayIndex: 2,
        ownerToken: "owner_token_1234567890",
        provider: "claude",
      },
    });
    await prepared.cleanup();
    await expect(access(configPath!)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
