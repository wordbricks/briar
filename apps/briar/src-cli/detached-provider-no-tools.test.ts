import type { query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";
import { runDetachedProviderClassification } from "./detached-provider-no-tools";
import type { DetachedProviderTurnInput } from "./detached-provider-turn";

const input = (): DetachedProviderTurnInput => ({
  agent: { id: "router", name: "Router", provider: "claude", model: "sonnet", effort: "medium",
    responsibility: "Classify the supplied request.", skills: [] },
  prompt: "Inspect production logs.", workspacePath: "/isolated", fullAccess: false, readOnly: true,
  executionTools: "disabled", conversationId: null, attachments: [], skillCatalog: null,
  environment: { HOME: "/isolated-home" }, signal: new AbortController().signal,
});

describe("detached provider without tools", () => {
  it("disables builtin and configured tools, denies attempted calls, and closes the isolated SDK query", async () => {
    const close = vi.fn();
    const messages = (async function* () {
      yield { type: "result", subtype: "success", result: "unused",
        structured_output: { mode: "execute" } } as SDKMessage;
    })();
    const invoke = vi.fn<typeof query>(() => Object.assign(messages, { close }) as unknown as ReturnType<typeof query>);
    expect(await runDetachedProviderClassification(input(), invoke)).toMatchObject({
      completed: true, resultText: '{"mode":"execute"}', conversationId: null,
    });
    const options = invoke.mock.calls[0]![0].options!;
    expect(options).toMatchObject({ tools: [], allowedTools: [], mcpServers: {}, strictMcpConfig: true,
      settingSources: [], skills: [], plugins: [], permissionMode: "dontAsk", env: { HOME: "/isolated-home" } });
    expect(options).not.toHaveProperty("resume");
    expect(await options.canUseTool!("Bash", { command: "touch /tmp/forbidden" }, {
      signal: new AbortController().signal, toolUseID: "attempt-1", requestId: "request-1",
    })).toMatchObject({ behavior: "deny" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("fails before calling the provider for unsupported or non-isolated requests", async () => {
    const invoke = vi.fn<typeof query>();
    const base = input();
    await expect(runDetachedProviderClassification({ ...base, agent: { ...base.agent, provider: "grok" } }, invoke))
      .rejects.toThrow("detached_provider_no_tools_unsupported");
    await expect(runDetachedProviderClassification({ ...base, conversationId: "existing-session" }, invoke))
      .rejects.toThrow("detached_provider_no_tools_invalid_context");
    expect(invoke).not.toHaveBeenCalled();
  });
});
