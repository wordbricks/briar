import { describe, expect, it } from "vitest";
import {
  decodeInstanceIdentityDocument,
} from "./managed-computer-request-contract";

describe("EC2 identity document contract", () => {
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
