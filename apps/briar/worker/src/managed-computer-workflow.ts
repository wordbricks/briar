import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import {
  AwsManagedComputerError,
  awsAccountId,
  describeManagedInstance,
  managedInstanceIsSsmOnline,
  runManagedInstance,
  terminateManagedInstance,
  verifyManagedInstance,
} from "./aws-managed-computer";
import { managedComputerEnrollmentNonce } from "./managed-computer-crypto";
import {
  managedComputerConfig,
  managedComputerInfrastructureIssues,
} from "./managed-computer-model";
import {
  clearRetiredManagedComputerInstance,
  completeManagedComputerProvisioning,
  failManagedComputerProvisioning,
  managedComputerById,
  managedComputerProvisioningJob,
  markManagedComputerBootstrapping,
  recordManagedComputerAuditEvent,
  recordManagedComputerInstance,
  startManagedComputerProvisioning,
} from "./managed-computer-repository";

export type ManagedComputerWorkflowParams = {
  managedComputerId: string;
  provisioningJobId: string;
  previousInstanceId?: string | null;
  previousInstanceRegion?: string | null;
};

const awsRetry = {
  retries: { limit: 4, delay: "5 seconds", backoff: "exponential" as const },
  timeout: "2 minutes",
} as const;

function errorCode(error: unknown) {
  return error instanceof AwsManagedComputerError
    ? error.code
    : "PROVISIONING_FAILED";
}

