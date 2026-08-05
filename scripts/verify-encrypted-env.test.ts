import { describe, expect, it } from "vitest";
import {
  encryptedEnvPolicies,
  verifyEncryptedEnv,
} from "./verify-encrypted-env";

const policy = {
  publicKey: "DOTENV_PUBLIC_KEY_TEST",
  secrets: ["FIRST_SECRET", "SECOND_SECRET"],
} as const;
const publicKey = `02${"a".repeat(64)}`;

function fixture(overrides: Partial<Record<string, string>> = {}) {
  const values = {
    DOTENV_PUBLIC_KEY_TEST: publicKey,
    FIRST_SECRET: "encrypted:abc123+/=",
    SECOND_SECRET: "encrypted:def456+/=",
    ...overrides,
  };
  return Object.entries(values)
    .map(([key, value]) => `${key}="${value}"`)
    .join("\n");
}

describe("encrypted environment verification", () => {
  it("requires integration production settings to remain encrypted", () => {
    expect(encryptedEnvPolicies[".env.production"]?.secrets).toEqual(
      expect.arrayContaining([
        "SLACK_CLIENT_ID",
        "SLACK_CLIENT_SECRET",
        "SLACK_SIGNING_SECRET",
        "SLACK_TOKEN_ENCRYPTION_KEY",
      ]),
    );
    expect(encryptedEnvPolicies[".env.production"]?.optionalSecrets).toEqual(
      expect.arrayContaining([
        "GITHUB_APP_CLIENT_ID",
        "GITHUB_APP_CLIENT_SECRET",
        "GITHUB_APP_SLUG",
        "GITHUB_CALLBACK_ORIGIN",
        "GITHUB_WEBHOOK_SECRET",
      ]),
    );
  });

  it("allows an encrypted optional secret and rejects plaintext", () => {
    const optionalPolicy = {
      ...policy,
      optionalSecrets: ["OPTIONAL_SECRET"],
    } as const;
    expect(() =>
      verifyEncryptedEnv(".env.test", fixture(), optionalPolicy)
    ).not.toThrow();
    expect(() =>
      verifyEncryptedEnv(
        ".env.test",
        `${fixture()}\nOPTIONAL_SECRET="encrypted:ghi789+/="`,
        optionalPolicy,
      )
    ).not.toThrow();
    expect(() =>
      verifyEncryptedEnv(
        ".env.test",
        `${fixture()}\nOPTIONAL_SECRET="plaintext"`,
        optionalPolicy,
      )
    ).toThrow("requires encrypted ciphertext for OPTIONAL_SECRET");
  });

  it("accepts a public key and encrypted secret values", () => {
    expect(() => verifyEncryptedEnv(".env.test", fixture(), policy)).not.toThrow();
  });

  it("rejects plaintext and empty secret values", () => {
    expect(() =>
      verifyEncryptedEnv(".env.test", fixture({ FIRST_SECRET: "plaintext" }), policy),
    ).toThrow("requires encrypted ciphertext for FIRST_SECRET");
    expect(() =>
      verifyEncryptedEnv(".env.test", fixture({ SECOND_SECRET: "" }), policy),
    ).toThrow("requires encrypted ciphertext for SECOND_SECRET");
  });

  it("rejects unexpected variables and duplicate assignments", () => {
    expect(() =>
      verifyEncryptedEnv(
        ".env.test",
        `${fixture()}\nDOTENV_PRIVATE_KEY_TEST="must-not-be-committed"`,
        policy,
      ),
    ).toThrow("contains unexpected DOTENV_PRIVATE_KEY_TEST");
    expect(() =>
      verifyEncryptedEnv(".env.test", `${fixture()}\nFIRST_SECRET="encrypted:again"`, policy),
    ).toThrow("contains duplicate FIRST_SECRET");
  });
});
