import { describe, expect, it } from "vitest";
import {
  managedComputerCredential,
  managedComputerEnrollmentNonce,
  normalizePromotionCode,
  promotionCodesEqual,
  verifyEc2IdentityDocumentSignature,
} from "./managed-computer-crypto";

function base64(value: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(value)));
}

describe("managed computer promotion and enrollment crypto", () => {
  it("normalizes case and surrounding whitespace only on the server", async () => {
    expect(normalizePromotionCode("  getbriar\n")).toBe("GETBRIAR");
    await expect(promotionCodesEqual(" getbriar ", "GETBRIAR")).resolves.toBe(
      true,
    );
    await expect(promotionCodesEqual("GET-BRIAR", "GETBRIAR")).resolves.toBe(
      false,
    );
  });

  it("derives retry-stable one-time material without storing a raw secret", async () => {
    const first = await managedComputerEnrollmentNonce(
      "server-secret",
      "11111111-1111-4111-8111-111111111111",
    );
    const second = await managedComputerEnrollmentNonce(
      "server-secret",
      "11111111-1111-4111-8111-111111111111",
    );
    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const credential = await managedComputerCredential(
      "server-secret",
      "11111111-1111-4111-8111-111111111111",
      first,
    );
    expect(credential).toMatch(/^briar_worker_[A-Za-z0-9_-]{43}$/u);
    expect(credential).not.toContain("server-secret");
  });

  it("cryptographically verifies the exact raw EC2 identity document", async () => {
    const pair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const document = '{"instanceId":"i-0123456789abcdef0"}\n';
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      pair.privateKey,
      new TextEncoder().encode(document),
    );
    const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
    const publicKey = [
      "-----BEGIN PUBLIC KEY-----",
      base64(spki),
      "-----END PUBLIC KEY-----",
    ].join("\n");
    await expect(verifyEc2IdentityDocumentSignature(
      publicKey,
      document,
      base64(signature),
    )).resolves.toBe(true);
    await expect(verifyEc2IdentityDocumentSignature(
      publicKey,
      `${document} `,
      base64(signature),
    )).resolves.toBe(false);
  });
});
