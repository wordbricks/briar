import { createClient, type Client } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import {
  ComputerUseWindowService,
  EnsureComputerUseWindowRequestSchema,
  ReleaseComputerUseWindowRequestSchema,
} from "@briar/contracts/gen/briar/box/v1/computer_use_window_pb";
import {
  RemoteResourceAccessor,
  computerUseExecutorResource,
  createBoxExecTransport,
  createConnectRemoteExecManager,
  loopbackBoxExecConnection,
  type ComputerUseExecutor,
} from "@briar/agent-exec";
import { readBoxExecAuthToken } from "./computer-use-box-service";
import type { ComputerUseDesktopAssignment } from "./computer-use-desktop-manager";

type WindowServiceClient = Client<typeof ComputerUseWindowService>;

export interface AssignedComputerUseResource {
  readonly assignment: ComputerUseDesktopAssignment;
  readonly executor: ComputerUseExecutor;
  release(): Promise<void>;
}

export class ComputerUseBoxClient {
  private constructor(
    private readonly authToken: string,
    private readonly windows: WindowServiceClient,
    private readonly host: string,
  ) {}

  static async connect(input: {
    readonly authToken?: string;
    readonly authTokenPath?: string;
    readonly host?: string;
    readonly primaryPort?: number;
  } = {}): Promise<ComputerUseBoxClient> {
    const authToken = input.authToken
      ?? await readBoxExecAuthToken(input.authTokenPath);
    const host = input.host?.trim() || "127.0.0.1";
    const connection = loopbackBoxExecConnection({ authToken, host });
    const baseUrl = input.primaryPort === undefined
      ? connection.baseUrl
      : `http://${host}:${input.primaryPort}`;
    const windows = createClient(
      ComputerUseWindowService,
      createBoxExecTransport({ ...connection, baseUrl }),
    );
    return new ComputerUseBoxClient(authToken, windows, host);
  }

  async assign(agentId: string, forkPort?: number): Promise<AssignedComputerUseResource> {
    const response = await this.windows.ensureComputerUseWindow(
      create(EnsureComputerUseWindowRequestSchema, { agentId }),
    );
    const window = response.window;
    if (window === undefined) {
      throw new Error("Box executor returned no Computer Use window");
    }
    const assignment: ComputerUseDesktopAssignment = {
      agentId: window.agentId,
      displayIndex: window.displayIndex,
      ownerToken: window.ownerToken,
      updatedAt: window.updatedAt,
    };
    return {
      assignment,
      executor: this.executorFor(assignment, forkPort),
      release: async () => {
        await this.windows.releaseComputerUseWindow(
          create(ReleaseComputerUseWindowRequestSchema, {
            agentId: assignment.agentId,
            ownerToken: assignment.ownerToken,
          }),
        );
      },
    };
  }

  executorFor(
    assignment: Pick<
      ComputerUseDesktopAssignment,
      "displayIndex" | "ownerToken"
    >,
    forkPort?: number,
  ): ComputerUseExecutor {
    const connection = loopbackBoxExecConnection({
      authToken: this.authToken,
      host: this.host,
      displayIndex: assignment.displayIndex,
      ownerToken: assignment.ownerToken,
    });
    const accessor = new RemoteResourceAccessor(createConnectRemoteExecManager({
      ...connection,
      baseUrl: forkPort === undefined
        ? connection.baseUrl
        : `http://${this.host}:${forkPort}`,
    }));
    return accessor.get(computerUseExecutorResource);
  }
}
