import { Buffer } from "node:buffer";

export type DetachedAgent = {
  id: string;
  name: string;
  provider: "codex" | "claude" | "grok";
  model: string | null;
  responsibility: string;
  skill: string;
};

export function detachedAgentPrompt(input: {
  agent: DetachedAgent;
  sourceKey: string;
  title: string;
  description: string | null;
  workspacePath: string;
}) {
  return [
    `You are ${input.agent.name}, the Briar Agent assigned to ${input.sourceKey}.`,
    input.agent.responsibility,
    input.agent.skill,
    `Work only on the claimed issue "${input.title}" in ${input.workspacePath}.`,
    input.description ? `Issue description:\n${input.description}` : "",
    "Use the briar-workflow skill and the existing active claim. Record progress, evidence, and a terminal completion/failure through the Briar CLI.",
    "Do not claim another issue and do not wait for interactive approval.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function detachedProviderRequest(input: {
  agent: DetachedAgent;
  prompt: string;
  workspacePath: string;
  fullAccess: boolean;
  agentBinary: string;
}) {
  if (input.agent.provider === "codex") {
    return {
      kind: "direct" as const,
      arguments: [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--sandbox",
        input.fullAccess ? "danger-full-access" : "workspace-write",
        "-c",
        'approval_policy="never"',
        ...(input.agent.model ? ["--model", input.agent.model] : []),
        input.prompt,
      ],
      request: null,
    };
  }
  return {
    kind: "runner" as const,
    arguments: [] as string[],
    request: {
      type: "run",
      message: input.prompt,
      workspaceRoot: input.workspacePath,
      conversationId: null,
      instructions: input.agent.skill,
      outputSchema: null,
      model: input.agent.model,
      effort: null,
      approvalPolicy: "never",
      sandboxMode: input.fullAccess ? "dangerFullAccess" : "workspaceWrite",
      networkAccess: true,
      ...(input.agent.provider === "claude"
        ? { claudeBinary: input.agentBinary }
        : { grokBinary: input.agentBinary }),
    },
  };
}

export function boundedTranscriptPayload(payload: unknown, rawLine: string) {
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, "utf8") <= 28_000) return payload;
  return {
    type: "truncated",
    preview: rawLine.slice(0, 20_000),
    originalBytes: Buffer.byteLength(rawLine, "utf8"),
  };
}
