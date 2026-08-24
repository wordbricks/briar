import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { ManagedComputerConfig } from "./managed-computer-model";

const encoder = new TextEncoder();

export class AwsManagedComputerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AwsManagedComputerError";
  }
}

type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | null;
};

type ManagedInstanceExpectation = {
  managedComputerId: string;
  organizationId: string;
  campaignId: string;
  instanceId: string;
  region: string;
  launchTemplateId: string;
  launchTemplateVersion: string;
  instanceType: string;
};

export type ManagedInstanceDescription = {
  instanceId: string;
  state: string;
  volumeId: string | null;
  instanceType: string;
  launchTemplateId: string;
  launchTemplateVersion: string;
  httpTokens: string;
  encrypted: boolean;
  securityGroupIds: string[];
  tags: Record<string, string>;
};

const InstanceId = Schema.String.check(Schema.isPattern(/^i-[0-9a-f]+$/u));
const VolumeId = Schema.String.check(Schema.isPattern(/^vol-[0-9a-f]+$/u));
const AccountId = Schema.String.check(Schema.isPattern(/^\d{12}$/u));
const decodeInstanceId = Schema.decodeUnknownOption(InstanceId);
const decodeVolumeId = Schema.decodeUnknownOption(VolumeId);
const decodeAccountId = Schema.decodeUnknownOption(AccountId);

function credentials(config: ManagedComputerConfig): AwsCredentials {
  if (!config.awsAccessKeyId || !config.awsSecretAccessKey) {
    throw new AwsManagedComputerError(
      "AWS_CONFIGURATION_MISSING",
      "AWS managed computer credentials are not configured",
      false,
    );
  }
  return {
    accessKeyId: config.awsAccessKeyId,
    secretAccessKey: config.awsSecretAccessKey,
    sessionToken: config.awsSessionToken,
  };
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function hmac(key: ArrayBuffer | string, value: string) {
  const raw = typeof key === "string" ? encoder.encode(key) : key;
  const imported = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", imported, encoder.encode(value));
}

function awsTimestamp(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/gu, "");
}

async function signedAwsRequest(input: {
  service: "ec2" | "ssm" | "sts";
  region: string;
  target?: string;
  contentType: string;
  body: string;
  config: ManagedComputerConfig;
  fetcher?: typeof fetch;
}) {
  const credential = credentials(input.config);
  const region = input.service === "sts" ? "us-east-1" : input.region;
  const host = input.service === "sts"
    ? "sts.amazonaws.com"
    : `${input.service}.${region}.amazonaws.com`;
  const now = new Date();
  const timestamp = awsTimestamp(now);
  const date = timestamp.slice(0, 8);
  const headers = new Map<string, string>([
    ["content-type", input.contentType],
    ["host", host],
    ["x-amz-date", timestamp],
  ]);
  if (input.target) headers.set("x-amz-target", input.target);
  if (credential.sessionToken) {
    headers.set("x-amz-security-token", credential.sessionToken);
  }
  const sortedHeaders = [...headers.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  const canonicalHeaders = sortedHeaders
    .map(([name, value]) => `${name}:${value.trim().replace(/\s+/gu, " ")}\n`)
    .join("");
  const signedHeaders = sortedHeaders.map(([name]) => name).join(";");
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    await sha256(input.body),
  ].join("\n");
  const scope = `${date}/${region}/${input.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp,
    scope,
    await sha256(canonicalRequest),
  ].join("\n");
  const dateKey = await hmac(`AWS4${credential.secretAccessKey}`, date);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, input.service);
  const signingKey = await hmac(serviceKey, "aws4_request");
  const signature = hex(await hmac(signingKey, stringToSign));
  const requestHeaders = new Headers(Object.fromEntries(sortedHeaders));
  requestHeaders.set(
    "authorization",
    `AWS4-HMAC-SHA256 Credential=${credential.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  );
  return (input.fetcher ?? fetch)(`https://${host}/`, {
    method: "POST",
    headers: requestHeaders,
    body: input.body,
  });
}

function xmlValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "u"));
  return match?.[1]
    ?.replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'") ?? null;
}

function xmlValues(xml: string, tag: string) {
  return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gu"))]
    .map((match) => xmlValue(match[0], tag))
    .filter((value): value is string => value !== null);
}

function xmlSection(xml: string, tag: string) {
  return xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "u"))?.[1] ?? "";
}

