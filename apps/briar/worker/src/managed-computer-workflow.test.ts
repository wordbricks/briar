import { introspectWorkflowInstance } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const managedComputerId = "22222222-2222-4222-8222-222222222222";
const provisioningJobId = "33333333-3333-4333-8333-333333333333";
const instanceId = "i-0123456789abcdef0";

async function configureSuccessfulProvisioning(
  workflowInstanceId: string,
  includeRetirement: boolean,
) {
  const instance = await introspectWorkflowInstance(
    env.MANAGED_COMPUTER_PROVISIONING,
    workflowInstanceId,
  );
  await instance.modify(async (modifier) => {
    await modifier.disableSleeps();
    await modifier.mockStepResult(
      { name: "reserve provisioning job" },
      {
        organizationId: "11111111-1111-4111-8111-111111111111",
        region: "us-east-1",
        instanceId: null,
        accountId: null,
        state: "needs_setup",
      },
    );
    if (includeRetirement) {
      await modifier.mockStepResult(
        { name: "retire previous EC2 instance" },
        { retired: true },
      );
    }
    await modifier.mockStepResult(
      { name: "create exactly one EC2 instance" },
      { accountId: "123456789012", instanceId, region: "us-east-1" },
    );
    await modifier.mockStepResult(
      { name: "verify EC2 launch policy" },
      {
        instanceId,
        state: "running",
        volumeId: "vol-0123456789abcdef0",
        instanceType: "m7i.large",
        launchTemplateId: "lt-0123456789abcdef0",
        launchTemplateVersion: "7",
        httpTokens: "required",
        encrypted: true,
        securityGroupIds: ["sg-0123456789abcdef0"],
        tags: {
          "briar-managed": "true",
          "briar-managed-computer": managedComputerId,
        },
      },
    );
    await modifier.mockStepResult(
      { name: "begin secure bootstrap" },
      { started: true },
    );
    await modifier.mockStepResult(
      { name: "verify SSM and one-time enrollment" },
      true,
    );
    await modifier.mockStepResult(
      { name: "complete provisioning job" },
      { completed: true },
    );
  });
  return instance;
}

describe("managed computer provisioning workflow", () => {
  it("completes the provision, policy, enrollment, and finalization state machine", async () => {
    const workflowInstanceId = crypto.randomUUID();
    await using instance = await configureSuccessfulProvisioning(
      workflowInstanceId,
      false,
    );

    await env.MANAGED_COMPUTER_PROVISIONING.create({
      id: workflowInstanceId,
      params: { managedComputerId, provisioningJobId },
    });

    await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
    expect(await instance.waitForStepResult({
      name: "verify EC2 launch policy",
    })).toMatchObject({ state: "running", instanceId });
    expect(await instance.waitForStepResult({
      name: "verify SSM and one-time enrollment",
    })).toBe(true);
    expect(await instance.getOutput()).toEqual({
      managedComputerId,
      state: "needs_setup",
    });
  });

  it("runs the retirement state before a retry can complete", async () => {
    const workflowInstanceId = crypto.randomUUID();
    await using instance = await configureSuccessfulProvisioning(
      workflowInstanceId,
      true,
    );

    await env.MANAGED_COMPUTER_PROVISIONING.create({
      id: workflowInstanceId,
      params: {
        managedComputerId,
        provisioningJobId,
        previousInstanceId: "i-previous0123456789",
        previousInstanceRegion: "us-east-1",
      },
    });

    await expect(instance.waitForStepResult({
      name: "retire previous EC2 instance",
    })).resolves.toEqual({ retired: true });
    await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
    expect(await instance.getOutput()).toEqual({
      managedComputerId,
      state: "needs_setup",
    });
  });
});
