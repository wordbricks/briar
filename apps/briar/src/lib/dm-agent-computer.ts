import type { ChannelAgentSummary } from "./channels-contract";
import type {
  ManagedComputer,
  WorkspaceExecutionWorker,
  ProjectAgent,
} from "../types";

type DmAgent = Pick<
  ChannelAgentSummary,
  "agentId" | "computerUsePolicy" | "name" | "projectId"
>;

type AgentComputerConfiguration = Pick<
  ProjectAgent,
  | "computerUsePolicy"
  | "designatedWorkerId"
  | "designatedWorkerLabel"
  | "id"
  | "teamId"
>;

type WorkerDevice = Pick<
  WorkspaceExecutionWorker,
  "bindings" | "deviceId" | "label"
>;

export type DmAgentComputerTarget = {
  agentId: string;
  agentName: string;
  computer: ManagedComputer;
  workerLabel: string;
};

export function resolveDmAgentComputerTarget(input: {
  agents: readonly DmAgent[];
  agentConfigurations: readonly AgentComputerConfiguration[];
  computers: readonly ManagedComputer[];
  workers: readonly WorkerDevice[];
}): DmAgentComputerTarget | null {
  for (const agent of input.agents) {
    if (!agent.projectId || agent.computerUsePolicy !== "unattended") continue;

    const configuration = input.agentConfigurations.find(
      (candidate) =>
        candidate.id === agent.agentId &&
        candidate.teamId === agent.projectId &&
        candidate.computerUsePolicy === "unattended" &&
        Boolean(candidate.designatedWorkerId),
    );
    if (!configuration?.designatedWorkerId) continue;

    const worker = input.workers.find((candidate) =>
      candidate.bindings.some(
        (binding) =>
          binding.id === configuration.designatedWorkerId &&
          binding.projectId === agent.projectId,
      )
    );
    if (!worker) continue;

    const computer = input.computers.find(
      (candidate) =>
        candidate.deviceId === worker.deviceId &&
        (candidate.state === "needs_setup" || candidate.state === "ready"),
    );
    if (!computer) continue;

    return {
      agentId: agent.agentId,
      agentName: agent.name,
      computer,
      workerLabel: configuration.designatedWorkerLabel ?? worker.label,
    };
  }
  return null;
}

/**
 * Whether two resolutions name the same screen. A re-resolve — a channel
 * switch, a roster refresh — reads the same fleet through fresh objects; the
 * panel keeps its live remote session when this holds, rather than tearing the
 * session down and racing a new one against its own end request.
 */
export function sameDmAgentComputerTarget(
  left: DmAgentComputerTarget | null,
  right: DmAgentComputerTarget | null,
) {
  if (!left || !right) return left === right;
  return left.agentId === right.agentId &&
    left.agentName === right.agentName &&
    left.computer.id === right.computer.id &&
    left.workerLabel === right.workerLabel;
}