function xmlItems(xml: string) {
  const items: string[] = [];
  const tokens = xml.matchAll(/<\/?item>/gu);
  let depth = 0;
  let start = -1;
  for (const token of tokens) {
    if (token[0] === "<item>") {
      if (depth === 0) start = (token.index ?? 0) + token[0].length;
      depth += 1;
      continue;
    }
    depth -= 1;
    if (depth === 0 && start >= 0) {
      items.push(xml.slice(start, token.index));
      start = -1;
    }
  }
  return items;
}

function awsError(xml: string, status: number) {
  const code = xmlValue(xml, "Code") ?? `AWS_HTTP_${status}`;
  const message = xmlValue(xml, "Message") ?? "AWS request failed";
  const retryable = status === 429 || status >= 500 || [
    "RequestLimitExceeded",
    "Throttling",
    "ServiceUnavailable",
    "InternalError",
  ].includes(code);
  return new AwsManagedComputerError(code, message.slice(0, 1_000), retryable);
}

interface Ec2QueryParameters {
  [name: string]: string;
}

async function ec2Query(
  config: ManagedComputerConfig,
  region: string,
  action: string,
  parameters: Ec2QueryParameters,
  fetcher?: typeof fetch,
) {
  const body = new URLSearchParams({
    Action: action,
    Version: "2016-11-15",
    ...parameters,
  }).toString();
  const response = await signedAwsRequest({
    service: "ec2",
    region,
    contentType: "application/x-www-form-urlencoded; charset=utf-8",
    body,
    config,
    fetcher,
  });
  const text = await response.text();
  if (!response.ok) throw awsError(text, response.status);
  return text;
}

