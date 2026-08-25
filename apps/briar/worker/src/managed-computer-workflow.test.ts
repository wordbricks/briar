import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ManagedComputerProvisioningJobRow,
  ManagedComputerRow,
} from "./managed-computer-model";
import type { ManagedInstanceDescription } from "./aws-managed-computer";
import {
  ManagedComputerProvisioningWorkflow,
  type ManagedComputerWorkflowServices,
  managedComputerWorkflowServices,
} from "./managed-computer-workflow";

const computer: ManagedComputerRow = {
  id: "22222222-2222-4222-8222-222222222222",
  organization_id: "11111111-1111-4111-8111-111111111111",
  requester_user_id: "user-1",
  entitlement_id: "entitlement-1",
  state: "needs_setup",
  aws_account_id: null,
  aws_region: "us-east-1",
  aws_instance_type: "m7i.large",
  aws_instance_id: null,
  aws_volume_id: null,
  aws_launch_template_id: "lt-0123456789abcdef0",
  aws_launch_template_version: "7",
  bootstrap_api_origin: "https://briar.example",
  briar_device_id: "managed-22222222-2222-4222-8222-222222222222",
  provisioning_job_id: "33333333-3333-4333-8333-333333333333",
  enrollment_nonce_hash: "nonce-hash",
  enrollment_expires_at: "2026-08-22T01:00:00.000Z",
  enrollment_consumed_at: "2026-08-22T00:05:00.000Z",
  enrollment_identity_hash: "identity-hash",
  error_code: null,
  error_detail: null,
  retry_count: 0,
  created_at: "2026-08-22T00:00:00.000Z",
  state_updated_at: "2026-08-22T00:05:00.000Z",
  expires_at: "2026-09-22T00:00:00.000Z",
  last_retry_at: null,
  drained_at: null,
  stopped_at: null,
  terminated_at: null,
  updated_at: "2026-08-22T00:05:00.000Z",
};

const job: ManagedComputerProvisioningJobRow = {
  id: computer.provisioning_job_id,
  managed_computer_id: computer.id,
  workflow_instance_id: "workflow-1",
  idempotency_key: "request-1",
  status: "running",
  attempt: 1,
  error_code: null,
  error_detail: null,
  started_at: "2026-08-22T00:00:00.000Z",
  completed_at: null,
  created_at: "2026-08-22T00:00:00.000Z",
  updated_at: "2026-08-22T00:00:00.000Z",
};

const description: ManagedInstanceDescription = {
  instanceId: "i-0123456789abcdef0",
  state: "running",
  volumeId: "vol-0123456789abcdef0",
  instanceType: "m7i.large",
  launchTemplateId: computer.aws_launch_template_id,
  launchTemplateVersion: computer.aws_launch_template_version,
  httpTokens: "required",
  encrypted: true,
  securityGroupIds: ["sg-0123456789abcdef0"],
  tags: {
    "briar-managed": "true",
    "briar-managed-computer": computer.id,
  },
};

const env = {
  DB: {},
  MANAGED_COMPUTER_API_ORIGIN: "https://briar.example",
  MANAGED_COMPUTER_AWS_ACCESS_KEY_ID: "access-key",
  MANAGED_COMPUTER_AWS_IDENTITY_PUBLIC_KEY: "public-key",
  MANAGED_COMPUTER_AWS_LAUNCH_TEMPLATE_ID: computer.aws_launch_template_id,
  MANAGED_COMPUTER_AWS_LAUNCH_TEMPLATE_VERSION:
    computer.aws_launch_template_version,
  MANAGED_COMPUTER_AWS_REGION: computer.aws_region,
  MANAGED_COMPUTER_AWS_SECRET_ACCESS_KEY: "secret-key",
  MANAGED_COMPUTER_ENROLLMENT_SECRET: "enrollment-secret",
} as Env;

const createServices = () => ({
  ...managedComputerWorkflowServices,
  awsAccountId: vi.fn(async () => "123456789012"),
  clearRetiredManagedComputerInstance: vi.fn(async () => computer),
  completeManagedComputerProvisioning: vi.fn(async () => undefined),
  describeManagedInstance: vi.fn(async () => description),
  failManagedComputerProvisioning: vi.fn(async () => undefined),
  managedComputerById: vi.fn(async () => computer),
  managedComputerEnrollmentNonce: vi.fn(async () => "n".repeat(43)),
  managedComputerProvisioningJob: vi.fn(async () => job),
  managedInstanceIsSsmOnline: vi.fn(async () => true),
  markManagedComputerBootstrapping: vi.fn(async () => undefined),
  recordManagedComputerAuditEvent: vi.fn(async () => undefined),
  recordManagedComputerInstance: vi.fn(async () => undefined),
  runManagedInstance: vi.fn(async () => description.instanceId),
  startManagedComputerProvisioning: vi.fn(async () => computer),
  terminateManagedInstance: vi.fn(async () => undefined),
  verifyManagedInstance: vi.fn(async () => description),
}) satisfies ManagedComputerWorkflowServices;

class TestManagedComputerProvisioningWorkflow
  extends ManagedComputerProvisioningWorkflow {
  constructor(private readonly testServices: ManagedComputerWorkflowServices) {
    super({} as ExecutionContext, env);
  }

  protected override get services(): ManagedComputerWorkflowServices {
    return this.testServices;
  }
}

const workflowStep = () => ({
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
});

describe("managed computer provisioning workflow", () => {
  let services: ReturnType<typeof createServices>;

  beforeEach(() => {
    services = createServices();
  });

  it("launches once, verifies policy and enrollment, then completes the same job", async () => {
    const workflow = new TestManagedComputerProvisioningWorkflow(services);

    await expect(workflow.run({
      payload: {
        managedComputerId: computer.id,
        provisioningJobId: computer.provisioning_job_id,
      },
    } as never, workflowStep() as never)).resolves.toEqual({
      managedComputerId: computer.id,
      state: "needs_setup",
    });

    expect(services.runManagedInstance).toHaveBeenCalledOnce();
    expect(services.runManagedInstance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        managedComputerId: computer.id,
        clientToken: computer.provisioning_job_id,
      }),
    );
    expect(services.verifyManagedInstance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        managedComputerId: computer.id,
        launchTemplateVersion: "7",
        instanceType: "m7i.large",
      }),
    );
    expect(services.completeManagedComputerProvisioning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        managedComputerId: computer.id,
        provisioningJobId: computer.provisioning_job_id,
      }),
    );
    expect(services.failManagedComputerProvisioning).not.toHaveBeenCalled();
  });

  it("retires the previous instance before launching a retry", async () => {
    const workflow = new TestManagedComputerProvisioningWorkflow(services);

    await workflow.run({
      payload: {
        managedComputerId: computer.id,
        provisioningJobId: computer.provisioning_job_id,
        previousInstanceId: "i-previous0123456789",
        previousInstanceRegion: "us-east-1",
      },
    } as never, workflowStep() as never);

    expect(services.terminateManagedInstance).toHaveBeenCalledWith(
      expect.anything(),
      "us-east-1",
      "i-previous0123456789",
    );
    expect(
      services.terminateManagedInstance.mock.invocationCallOrder[0],
    ).toBeLessThan(
      services.clearRetiredManagedComputerInstance.mock.invocationCallOrder[0]!,
    );
    expect(
      services.clearRetiredManagedComputerInstance.mock.invocationCallOrder[0],
    ).toBeLessThan(services.runManagedInstance.mock.invocationCallOrder[0]!);
    expect(services.runManagedInstance).toHaveBeenCalledOnce();
  });
});
