import type {
  ProjectAgentRunInput,
  ProjectAgentRunResponse,
} from "./project-llm";

export type ProjectAgentTurnDependencies<DispatchResult> = {
  runAgent: (
    input: ProjectAgentRunInput,
  ) => Promise<ProjectAgentRunResponse>;
  dispatchAutoHunt: (
    response: ProjectAgentRunResponse,
  ) => DispatchResult | Promise<DispatchResult>;
};

/**
 * Execute a saved Agent turn and honor the action selected by that Agent.
 *
 * Manual and scheduled invocations share this decision boundary: the caller
 * supplies the message, while the saved Agent decides whether to respond in
 * place or hand Auto Hunt to the trusted host dispatcher.
 */
export async function executeProjectAgentTurn<DispatchResult>(
  dependencies: ProjectAgentTurnDependencies<DispatchResult>,
  input: ProjectAgentRunInput,
) {
  const response = await dependencies.runAgent(input);
  const dispatchResult =
    response.action === "dispatch_auto_hunt"
      ? await dependencies.dispatchAutoHunt(response)
      : null;
  return { response, dispatchResult };
}