function asciiBase64(value: string) {
  const bytes = encoder.encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function managedComputerUserData(input: {
  apiOrigin: string;
  managedComputerId: string;
  nonce: string;
}) {
  const enrollment = JSON.stringify(input);
  return `#!/bin/bash
set -euo pipefail
umask 077
install -d -m 0700 /var/lib/briar
cat > /var/lib/briar/managed-enrollment.json <<'BRIAR_ENROLLMENT'
${enrollment}
BRIAR_ENROLLMENT
chmod 0600 /var/lib/briar/managed-enrollment.json
systemctl start briar-managed-enroll.service
`;
}

export async function awsAccountId(
  config: ManagedComputerConfig,
  fetcher?: typeof fetch,
) {
  const body = new URLSearchParams({
    Action: "GetCallerIdentity",
    Version: "2011-06-15",
  }).toString();
  const response = await signedAwsRequest({
    service: "sts",
    region: "us-east-1",
    contentType: "application/x-www-form-urlencoded; charset=utf-8",
    body,
    config,
    fetcher,
  });
  const text = await response.text();
  if (!response.ok) throw awsError(text, response.status);
  const accountId = xmlValue(text, "Account");
  const decoded = Option.getOrUndefined(decodeAccountId(accountId));
  if (!decoded) {
    throw new AwsManagedComputerError(
      "AWS_RESPONSE_INVALID",
      "AWS account identity response was invalid",
      false,
    );
  }
  return decoded;
}

export async function runManagedInstance(
  config: ManagedComputerConfig,
  input: {
    managedComputerId: string;
    organizationId: string;
    campaignId: string;
    nonce: string;
    clientToken?: string;
  },
  fetcher?: typeof fetch,
) {
  if (
    !config.region ||
    !config.launchTemplateId ||
    !config.launchTemplateVersion ||
    !config.apiOrigin
  ) {
    throw new AwsManagedComputerError(
      "AWS_CONFIGURATION_MISSING",
      "Managed computer launch configuration is incomplete",
      false,
    );
  }
  const tags = [
    ["briar-managed", "true"],
    ["briar-organization", input.organizationId],
    ["briar-managed-computer", input.managedComputerId],
    ["briar-campaign", input.campaignId],
  ] as const;
  const parameters: Ec2QueryParameters = {
    ClientToken: input.clientToken ?? input.managedComputerId,
    MinCount: "1",
    MaxCount: "1",
    "LaunchTemplate.LaunchTemplateId": config.launchTemplateId,
    "LaunchTemplate.Version": config.launchTemplateVersion,
    UserData: asciiBase64(managedComputerUserData({
      apiOrigin: config.apiOrigin,
      managedComputerId: input.managedComputerId,
      nonce: input.nonce,
    })),
    "TagSpecification.1.ResourceType": "instance",
    "TagSpecification.2.ResourceType": "volume",
  };
  for (const [index, [key, value]] of tags.entries()) {
    const tag = index + 1;
    parameters[`TagSpecification.1.Tag.${tag}.Key`] = key;
    parameters[`TagSpecification.1.Tag.${tag}.Value`] = value;
    parameters[`TagSpecification.2.Tag.${tag}.Key`] = key;
    parameters[`TagSpecification.2.Tag.${tag}.Value`] = value;
  }
  const response = await ec2Query(
    config,
    config.region,
    "RunInstances",
    parameters,
    fetcher,
  );
  const instanceId = Option.getOrUndefined(
    decodeInstanceId(xmlValue(response, "instanceId")),
  );
  if (!instanceId) {
    throw new AwsManagedComputerError(
      "AWS_RESPONSE_INVALID",
      "AWS did not return a valid instance ID",
      false,
    );
  }
  return instanceId;
}

function tagsFromXml(xml: string) {
  const tags: Record<string, string> = {};
  for (const item of xmlItems(xmlSection(xml, "tagSet"))) {
    const key = xmlValue(item, "key");
    const value = xmlValue(item, "value");
    if (key && value !== null) tags[key] = value;
  }
  return tags;
}

export async function describeManagedInstance(
  config: ManagedComputerConfig,
  region: string,
  instanceId: string,
  fetcher?: typeof fetch,
): Promise<ManagedInstanceDescription | null> {
  try {
    const response = await ec2Query(config, region, "DescribeInstances", {
      "InstanceId.1": instanceId,
    }, fetcher);
    const instance = xmlItems(xmlSection(response, "instancesSet"))[0] ?? "";
    if (!instance) return null;
    const blockDevices = xmlSection(instance, "blockDeviceMapping");
    const launchTemplate = xmlSection(instance, "launchTemplate");
    const metadataOptions = xmlSection(instance, "metadataOptions");
    const groupSet = xmlSection(instance, "groupSet");
    const tags = tagsFromXml(instance);
    const volumeId = Option.getOrNull(
      decodeVolumeId(xmlValue(blockDevices, "volumeId")),
    );
    let encrypted = false;
    if (volumeId) {
      const volumes = await ec2Query(config, region, "DescribeVolumes", {
        "VolumeId.1": volumeId,
      }, fetcher);
      const volume = xmlItems(xmlSection(volumes, "volumeSet"))[0] ?? "";
      encrypted = xmlValue(volume, "encrypted") === "true";
    }
    return {
      instanceId: xmlValue(instance, "instanceId") ?? "",
      state: xmlValue(xmlSection(instance, "instanceState"), "name") ?? "unknown",
      volumeId,
      instanceType: xmlValue(instance, "instanceType") ?? "",
      launchTemplateId: xmlValue(launchTemplate, "launchTemplateId") ??
        tags["aws:ec2launchtemplate:id"] ?? "",
      launchTemplateVersion: xmlValue(launchTemplate, "version") ??
        tags["aws:ec2launchtemplate:version"] ?? "",
      httpTokens: xmlValue(metadataOptions, "httpTokens") ?? "",
      encrypted,
      securityGroupIds: xmlValues(groupSet, "groupId"),
      tags,
    };
  } catch (error) {
    if (
      error instanceof AwsManagedComputerError &&
      error.code === "InvalidInstanceID.NotFound"
    ) return null;
    throw error;
  }
}

async function assertNoInboundRules(
  config: ManagedComputerConfig,
  input: ManagedInstanceDescription,
  region: string,
  fetcher?: typeof fetch,
) {
  if (input.securityGroupIds.length < 1) {
    throw new AwsManagedComputerError(
      "AWS_SECURITY_POLICY_FAILED",
      "Managed instance has no security group",
      false,
    );
  }
  const parameters = Object.fromEntries(
    input.securityGroupIds.map((groupId, index) => [
      `GroupId.${index + 1}`,
      groupId,
    ]),
  );
  const response = await ec2Query(
    config,
    region,
    "DescribeSecurityGroups",
    parameters,
    fetcher,
  );
  for (const group of xmlItems(xmlSection(response, "securityGroupInfo"))) {
    if (xmlSection(group, "ipPermissions").includes("<item>")) {
      throw new AwsManagedComputerError(
        "AWS_SECURITY_POLICY_FAILED",
        "Managed instance security group contains an inbound rule",
        false,
      );
    }
  }
}

export async function verifyManagedInstance(
  config: ManagedComputerConfig,
  expected: ManagedInstanceExpectation,
  fetcher?: typeof fetch,
) {
  const instance = await describeManagedInstance(
    config,
    expected.region,
    expected.instanceId,
    fetcher,
  );
  if (!instance) {
    throw new AwsManagedComputerError(
      "AWS_INSTANCE_NOT_FOUND",
      "Managed instance was not found",
      true,
    );
  }
  const policyFailures = [
    instance.instanceId === expected.instanceId ? null : "instance_id",
    instance.instanceType === expected.instanceType ? null : "instance_type",
    instance.launchTemplateId === expected.launchTemplateId
      ? null
      : "launch_template_id",
    instance.launchTemplateVersion === expected.launchTemplateVersion
      ? null
      : "launch_template_version",
    instance.httpTokens === "required" ? null : "imds_v2",
    instance.encrypted ? null : "ebs_encryption",
    instance.tags["briar-managed"] === "true" ? null : "managed_tag",
    instance.tags["briar-organization"] === expected.organizationId
      ? null
      : "organization_tag",
    instance.tags["briar-managed-computer"] === expected.managedComputerId
      ? null
      : "managed_computer_tag",
    instance.tags["briar-campaign"] === expected.campaignId
      ? null
      : "campaign_tag",
  ].filter((failure): failure is string => failure !== null);
  if (policyFailures.length > 0) {
    throw new AwsManagedComputerError(
      "AWS_SECURITY_POLICY_FAILED",
      `Managed instance policy validation failed: ${policyFailures.join(", ")}`,
      false,
    );
  }
  await assertNoInboundRules(config, instance, expected.region, fetcher);
  return instance;
}

export async function managedInstanceIsSsmOnline(
  config: ManagedComputerConfig,
  region: string,
  instanceId: string,
  fetcher?: typeof fetch,
) {
  const body = JSON.stringify({
    InstanceInformationFilterList: [{
      key: "InstanceIds",
      valueSet: [instanceId],
    }],
    MaxResults: 5,
  });
  const response = await signedAwsRequest({
    service: "ssm",
    region,
    target: "AmazonSSM.DescribeInstanceInformation",
    contentType: "application/x-amz-json-1.1",
    body,
    config,
    fetcher,
  });
  const text = await response.text();
  if (!response.ok) throw awsError(text, response.status);
  const payload = await Schema.decodeUnknownPromise(Schema.Struct({
    InstanceInformationList: Schema.Array(Schema.Struct({
      InstanceId: Schema.String,
      PingStatus: Schema.String,
    })),
  }))(JSON.parse(text) as unknown).catch(() => {
    throw new AwsManagedComputerError(
      "AWS_RESPONSE_INVALID",
      "AWS Systems Manager response was invalid",
      false,
    );
  });
  return payload.InstanceInformationList.some((item) =>
    item.InstanceId === instanceId && item.PingStatus === "Online"
  );
}

export async function listTaggedManagedInstances(
  config: ManagedComputerConfig,
  fetcher?: typeof fetch,
) {
  if (!config.region) return [];
  const response = await ec2Query(config, config.region, "DescribeInstances", {
    "Filter.1.Name": "tag:briar-managed",
    "Filter.1.Value.1": "true",
    "Filter.2.Name": "instance-state-name",
    "Filter.2.Value.1": "pending",
    "Filter.2.Value.2": "running",
    "Filter.2.Value.3": "stopping",
    "Filter.2.Value.4": "stopped",
  }, fetcher);
  return xmlValues(response, "instancesSet").flatMap((instancesSet) =>
    xmlItems(instancesSet).flatMap((instance) => {
      const instanceId = Option.getOrUndefined(
        decodeInstanceId(xmlValue(instance, "instanceId")),
      );
      if (!instanceId) return [];
      return [{ instanceId, tags: tagsFromXml(instance) }];
    })
  );
}

export async function stopManagedInstance(
  config: ManagedComputerConfig,
  region: string,
  instanceId: string,
) {
  await ec2Query(config, region, "StopInstances", {
    "InstanceId.1": instanceId,
  });
}

export async function terminateManagedInstance(
  config: ManagedComputerConfig,
  region: string,
  instanceId: string,
) {
  await ec2Query(config, region, "TerminateInstances", {
    "InstanceId.1": instanceId,
  });
}