function errorDetail(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class ManagedComputerProvisioningWorkflow extends WorkflowEntrypoint<
  Env,
  ManagedComputerWorkflowParams
> {
  async run(
    event: Readonly<WorkflowEvent<ManagedComputerWorkflowParams>>,
    step: WorkflowStep,
  ) {
    const {
      managedComputerId,
      provisioningJobId,
      previousInstanceId,
      previousInstanceRegion,
    } = event.payload;
    try {
      const started = await step.do("reserve provisioning job", async () => {
        const config = managedComputerConfig(this.env);
        const issues = managedComputerInfrastructureIssues(config);
        if (issues.length > 0) {
          throw new AwsManagedComputerError(
            "MANAGED_COMPUTER_DISABLED",
            `Managed computer configuration is incomplete: ${issues.join(", ")}`,
            false,
          );
        }
        const [computer, job] = await Promise.all([
          startManagedComputerProvisioning(
            this.env.DB,
            managedComputerId,
            provisioningJobId,
            new Date().toISOString(),
          ),
          managedComputerProvisioningJob(this.env.DB, provisioningJobId),
        ]);
        if (!computer || !job || computer.provisioning_job_id !== job.id) {
          throw new AwsManagedComputerError(
            "PROVISIONING_JOB_STALE",
            "Managed computer provisioning job is no longer current",
            false,
          );
        }
        return {
          organizationId: computer.organization_id,
          region: computer.aws_region,
          instanceId: computer.aws_instance_id,
          accountId: computer.aws_account_id,
          state: computer.state,
        };
      });

      if (previousInstanceId) {
        await step.do(
          "retire previous EC2 instance",
          awsRetry,
          async () => {
            const config = managedComputerConfig(this.env);
            const region = previousInstanceRegion ?? started.region;
            const previous = await describeManagedInstance(
              config,
              region,
              previousInstanceId,
            );
            if (previous && previous.state !== "terminated") {
              if (
                previous.tags["briar-managed"] !== "true" ||
                previous.tags["briar-managed-computer"] !== managedComputerId
              ) {
                throw new AwsManagedComputerError(
                  "AWS_PREVIOUS_INSTANCE_MISMATCH",
                  "Previous managed instance tags did not match the retry target",
                  false,
                );
              }
              await terminateManagedInstance(config, region, previousInstanceId);
            }
            const cleared = await clearRetiredManagedComputerInstance(
              this.env.DB,
              {
                managedComputerId,
                provisioningJobId,
                previousInstanceId,
                observedAt: new Date().toISOString(),
              },
            );
            if (!cleared) {
              throw new AwsManagedComputerError(
                "PROVISIONING_JOB_STALE",
                "Previous managed instance is no longer owned by this retry",
                false,
              );
            }
          },
        );
      }

      const launched = await step.do(
        "create exactly one EC2 instance",
        awsRetry,
        async () => {
          const config = managedComputerConfig(this.env);
          const computer = await managedComputerById(this.env.DB, managedComputerId);
          if (!computer) {
            throw new AwsManagedComputerError(
              "MANAGED_COMPUTER_NOT_FOUND",
              "Managed computer disappeared during provisioning",
              false,
            );
          }
          const accountId = computer.aws_account_id ??
            await awsAccountId(config);
          const launchConfig = {
            ...config,
            region: computer.aws_region,
            launchTemplateId: computer.aws_launch_template_id,
            launchTemplateVersion: computer.aws_launch_template_version,
            instanceType: computer.aws_instance_type,
            apiOrigin: computer.bootstrap_api_origin,
          };
          const instanceId = computer.aws_instance_id ??
            await runManagedInstance(launchConfig, {
              managedComputerId,
              organizationId: computer.organization_id,
              campaignId: "getbriar-pilot",
              clientToken: provisioningJobId,
              nonce: await managedComputerEnrollmentNonce(
                config.enrollmentSecret ?? "",
                managedComputerId,
              ),
            });
          await recordManagedComputerInstance(this.env.DB, {
            managedComputerId,
            provisioningJobId,
            accountId,
            instanceId,
            volumeId: computer.aws_volume_id,
            observedAt: new Date().toISOString(),
          });
          await recordManagedComputerAuditEvent(this.env.DB, {
            organizationId: computer.organization_id,
            managedComputerId,
            action: "instance_created",
            detail: { instanceId, region: computer.aws_region },
            occurredAt: new Date().toISOString(),
          });
          return { accountId, instanceId, region: started.region };
        },
      );

      let running = null as Awaited<ReturnType<typeof describeManagedInstance>>;
      for (let check = 1; check <= 30; check += 1) {
        running = await step.do(
          "verify EC2 launch policy",
          awsRetry,
          async () => {
            const config = managedComputerConfig(this.env);
            const computer = await managedComputerById(this.env.DB, managedComputerId);
            if (!computer) {
              throw new AwsManagedComputerError(
                "MANAGED_COMPUTER_NOT_FOUND",
                "Managed computer disappeared during EC2 verification",
                false,
              );
            }
            const description = await describeManagedInstance(
              config,
              computer.aws_region,
              launched.instanceId,
            );
            if (!description || description.state === "pending") return description;
            if (description.state !== "running") {
              throw new AwsManagedComputerError(
                "AWS_INSTANCE_STATE_INVALID",
                `Managed instance entered unexpected state ${description.state}`,
                false,
              );
            }
            return verifyManagedInstance(config, {
              managedComputerId,
              organizationId: computer.organization_id,
              campaignId: "getbriar-pilot",
              instanceId: launched.instanceId,
              region: computer.aws_region,
              launchTemplateId: computer.aws_launch_template_id,
              launchTemplateVersion: computer.aws_launch_template_version,
              instanceType: computer.aws_instance_type,
            });
          },
        );
        if (running?.state === "running") break;
        await step.sleep("wait for EC2 running", "10 seconds");
      }
      if (!running || running.state !== "running") {
        throw new AwsManagedComputerError(
          "AWS_INSTANCE_TIMEOUT",
          "Managed instance did not reach running state in time",
          true,
        );
      }

      await step.do("begin secure bootstrap", async () => {
        const observedAt = new Date().toISOString();
        const computer = await managedComputerById(this.env.DB, managedComputerId);
        if (!computer) throw new Error("Managed computer not found");
        await recordManagedComputerInstance(this.env.DB, {
          managedComputerId,
          provisioningJobId,
          accountId: launched.accountId,
          instanceId: launched.instanceId,
          volumeId: running?.volumeId ?? null,
          observedAt,
        });
        await markManagedComputerBootstrapping(this.env.DB, {
          managedComputerId,
          provisioningJobId,
          observedAt,
        });
        await recordManagedComputerAuditEvent(this.env.DB, {
          organizationId: computer.organization_id,
          managedComputerId,
          action: "bootstrapping_started",
          detail: { instanceId: launched.instanceId },
          occurredAt: observedAt,
        });
      });

      let enrolled = false;
      for (let check = 1; check <= 60; check += 1) {
        enrolled = await step.do(
          "verify SSM and one-time enrollment",
          awsRetry,
          async () => {
            const config = managedComputerConfig(this.env);
            const computer = await managedComputerById(this.env.DB, managedComputerId);
            if (!computer) throw new Error("Managed computer not found");
            if (!await managedInstanceIsSsmOnline(
              config,
              computer.aws_region,
              launched.instanceId,
            )) return false;
            return computer.state === "needs_setup" &&
              computer.briar_device_id !== null &&
              computer.enrollment_consumed_at !== null;
          },
        );
        if (enrolled) break;
        await step.sleep("wait for secure bootstrap", "10 seconds");
      }
      if (!enrolled) {
        throw new AwsManagedComputerError(
          "BOOTSTRAP_TIMEOUT",
          "Managed instance did not complete secure enrollment in time",
          true,
        );
      }

      await step.do("complete provisioning job", async () => {
        await completeManagedComputerProvisioning(this.env.DB, {
          managedComputerId,
          provisioningJobId,
          observedAt: new Date().toISOString(),
        });
      });
      return { managedComputerId, state: "needs_setup" };
    } catch (error) {
      await step.do(
        "record provisioning failure",
        { retries: { limit: 3, delay: "2 seconds", backoff: "linear" } },
        async () => {
          await failManagedComputerProvisioning(this.env.DB, {
            managedComputerId,
            provisioningJobId,
            code: errorCode(error),
            detail: errorDetail(error),
            observedAt: new Date().toISOString(),
          });
        },
      );
      throw error;
    }
  }
}
