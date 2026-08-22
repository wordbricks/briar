import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

export const managedComputerStates = [
  "requested",
  "provisioning",
  "bootstrapping",
  "needs_setup",
  "ready",
  "failed",
  "draining",
  "stopped",
  "terminated",
] as const;

export type ManagedComputerState = (typeof managedComputerStates)[number];

export type ManagedComputerRow = {
  id: string;
  organization_id: string;
  requester_user_id: string;
  entitlement_id: string;
  state: ManagedComputerState;
  aws_account_id: string | null;
  aws_region: string;
  aws_instance_type: string;
  aws_instance_id: string | null;
  aws_volume_id: string | null;
  aws_launch_template_id: string;
  aws_launch_template_version: string;
  bootstrap_api_origin: string;
  briar_device_id: string | null;
  provisioning_job_id: string;
  enrollment_nonce_hash: string;
  enrollment_expires_at: string;
  enrollment_consumed_at: string | null;
  enrollment_identity_hash: string | null;
  error_code: string | null;
  error_detail: string | null;
  retry_count: number;
  created_at: string;
  state_updated_at: string;
  expires_at: string;
  last_retry_at: string | null;
  drained_at: string | null;
  stopped_at: string | null;
  terminated_at: string | null;
  updated_at: string;
};

export type ManagedComputerProvisioningJobRow = {
  id: string;
  managed_computer_id: string;
  workflow_instance_id: string;
  idempotency_key: string;
  status: "requested" | "running" | "succeeded" | "failed";
  attempt: number;
  error_code: string | null;
  error_detail: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

const IntegerText = Schema.String.check(
  Schema.isPattern(/^\d+$/u),
).pipe(Schema.decodeTo(
  Schema.Int,
  SchemaTransformation.transform<number, string>({
    decode: (value) => Number(value),
    encode: (value) => String(value),
  }),
));

const PositiveIntegerText = IntegerText.check(Schema.isGreaterThan(0));
const BoolText = Schema.Literals(["true", "false"]).pipe(Schema.decodeTo(
  Schema.Boolean,
  SchemaTransformation.transform<boolean, "true" | "false">({
    decode: (value) => value === "true",
    encode: (value) => String(value) as "true" | "false",
  }),
));

const decodePositiveInteger = Schema.decodeUnknownOption(PositiveIntegerText);
const decodeBoolean = Schema.decodeUnknownOption(BoolText);

function positiveInteger(value: string | undefined, fallback: number) {
  return Option.getOrElse(decodePositiveInteger(value ?? ""), () => fallback);
}

function boundedPositiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
) {
  const parsed = positiveInteger(value, fallback);
  return parsed <= maximum ? parsed : fallback;
}

function booleanValue(value: string | undefined, fallback: boolean) {
  return Option.getOrElse(decodeBoolean(value ?? ""), () => fallback);
}

export type ManagedComputerConfig = {
  applicationsEnabled: boolean;
  remoteDesktopEnabled: boolean;
  remoteDesktopAllowedOrigins: readonly string[];
  remoteDesktopTokenTtlSeconds: number;
  remoteDesktopMaxSessionMinutes: number;
  remoteDesktopOrganizationSessionLimit: number;
  remoteDesktopFleetSessionLimit: number;
  remoteDesktopRateLimit: number;
  campaignId: string;
  promotionCode: string | null;
  organizationLimit: number;
  fleetLimit: number;
  lifetimeDays: number;
  stoppedRetentionDays: number;
  enrollmentTtlMinutes: number;
  region: string | null;
  launchTemplateId: string | null;
  launchTemplateVersion: string | null;
  instanceType: string;
  volumeGiB: number;
  vcpu: number;
  memoryGiB: number;
  apiOrigin: string | null;
  enrollmentSecret: string | null;
  awsIdentityPublicKey: string | null;
  awsAccessKeyId: string | null;
  awsSecretAccessKey: string | null;
  awsSessionToken: string | null;
};

