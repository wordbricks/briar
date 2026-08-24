import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManagedComputerProvisioningWorkflow } from "./managed-computer-workflow";

const mocks = vi.hoisted(() => ({
  awsAccountId: vi.fn(),
  clearRetryInstance: vi.fn(),
  complete: vi.fn(),
  describe: vi.fn(),
  fail: vi.fn(),
  job: vi.fn(),
  managedComputer: vi.fn(),
  markBootstrapping: vi.fn(),
  recordAudit: vi.fn(),
  recordInstance: vi.fn(),
  runInstance: vi.fn(),
  ssmOnline: vi.fn(),
  start: vi.fn(),
  terminate: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("./aws-managed-computer", () => ({
  AwsManagedComputerError: class AwsManagedComputerError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly retryable: boolean,
    ) {
      super(message);
    }
  },
  awsAccountId: mocks.awsAccountId,
  describeManagedInstance: mocks.describe,
  managedInstanceIsSsmOnline: mocks.ssmOnline,
  runManagedInstance: mocks.runInstance,
  terminateManagedInstance: mocks.terminate,
  verifyManagedInstance: mocks.verify,
}));

vi.mock("./managed-computer-crypto", () => ({
  managedComputerEnrollmentNonce: vi.fn(async () => "n".repeat(43)),
}));

vi.mock("./managed-computer-model", () => ({
  managedComputerConfig: vi.fn(() => ({
    campaignId: "getbriar-pilot",
    enrollmentSecret: "secret",
    region: "us-east-1",
    launchTemplateId: "lt-0123456789abcdef0",
    launchTemplateVersion: "7",
    apiOrigin: "https://briar.example",
  })),
  managedComputerInfrastructureIssues: vi.fn(() => []),
}));

vi.mock("./managed-computer-repository", () => ({
  clearRetiredManagedComputerInstance: mocks.clearRetryInstance,
  completeManagedComputerProvisioning: mocks.complete,
  failManagedComputerProvisioning: mocks.fail,
  managedComputerById: mocks.managedComputer,
  managedComputerProvisioningJob: mocks.job,
  markManagedComputerBootstrapping: mocks.markBootstrapping,
  recordManagedComputerAuditEvent: mocks.recordAudit,
  recordManagedComputerInstance: mocks.recordInstance,
  startManagedComputerProvisioning: mocks.start,
}));

const computer = {
  id: "22222222-2222-4222-8222-222222222222",
  organization_id: "11111111-1111-4111-8111-111111111111",
  provisioning_job_id: "33333333-3333-4333-8333-333333333333",
  aws_account_id: null,
  aws_region: "us-east-1",
  aws_instance_id: null,
  aws_volume_id: null,
  aws_launch_template_id: "lt-0123456789abcdef0",
  aws_launch_template_version: "7",
  aws_instance_type: "m7i.large",
  bootstrap_api_origin: "https://briar.example",
  state: "needs_setup",
  briar_device_id: "managed-22222222-2222-4222-8222-222222222222",
  enrollment_consumed_at: "2026-08-22T00:05:00.000Z",
};

describe("managed computer provisioning workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.start.mockResolvedValue(computer);
    mocks.job.mockResolvedValue({ id: computer.provisioning_job_id });
    mocks.managedComputer.mockResolvedValue(computer);
    mocks.awsAccountId.mockResolvedValue("123456789012");
    mocks.clearRetryInstance.mockResolvedValue(computer);
    mocks.runInstance.mockResolvedValue("i-0123456789abcdef0");
    const description = {
      state: "running",
      volumeId: "vol-0123456789abcdef0",
      tags: {
        "briar-managed": "true",
        "briar-managed-computer": computer.id,
      },
    };
    mocks.describe.mockResolvedValue(description);
    mocks.verify.mockResolvedValue(description);
    mocks.ssmOnline.mockResolvedValue(true);
  });

  it("launches once, verifies policy and enrollment, then completes the same job", async () => {
    const workflow = new ManagedComputerProvisioningWorkflow(
      {} as ExecutionContext,
      { DB: {} } as Env,
    );
    const step = {
      do: async (
        _name: string,
        optionsOrCallback: unknown,
        possibleCallback?: () => Promise<unknown>,
      ) => {
        const callback = typeof optionsOrCallback === "function"
          ? optionsOrCallback as () => Promise<unknown>
          : possibleCallback;
        if (!callback) throw new Error("Workflow callback missing");
        return callback();
      },
      sleep: vi.fn(async () => undefined),
    };
    const result = await workflow.run({
      payload: {
        managedComputerId: computer.id,
        provisioningJobId: computer.provisioning_job_id,
      },
    } as never, step as never);

    expect(result).toEqual({ managedComputerId: computer.id, state: "needs_setup" });
    expect(mocks.runInstance).toHaveBeenCalledTimes(1);
    expect(mocks.runInstance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clientToken: computer.provisioning_job_id }),
    );
    expect(mocks.verify).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "getbriar-pilot" }),
      expect.objectContaining({
        managedComputerId: computer.id,
        launchTemplateVersion: "7",
        instanceType: "m7i.large",
      }),
    );
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        managedComputerId: computer.id,
        provisioningJobId: computer.provisioning_job_id,
      }),
    );
    expect(mocks.fail).not.toHaveBeenCalled();
  });

  it("retires the previous instance before launching a fresh retry instance", async () => {
    const workflow = new ManagedComputerProvisioningWorkflow(
      {} as ExecutionContext,
      { DB: {} } as Env,
    );
    const step = {
      do: async (
        _name: string,
        optionsOrCallback: unknown,
        possibleCallback?: () => Promise<unknown>,
      ) => {
        const callback = typeof optionsOrCallback === "function"
          ? optionsOrCallback as () => Promise<unknown>
          : possibleCallback;
        if (!callback) throw new Error("Workflow callback missing");
        return callback();
      },
      sleep: vi.fn(async () => undefined),
    };
    const result = await workflow.run({
      payload: {
        managedComputerId: computer.id,
        provisioningJobId: computer.provisioning_job_id,
        previousInstanceId: "i-previous0123456789",
        previousInstanceRegion: "us-east-1",
      },
    } as never, step as never);

    expect(result).toEqual({ managedComputerId: computer.id, state: "needs_setup" });
    expect(mocks.terminate).toHaveBeenCalledWith(
      expect.anything(),
      "us-east-1",
      "i-previous0123456789",
    );
    expect(mocks.clearRetryInstance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        managedComputerId: computer.id,
        provisioningJobId: computer.provisioning_job_id,
        previousInstanceId: "i-previous0123456789",
      }),
    );
    expect(mocks.terminate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearRetryInstance.mock.invocationCallOrder[0]!,
    );
    expect(mocks.clearRetryInstance.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runInstance.mock.invocationCallOrder[0]!,
    );
    expect(mocks.runInstance).toHaveBeenCalledTimes(1);
    expect(mocks.fail).not.toHaveBeenCalled();
  });
});
