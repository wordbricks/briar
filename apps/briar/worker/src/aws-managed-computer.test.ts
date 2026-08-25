import { describe, expect, it, vi } from "vitest";
import {
  runManagedInstance,
  verifyManagedInstance,
} from "./aws-managed-computer";
import type { ManagedComputerConfig } from "./managed-computer-model";

const config: ManagedComputerConfig = {
  applicationsEnabled: true,
  remoteDesktopEnabled: false,
  remoteDesktopAllowedOrigins: [],
  remoteDesktopTokenTtlSeconds: 60,
  remoteDesktopMaxSessionMinutes: 60,
  remoteDesktopOrganizationSessionLimit: 2,
  remoteDesktopFleetSessionLimit: 20,
  remoteDesktopRateLimit: 10,
  campaignId: "getbriar-pilot",
  promotionCampaigns: [{ id: "getbriar-pilot", code: "GETBRIAR" }],
  organizationLimit: 1,
  fleetLimit: 10,
  lifetimeDays: 30,
  stoppedRetentionDays: 7,
  enrollmentTtlMinutes: 30,
  setupTtlMinutes: 10,
  region: "us-east-1",
  launchTemplateId: "lt-0123456789abcdef0",
  launchTemplateVersion: "7",
  instanceType: "m7i.large",
  volumeGiB: 100,
  vcpu: 2,
  memoryGiB: 8,
  apiOrigin: "https://briar.example.com",
  enrollmentSecret: "enrollment-secret",
  awsIdentityPublicKey: "test-public-key",
  awsAccessKeyId: "AKIAEXAMPLE",
  awsSecretAccessKey: "secret-access-key",
  awsSessionToken: "session-token",
};

const instanceXml = (
  httpTokens = "required",
  launchTemplate = `<launchTemplate><launchTemplateId>lt-0123456789abcdef0</launchTemplateId><version>7</version></launchTemplate>`,
  launchTemplateTags = "",
) => `
<DescribeInstancesResponse><reservationSet><item><instancesSet><item>
  <instanceId>i-0123456789abcdef0</instanceId>
  <instanceType>m7i.large</instanceType>
  <instanceState><name>running</name></instanceState>
  ${launchTemplate}
  <metadataOptions><httpTokens>${httpTokens}</httpTokens></metadataOptions>
  <blockDeviceMapping><item><ebs><volumeId>vol-0123456789abcdef0</volumeId><encrypted>true</encrypted></ebs></item></blockDeviceMapping>
  <groupSet><item><groupId>sg-0123456789abcdef0</groupId></item></groupSet>
  <tagSet>
    <item><key>briar-managed</key><value>true</value></item>
    <item><key>briar-organization</key><value>11111111-1111-4111-8111-111111111111</value></item>
    <item><key>briar-managed-computer</key><value>22222222-2222-4222-8222-222222222222</value></item>
    <item><key>briar-campaign</key><value>getbriar-pilot</value></item>
    ${launchTemplateTags}
  </tagSet>
</item></instancesSet></item></reservationSet></DescribeInstancesResponse>`;

const volumeXml = `
<DescribeVolumesResponse><volumeSet><item>
  <volumeId>vol-0123456789abcdef0</volumeId><encrypted>true</encrypted>
</item></volumeSet></DescribeVolumesResponse>`;