export function managedComputerConfig(env: Env): ManagedComputerConfig {
  const apiOrigin = env.MANAGED_COMPUTER_API_ORIGIN?.trim() || null;
  const configuredRemoteOrigins =
    env.MANAGED_COMPUTER_REMOTE_DESKTOP_ALLOWED_ORIGINS
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  const apiOriginValue = apiOrigin
    ? (() => {
        try {
          return new URL(apiOrigin).origin;
        } catch {
          return null;
        }
      })()
    : null;
  return {
    applicationsEnabled: booleanValue(
      env.MANAGED_COMPUTER_APPLICATIONS_ENABLED,
      false,
    ),
    remoteDesktopEnabled: booleanValue(
      env.MANAGED_COMPUTER_REMOTE_DESKTOP_ENABLED,
      false,
    ),
    remoteDesktopAllowedOrigins: [
      ...configuredRemoteOrigins,
      ...(apiOriginValue ? [apiOriginValue] : []),
      "https://briar.wordbricks.ai",
      "tauri://localhost",
      "http://tauri.localhost",
      "https://tauri.localhost",
    ].filter((value, index, values) => values.indexOf(value) === index),
    remoteDesktopTokenTtlSeconds: boundedPositiveInteger(
      env.MANAGED_COMPUTER_REMOTE_DESKTOP_TOKEN_TTL_SECONDS,
      60,
      300,
    ),
    remoteDesktopMaxSessionMinutes: boundedPositiveInteger(
      env.MANAGED_COMPUTER_REMOTE_DESKTOP_MAX_SESSION_MINUTES,
      60,
      8 * 60,
    ),
    remoteDesktopOrganizationSessionLimit: boundedPositiveInteger(
      env.MANAGED_COMPUTER_REMOTE_DESKTOP_ORGANIZATION_SESSION_LIMIT,
      2,
      50,
    ),
    remoteDesktopFleetSessionLimit: boundedPositiveInteger(
      env.MANAGED_COMPUTER_REMOTE_DESKTOP_FLEET_SESSION_LIMIT,
      20,
      500,
    ),
    remoteDesktopRateLimit: boundedPositiveInteger(
      env.MANAGED_COMPUTER_REMOTE_DESKTOP_RATE_LIMIT,
      10,
      100,
    ),
    campaignId: "getbriar-pilot",
    promotionCode: env.MANAGED_COMPUTER_PROMOTION_CODE?.trim() || null,
    organizationLimit: positiveInteger(
      env.MANAGED_COMPUTER_ORGANIZATION_LIMIT,
      1,
    ),
    fleetLimit: positiveInteger(env.MANAGED_COMPUTER_FLEET_LIMIT, 1),
    lifetimeDays: positiveInteger(env.MANAGED_COMPUTER_LIFETIME_DAYS, 30),
    stoppedRetentionDays: positiveInteger(
      env.MANAGED_COMPUTER_STOPPED_RETENTION_DAYS,
      7,
    ),
    enrollmentTtlMinutes: positiveInteger(
      env.MANAGED_COMPUTER_ENROLLMENT_TTL_MINUTES,
      30,
    ),
    region: env.MANAGED_COMPUTER_AWS_REGION?.trim() || null,
    launchTemplateId:
      env.MANAGED_COMPUTER_AWS_LAUNCH_TEMPLATE_ID?.trim() || null,
    launchTemplateVersion:
      env.MANAGED_COMPUTER_AWS_LAUNCH_TEMPLATE_VERSION?.trim() || null,
    instanceType:
      env.MANAGED_COMPUTER_INSTANCE_TYPE?.trim() || "m7i.large",
    volumeGiB: positiveInteger(env.MANAGED_COMPUTER_VOLUME_GIB, 100),
    vcpu: positiveInteger(env.MANAGED_COMPUTER_VCPU, 2),
    memoryGiB: positiveInteger(env.MANAGED_COMPUTER_MEMORY_GIB, 8),
    apiOrigin,
    enrollmentSecret:
      env.MANAGED_COMPUTER_ENROLLMENT_SECRET?.trim() || null,
    awsIdentityPublicKey:
      env.MANAGED_COMPUTER_AWS_IDENTITY_PUBLIC_KEY?.trim() || null,
    awsAccessKeyId: env.MANAGED_COMPUTER_AWS_ACCESS_KEY_ID?.trim() || null,
    awsSecretAccessKey:
      env.MANAGED_COMPUTER_AWS_SECRET_ACCESS_KEY?.trim() || null,
    awsSessionToken: env.MANAGED_COMPUTER_AWS_SESSION_TOKEN?.trim() || null,
  };
}

export function managedComputerInfrastructureIssues(
  config: ManagedComputerConfig,
) {
  return [
    ["aws_region", config.region],
    ["launch_template_id", config.launchTemplateId],
    ["launch_template_version", config.launchTemplateVersion],
    ["api_origin", config.apiOrigin],
    ["enrollment_secret", config.enrollmentSecret],
    ["aws_identity_public_key", config.awsIdentityPublicKey],
    ["aws_access_key_id", config.awsAccessKeyId],
    ["aws_secret_access_key", config.awsSecretAccessKey],
  ].flatMap(([name, value]) => value ? [] : [name]);
}

export function managedComputerConfigurationIssues(
  config: ManagedComputerConfig,
) {
  return [
    ...(config.promotionCode ? [] : ["promotion_code"]),
    ...managedComputerInfrastructureIssues(config),
  ];
}

export function managedComputerInfrastructureConfigured(
  config: ManagedComputerConfig,
) {
  return managedComputerInfrastructureIssues(config).length === 0;
}

export function managedComputerProvisioningConfigured(
  config: ManagedComputerConfig,
) {
  return managedComputerConfigurationIssues(config).length === 0;
}

export function managedComputerProduct(config: ManagedComputerConfig) {
  return {
    product: {
      currency: "USD" as const,
      monthlyPriceCents: 10_000,
      quantity: 1,
      specification: {
        instanceType: config.instanceType,
        vcpu: config.vcpu,
        memoryGiB: config.memoryGiB,
        volumeGiB: config.volumeGiB,
        maxConcurrentRuns: 1,
        region: config.region,
      },
      modelApiCostsIncluded: false,
    },
    applicationsEnabled:
      config.applicationsEnabled && managedComputerProvisioningConfigured(config),
    remoteDesktopEnabled: config.remoteDesktopEnabled,
    organizationLimit: config.organizationLimit,
    fleetLimit: config.fleetLimit,
  };
}

export function managedComputerJson(row: ManagedComputerRow) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    requesterUserId: row.requester_user_id,
    state: row.state,
    region: row.aws_region,
    instanceId: row.aws_instance_id,
    volumeId: row.aws_volume_id,
    deviceId: row.briar_device_id,
    error: row.error_code
      ? { code: row.error_code, message: row.error_detail ?? row.error_code }
      : null,
    retryCount: row.retry_count,
    retryAvailable: row.state === "failed" && row.retry_count < 3,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
  };
}
