import { describe, expect, it } from "vitest";
import {
  decodeInstanceIdentityDocument,
  decodeManagedComputerApplication,
  decodeManagedComputerEnrollment,
} from "./managed-computer-request-contract";

describe("managed computer request contract", () => {
  it("accepts only a promotion code and idempotent request ID", () => {
    expect(decodeManagedComputerApplication({
      code: " GETBRIAR ",
      requestId: "11111111-1111-4111-8111-111111111111",
    })).toEqual({
      code: "GETBRIAR",
      requestId: "11111111-1111-4111-8111-111111111111",
    });
    expect(() => decodeManagedComputerApplication({
      code: "GETBRIAR",
      requestId: "11111111-1111-4111-8111-111111111111",
      region: "us-west-2",
      instanceType: "m8i.48xlarge",
      diskGiB: 16_000,
    })).toThrow();
  });

  it("rejects malformed EC2 identity and enrollment nonce inputs", () => {
    expect(() => decodeManagedComputerEnrollment({
      nonce: "not-a-valid-nonce",
      identityDocument: JSON.stringify({
        accountId: "attacker",
        architecture: "x86_64",
        availabilityZone: "us-east-1a",
        imageId: "ami-not-valid",
        instanceId: "local-machine",
        instanceType: "m7i.large",
        pendingTime: "2026-08-22T00:00:00Z",
        privateIp: "10.0.0.1",
        region: "us-east-1",
        version: "2017-09-30",
      }),
      identitySignature: "short",
      briarVersion: "1.2.146",
    })).toThrow();
  });

  it("accepts nullable AWS product fields in EC2 identity documents", () => {
    const identityDocument = {
      accountId: "123456789012",
      architecture: "x86_64",
      availabilityZone: "us-east-1a",
      billingProducts: null,
      devpayProductCodes: null,
      imageId: "ami-0123456789abcdef0",
      instanceId: "i-0123456789abcdef0",
      instanceType: "m7i.large",
      kernelId: null,
      marketplaceProductCodes: null,
      pendingTime: "2026-08-23T09:29:30Z",
      privateIp: "172.31.109.189",
      ramdiskId: null,
      region: "us-east-1",
      version: "2017-09-30",
    };

    expect(decodeInstanceIdentityDocument(identityDocument)).toEqual(
      identityDocument,
    );
  });
});