describe("AWS managed computer adapter", () => {
  it("launches from only the pinned template with an idempotent client token", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /u);
      expect(headers.get("x-amz-security-token")).toBe("session-token");
      return new Response(
        "<RunInstancesResponse><instancesSet><item><instanceId>i-0123456789abcdef0</instanceId></item></instancesSet></RunInstancesResponse>",
      );
    });
    await expect(runManagedInstance(config, {
      managedComputerId: "22222222-2222-4222-8222-222222222222",
      organizationId: "11111111-1111-4111-8111-111111111111",
      campaignId: "getbriar-pilot",
      nonce: "n".repeat(43),
    }, fetcher as typeof fetch)).resolves.toBe("i-0123456789abcdef0");
    const body = String(fetcher.mock.calls[0]?.[1]?.body);
    const parameters = new URLSearchParams(body);
    expect(parameters.get("ClientToken")).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(parameters.get("LaunchTemplate.LaunchTemplateId")).toBe(
      "lt-0123456789abcdef0",
    );
    expect(parameters.get("LaunchTemplate.Version")).toBe("7");
    expect(parameters.has("InstanceType")).toBe(false);
    expect(parameters.get("TagSpecification.1.Tag.3.Value")).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    const userData = atob(parameters.get("UserData") ?? "");
    expect(userData).toContain("managed-enrollment.json");
    expect(userData).toContain("n".repeat(43));
    expect(userData).not.toContain("briar_worker_");
    expect(userData).not.toContain("secret-access-key");
  });

  it("requires encrypted storage, IMDSv2, pinned template, tags, and no inbound rules", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(instanceXml()))
      .mockResolvedValueOnce(new Response(volumeXml))
      .mockResolvedValueOnce(new Response(
        "<DescribeSecurityGroupsResponse><securityGroupInfo><item><groupId>sg-0123456789abcdef0</groupId><ipPermissions></ipPermissions></item></securityGroupInfo></DescribeSecurityGroupsResponse>",
      ));
    await expect(verifyManagedInstance(config, {
      managedComputerId: "22222222-2222-4222-8222-222222222222",
      organizationId: "11111111-1111-4111-8111-111111111111",
      campaignId: "getbriar-pilot",
      instanceId: "i-0123456789abcdef0",
      region: "us-east-1",
      launchTemplateId: "lt-0123456789abcdef0",
      launchTemplateVersion: "7",
      instanceType: "m7i.large",
    }, fetcher as typeof fetch)).resolves.toMatchObject({
      encrypted: true,
      httpTokens: "required",
      volumeId: "vol-0123456789abcdef0",
    });
  });

  it("uses AWS launch template tags when the response omits launchTemplate", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(instanceXml(
        "required",
        "",
        `
    <item><key>aws:ec2launchtemplate:id</key><value>lt-0123456789abcdef0</value></item>
    <item><key>aws:ec2launchtemplate:version</key><value>7</value></item>`,
      )))
      .mockResolvedValueOnce(new Response(volumeXml))
      .mockResolvedValueOnce(new Response(
        "<DescribeSecurityGroupsResponse><securityGroupInfo><item><groupId>sg-0123456789abcdef0</groupId><ipPermissions></ipPermissions></item></securityGroupInfo></DescribeSecurityGroupsResponse>",
      ));
    await expect(verifyManagedInstance(config, {
      managedComputerId: "22222222-2222-4222-8222-222222222222",
      organizationId: "11111111-1111-4111-8111-111111111111",
      campaignId: "getbriar-pilot",
      instanceId: "i-0123456789abcdef0",
      region: "us-east-1",
      launchTemplateId: "lt-0123456789abcdef0",
      launchTemplateVersion: "7",
      instanceType: "m7i.large",
    }, fetcher as typeof fetch)).resolves.toMatchObject({
      launchTemplateId: "lt-0123456789abcdef0",
      launchTemplateVersion: "7",
    });
  });

  it("fails closed when IMDSv2 is optional", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(instanceXml("optional")))
      .mockResolvedValueOnce(new Response(volumeXml));
    await expect(verifyManagedInstance(config, {
      managedComputerId: "22222222-2222-4222-8222-222222222222",
      organizationId: "11111111-1111-4111-8111-111111111111",
      campaignId: "getbriar-pilot",
      instanceId: "i-0123456789abcdef0",
      region: "us-east-1",
      launchTemplateId: "lt-0123456789abcdef0",
      launchTemplateVersion: "7",
      instanceType: "m7i.large",
    }, fetcher as typeof fetch)).rejects.toMatchObject({
      code: "AWS_SECURITY_POLICY_FAILED",
    });
  });
});
