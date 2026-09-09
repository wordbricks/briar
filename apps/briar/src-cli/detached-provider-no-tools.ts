import type { RunnerToParent } from
  "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";
import { AgentActivityKind } from
  "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import { supportsDetachedProviderClassification } from
  "../src/lib/detached-provider-capabilities";
import type {
  DetachedProviderTurnInput,
  DetachedProviderTurnResult,
} from "./detached-provider-turn";

export type RunIsolatedClassificationTurn = (
  input: DetachedProviderTurnInput,
) => Promise<DetachedProviderTurnResult>;

const classificationResponsibility = [
  "Classify only the supplied DM routing request.",
  "Do not inspect files, call tools, or perform the requested work.",
  "Return only the structured routing decision requested by the prompt.",
].join(" ");

export type DetachedClassificationToolAttemptDiagnostic = {
  eventCase: "approval" | "activityStarted" | "activityDelta" |
    "activityCompleted";
  kind?: "command" | "file_change" | "web_search" | "tool" | "unspecified";
  toolName?: string;
  title?: string;
};

export class DetachedClassificationToolAttemptError extends Error {
  constructor(
    readonly diagnostic: DetachedClassificationToolAttemptDiagnostic,
  ) {
    const detail = Object.entries(diagnostic)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    super(`detached_provider_no_tools_tool_attempted ${detail}`);
    this.name = "DetachedClassificationToolAttemptError";
  }
}

export function isDetachedClassificationToolAttemptError(
  error: unknown,
): error is DetachedClassificationToolAttemptError {
  return error instanceof DetachedClassificationToolAttemptError;
}

function safeToolIdentifier(value: string): string | undefined {
  const trimmed = value.trim();
  return /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/u.test(trimmed)
    ? trimmed
    : undefined;
}

function safeActivityKind(kind: AgentActivityKind) {
  if (kind === AgentActivityKind.COMMAND) return "command" as const;
  if (kind === AgentActivityKind.FILE_CHANGE) return "file_change" as const;
  if (kind === AgentActivityKind.WEB_SEARCH) return "web_search" as const;
  if (kind === AgentActivityKind.TOOL) return "tool" as const;
  return "unspecified" as const;
}

/**
 * Identify provider actions while allowing adapters that represent plain
 * assistant text as MESSAGE activities. Diagnostic fields intentionally omit
 * activity text and any command, path, query, or approval input.
 */
export function detachedClassificationToolAttempt(
  message: RunnerToParent,
  messageActivityIds: Set<string>,
): DetachedClassificationToolAttemptDiagnostic | null {
  if (message.payload.case === "approval") {
    const toolName = safeToolIdentifier(message.payload.value.toolName);
    return {
      eventCase: "approval",
      ...(toolName ? { toolName } : {}),
    };
  }
  if (message.payload.case !== "event") return null;
  const event = message.payload.value.normalized?.event;
  if (!event) return null;
  if (event.case === "activityStarted") {
    if (event.value.kind === AgentActivityKind.MESSAGE) {
      messageActivityIds.add(event.value.id);
      return null;
    }
    const kind = safeActivityKind(event.value.kind);
    const title = kind === "tool"
      ? safeToolIdentifier(event.value.title)
      : undefined;
    return {
      eventCase: event.case,
      kind,
      ...(title ? { title } : {}),
    };
  }
  if (event.case === "activityDelta") {
    if (messageActivityIds.has(event.value.id)) return null;
    return { eventCase: event.case };
  }
  if (event.case === "activityCompleted") {
    if (
      event.value.kind === AgentActivityKind.MESSAGE ||
      messageActivityIds.delete(event.value.id)
    ) return null;
    const kind = safeActivityKind(event.value.kind);
    const title = kind === "tool"
      ? safeToolIdentifier(event.value.title)
      : undefined;
    return {
      eventCase: event.case,
      kind,
      ...(title ? { title } : {}),
    };
  }
  return null;
}

export function isDetachedProviderStopUnconfirmedError(
  error: unknown,
): error is Error {
  return error instanceof Error &&
    error.name === "DetachedProviderStopUnconfirmedError" &&
    error.message === "provider_stop_unconfirmed";
}

function assertIsolatedClassificationInput(input: DetachedProviderTurnInput) {
  if (!supportsDetachedProviderClassification(input.agent.provider)) {
    throw new Error("detached_provider_no_tools_unsupported");
  }
  if (input.executionTools !== "disabled" || input.fullAccess || !input.readOnly ||
    input.conversationId || input.attachments?.length ||
    input.organizationContextManifestPath || input.delegationTargets?.length ||
    input.skillCatalog || input.computerUseBinding || input.computerUseMcpServerPath ||
    input.dmMessagePublicationBinding || input.dmMessageMcpServerPath ||
    input.runKind === "computerUse" || input.onPayload || input.onConversationId) {
    throw new Error("detached_provider_no_tools_invalid_context");
  }
}

/**
 * Run one fresh classification through the selected Agent's ordinary adapter.
 * The caller supplies the non-recursive runner entry point; this boundary
 * removes Briar capabilities and rejects a decision if the provider attempts
 * any normalized action.
 */
export async function runDetachedProviderClassification(
  input: DetachedProviderTurnInput,
  runIsolatedTurn: RunIsolatedClassificationTurn,
): Promise<DetachedProviderTurnResult> {
  assertIsolatedClassificationInput(input);
  input.signal.throwIfAborted();
  const controller = new AbortController();
  const messageActivityIds = new Set<string>();
  let toolAttempt: DetachedClassificationToolAttemptError | null = null;
  const signal = AbortSignal.any([input.signal, controller.signal]);
  try {
    const result = await runIsolatedTurn({
      ...input,
      prompt: [
        input.prompt,
        "Return one JSON object without code fences that matches this JSON Schema:",
        JSON.stringify(input.outputSchema),
      ].join("\n\n"),
      agent: {
        ...input.agent,
        activeSkill: null,
        computerUsePolicy: "disabled",
        responsibility: classificationResponsibility,
        scope: undefined,
        skills: [],
      },
      fullAccess: false,
      readOnly: true,
      executionTools: "disabled",
      conversationId: null,
      attachments: [],
      organizationContextManifestPath: null,
      delegationTargets: undefined,
      skillCatalog: null,
      outputSchema: undefined,
      runKind: "parent",
      computerUseBinding: undefined,
      computerUseMcpServerPath: null,
      dmMessagePublicationBinding: undefined,
      dmMessageMcpServerPath: null,
      signal,
      onConversationId: undefined,
      onPayload: async (message) => {
        const diagnostic = detachedClassificationToolAttempt(
          message,
          messageActivityIds,
        );
        if (!diagnostic) return;
        toolAttempt = new DetachedClassificationToolAttemptError(diagnostic);
        controller.abort(toolAttempt);
        throw toolAttempt;
      },
    });
    if (toolAttempt) throw toolAttempt;
    return { ...result, conversationId: null };
  } catch (error) {
    if (isDetachedProviderStopUnconfirmedError(error)) throw error;
    if (toolAttempt) throw toolAttempt;
    throw error;
  }
}
