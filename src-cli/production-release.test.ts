import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  generateProductionMetadata,
  productionUpdaterConfig,
  validateProductionEnvironment,
} from "./production-release";

const directories: string[] = [];
const publicKey = Buffer.from(
  `untrusted comment: minisign public key fixture\n${"A".repeat(56)}\n`,
).toString("base64");

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

function completeEnvironment(): NodeJS.ProcessEnv {
  return {
    APPLE_CERTIFICATE: "present",
    APPLE_CERTIFICATE_PASSWORD: "present",
    KEYCHAIN_PASSWORD: "present",
    APPLE_API_KEY: "present",
    APPLE_API_ISSUER: "present",
    APPLE_API_KEY_CONTENT: "present",
    TAURI_SIGNING_PRIVATE_KEY: "present",
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "present",
    CLOUDFLARE_API_TOKEN: "present",
    CLOUDFLARE_ACCOUNT_ID: "present",
    BRIAR_UPDATER_PUBLIC_KEY: publicKey,
    BRIAR_UPDATE_ENDPOINT: "https://briar-api.example/releases/latest.json",
    GITHUB_REF_NAME: "v1.0.0",
    GITHUB_REF_TYPE: "tag",
    GITHUB_REF_PROTECTED: "true",
  };
}

describe("Production release contract", () => {
  it("fails closed when a secret or protected exact tag is missing", () => {
    const environment = completeEnvironment();
    delete environment.APPLE_CERTIFICATE;
    expect(() => validateProductionEnvironment(environment, "1.0.0")).toThrow(
      "Missing Production secrets: APPLE_CERTIFICATE",
    );
    expect(() =>
      validateProductionEnvironment(
        { ...completeEnvironment(), GITHUB_REF_PROTECTED: "false" },
        "1.0.0",
      ),
    ).toThrow("must be protected");
  });

  it("builds a secret-free updater config", () => {
    expect(productionUpdaterConfig(completeEnvironment())).toEqual({
      bundle: { createUpdaterArtifacts: true },
      plugins: {
        updater: {
          pubkey: publicKey,
          endpoints: ["https://briar-api.example/releases/latest.json"],
        },
      },
    });
    expect(
      productionUpdaterConfig({
        ...completeEnvironment(),
        APPLE_SIGNING_IDENTITY: "Developer ID Application: Wordbricks",
      }).bundle,
    ).toEqual({
      createUpdaterArtifacts: true,
      macOS: { signingIdentity: "Developer ID Application: Wordbricks" },
    });
    expect(() =>
      productionUpdaterConfig({
        ...completeEnvironment(),
        BRIAR_UPDATER_PUBLIC_KEY:
          "untrusted comment: minisign public key fixture\nnot-base64",
      }),
    ).toThrow("base64-encoded minisign public key");
  });

  it("generates static updater and SLSA provenance metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "briar-production-release-"));
    directories.push(root);
    await writeFile(join(root, "Briar.app.tar.gz"), "signed updater archive");
    await writeFile(join(root, "Briar.app.tar.gz.sig"), "trusted signature");
    await writeFile(join(root, "briar.spdx.json"), "{}");
    const result = await generateProductionMetadata({
      root,
      version: "1.0.0",
      baseUrl: "https://briar-api.example/releases",
      repository: "wordbricks/briar",
      commitSha: "a".repeat(40),
      releasedAt: "2026-07-22T00:00:00Z",
      workflowRef: "wordbricks/briar/.github/workflows/production-release.yml@refs/tags/v1.0.0",
      invocationId: "123",
    });
    expect(result.latest.platforms["darwin-aarch64"]).toEqual({
      signature: "trusted signature",
      url: "https://briar-api.example/releases/v1.0.0/Briar.app.tar.gz",
    });
    expect(result.provenance.subject.map((subject) => subject.name)).toContain(
      "briar.spdx.json",
    );
  });
});
