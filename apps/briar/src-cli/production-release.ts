import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { verifyReleaseManifest } from "./release-manifest";

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const updaterPublicKeyPattern = /^untrusted comment: minisign public key[^\n]*\n[A-Za-z0-9+/=]{40,}\s*$/u;
const requiredProductionSecrets = [
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "KEYCHAIN_PASSWORD",
  "APPLE_API_KEY_CONTENT",
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
] as const;
const requiredProductionConfig = ["APPLE_API_KEY", "APPLE_API_ISSUER"] as const;
const requiredPublishingSecrets = ["CLOUDFLARE_API_TOKEN"] as const;
const requiredPublishingConfig = ["CLOUDFLARE_ACCOUNT_ID"] as const;

function requireSemver(version: string) {
  if (!semverPattern.test(version)) throw new Error("version must be stable SemVer.");
}

function requireHttpsUrl(value: string, name: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    ["localhost", "127.0.0.1"].includes(url.hostname)
  ) {
    throw new Error(`${name} must be a public HTTPS URL without credentials.`);
  }
  return url;
}

export function validateProductionEnvironment(
  env: NodeJS.ProcessEnv,
  version: string,
  mode: "build" | "publish" = "build",
) {
  requireSemver(version);
  const required =
    mode === "publish" ? requiredPublishingSecrets : requiredProductionSecrets;
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing Production secrets: ${missing.join(", ")}`);
  }
  const requiredConfig =
    mode === "publish" ? requiredPublishingConfig : requiredProductionConfig;
  const missingConfig = requiredConfig.filter((name) => !env[name]?.trim());
  if (missingConfig.length > 0) {
    throw new Error(`Missing Production config: ${missingConfig.join(", ")}`);
  }
  productionUpdaterConfig(env);
}

export function productionUpdaterConfig(env: NodeJS.ProcessEnv) {
  const pubkey = env.BRIAR_UPDATER_PUBLIC_KEY?.trim() ?? "";
  let decodedPublicKey = "";
  try {
    decodedPublicKey = Buffer.from(pubkey, "base64").toString("utf8");
  } catch {
    // The validation below returns the stable, user-facing error.
  }
  if (
    !pubkey ||
    Buffer.from(decodedPublicKey, "utf8").toString("base64").replace(/=+$/u, "") !==
      pubkey.replace(/=+$/u, "") ||
    !updaterPublicKeyPattern.test(decodedPublicKey) ||
    decodedPublicKey.includes("SECRET-KEY")
  ) {
    throw new Error(
      "BRIAR_UPDATER_PUBLIC_KEY must be the base64-encoded minisign public key emitted by the Tauri signer.",
    );
  }
  const endpoint = env.BRIAR_UPDATE_ENDPOINT?.trim() ?? "";
  const parsed = requireHttpsUrl(endpoint, "BRIAR_UPDATE_ENDPOINT");
  if (!parsed.pathname.endsWith("/releases/latest.json")) {
    throw new Error("BRIAR_UPDATE_ENDPOINT must end with /releases/latest.json.");
  }
  const signingIdentity = env.APPLE_SIGNING_IDENTITY?.trim();
  const bundle = signingIdentity
    ? {
        createUpdaterArtifacts: true,
        macOS: { signingIdentity },
      }
    : { createUpdaterArtifacts: true };
  return {
    bundle,
    plugins: { updater: { pubkey, endpoints: [endpoint] } },
  };
}

async function sha256(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

const productionArtifactNames = (version: string) =>
  new Set([
    "Briar.app.tar.gz",
    "Briar.app.tar.gz.sig",
    `Briar_${version}_aarch64.dmg`,
    `Briar_${version}_macos.app.zip`,
    "SHA256SUMS",
    "briar.spdx.json",
    "briar.spdx.json.sig",
    "latest.json",
    "lifecycle-evidence.json",
    "lifecycle-evidence.json.sig",
    "provenance.intoto.jsonl",
    "provenance.intoto.jsonl.sig",
    "release-manifest.json",
  ]);

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

async function jsonFile(path: string, name: string) {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new Error(`${name} must contain valid JSON.`);
  }
}

export async function verifyProductionArtifacts(input: {
  root: string;
  version: string;
  commitSha: string;
  baseUrl: string;
}) {
  requireSemver(input.version);
  if (!/^[0-9a-f]{40}$/u.test(input.commitSha)) {
    throw new Error("commitSha must be a full Git SHA.");
  }
  const expectedNames = productionArtifactNames(input.version);
  const entries = await readdir(input.root, { withFileTypes: true });
  const actualNames = new Set(
    entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
  );
  const missing = [...expectedNames].filter((name) => !actualNames.has(name));
  const unexpected = [...actualNames].filter((name) => !expectedNames.has(name));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Production artifact set mismatch; missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}.`,
    );
  }

  const checksumLines = (await readFile(join(input.root, "SHA256SUMS"), "utf8"))
    .trim()
    .split(/\r?\n/u);
  const checksums = new Map<string, string>();
  for (const line of checksumLines) {
    const match = /^([0-9a-f]{64})  \.\/([^/]+)$/u.exec(line);
    if (!match || checksums.has(match[2])) {
      throw new Error("SHA256SUMS contains an invalid or duplicate entry.");
    }
    checksums.set(match[2], match[1]);
  }
  const checksumNames = new Set([...expectedNames].filter((name) => name !== "SHA256SUMS"));
  if (
    checksums.size !== checksumNames.size ||
    [...checksumNames].some((name) => !checksums.has(name))
  ) {
    throw new Error("SHA256SUMS must cover every Production artifact exactly once.");
  }
  for (const [name, digest] of checksums) {
    if ((await sha256(join(input.root, name))) !== digest) {
      throw new Error(`Production artifact checksum mismatch: ${name}`);
    }
  }

  const manifest = await verifyReleaseManifest(input.root);
  if (
    manifest.version !== input.version ||
    manifest.channel !== "stable" ||
    manifest.commitSha !== input.commitSha
  ) {
    throw new Error("Release manifest does not match the Production tag and commit.");
  }

  const baseUrl = requireHttpsUrl(input.baseUrl, "baseUrl").toString().replace(/\/$/u, "");
  const latest = objectValue(
    await jsonFile(join(input.root, "latest.json"), "latest.json"),
    "latest.json",
  );
  const platforms = objectValue(latest.platforms, "latest.json platforms");
  const darwin = objectValue(platforms["darwin-aarch64"], "darwin-aarch64 updater");
  if (
    latest.version !== input.version ||
    darwin.url !== `${baseUrl}/v${input.version}/Briar.app.tar.gz` ||
    typeof darwin.signature !== "string" ||
    darwin.signature.trim() !==
      (await readFile(join(input.root, "Briar.app.tar.gz.sig"), "utf8")).trim()
  ) {
    throw new Error("Updater metadata does not match the verified Production artifacts.");
  }

  const provenance = objectValue(
    await jsonFile(join(input.root, "provenance.intoto.jsonl"), "provenance"),
    "provenance",
  );
  const predicate = objectValue(provenance.predicate, "provenance predicate");
  const buildDefinition = objectValue(
    predicate.buildDefinition,
    "provenance build definition",
  );
  const externalParameters = objectValue(
    buildDefinition.externalParameters,
    "provenance external parameters",
  );
  if (
    externalParameters.version !== input.version ||
    externalParameters.commitSha !== input.commitSha
  ) {
    throw new Error("Provenance does not match the Production tag and commit.");
  }
  const subjects = Array.isArray(provenance.subject) ? provenance.subject : [];
  const subjectDigests = new Map<string, string>();
  for (const subjectValue of subjects) {
    const subject = objectValue(subjectValue, "provenance subject");
    const digest = objectValue(subject.digest, "provenance subject digest");
    if (typeof subject.name === "string" && typeof digest.sha256 === "string") {
      subjectDigests.set(subject.name, digest.sha256);
    }
  }
  for (const name of [
    "Briar.app.tar.gz",
    "Briar.app.tar.gz.sig",
    `Briar_${input.version}_aarch64.dmg`,
    `Briar_${input.version}_macos.app.zip`,
    "briar.spdx.json",
    "latest.json",
    "release-manifest.json",
  ]) {
    if (subjectDigests.get(name) !== checksums.get(name)) {
      throw new Error(`Provenance digest mismatch: ${name}`);
    }
  }

  const lifecycle = objectValue(
    await jsonFile(join(input.root, "lifecycle-evidence.json"), "lifecycle evidence"),
    "lifecycle evidence",
  );
  if (
    lifecycle.result !== "passed" ||
    lifecycle.candidateVersion !== input.version ||
    lifecycle.candidateSignature !== "developer-id-notarized-gatekeeper" ||
    lifecycle.checksumsVerified !== true ||
    lifecycle.candidateManifestVerified !== true ||
    lifecycle.statePreserved !== true
  ) {
    throw new Error("Lifecycle evidence does not contain the Production acceptance gate.");
  }
  return { manifest, latest, provenance, lifecycle };
}

async function singleFile(root: string, suffix: string) {
  const matches = (await readdir(root)).filter((name) => name.endsWith(suffix));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${suffix} file; found ${matches.length}.`);
  }
  return matches[0];
}

export async function generateProductionMetadata(input: {
  root: string;
  version: string;
  baseUrl: string;
  repository: string;
  commitSha: string;
  releasedAt: string;
  builderId: string;
  invocationId: string;
}) {
  requireSemver(input.version);
  const baseUrl = requireHttpsUrl(input.baseUrl, "baseUrl").toString().replace(/\/$/u, "");
  if (!/^[0-9a-f]{40}$/u.test(input.commitSha)) {
    throw new Error("commitSha must be a full Git SHA.");
  }
  const updaterName = await singleFile(input.root, ".app.tar.gz");
  const signatureName = `${updaterName}.sig`;
  const signature = (await readFile(join(input.root, signatureName), "utf8")).trim();
  if (!signature) throw new Error("Updater signature is empty.");

  const latest = {
    version: input.version,
    notes: `Briar ${input.version}`,
    pub_date: input.releasedAt,
    platforms: {
      "darwin-aarch64": {
        signature,
        url: `${baseUrl}/v${input.version}/${encodeURIComponent(updaterName)}`,
      },
    },
  };
  await writeFile(join(input.root, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`);

  const excluded = new Set(["SHA256SUMS", "provenance.intoto.jsonl", "provenance.intoto.jsonl.sig"]);
  const subjects = [];
  for (const name of (await readdir(input.root)).sort()) {
    if (excluded.has(name)) continue;
    const path = join(input.root, name);
    const metadata = await stat(path);
    if (!metadata.isFile()) continue;
    subjects.push({ name, digest: { sha256: await sha256(path) } });
  }
  const provenance = {
    _type: "https://in-toto.io/Statement/v1",
    subject: subjects,
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://github.com/wordbricks/briar/blob/main/docs/operations/production-release.md#local-production-release-v1",
        externalParameters: {
          repository: input.repository,
          commitSha: input.commitSha,
          version: input.version,
        },
        internalParameters: {},
        resolvedDependencies: [
          { uri: `git+https://github.com/${input.repository}@${input.commitSha}` },
        ],
      },
      runDetails: {
        builder: { id: input.builderId },
        metadata: { invocationId: input.invocationId },
        byproducts: [],
      },
    },
  };
  await writeFile(
    join(input.root, "provenance.intoto.jsonl"),
    `${JSON.stringify(provenance)}\n`,
  );
  return { latest, provenance };
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredArgument(name: string) {
  const value = argument(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

if (import.meta.main) {
  const command = process.argv[2];
  const version = requiredArgument("--version");
  if (command === "preflight") {
    validateProductionEnvironment(
      process.env,
      version,
      process.argv.includes("--publish") ? "publish" : "build",
    );
    console.log(`Production preflight passed for Briar v${version}.`);
  } else if (command === "config") {
    const output = requiredArgument("--output");
    await writeFile(output, `${JSON.stringify(productionUpdaterConfig(process.env), null, 2)}\n`);
    console.log(`Wrote secret-free Production Tauri config to ${basename(output)}.`);
  } else if (command === "metadata") {
    const commitSha =
      process.env.BRIAR_RELEASE_COMMIT ??
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const releasedAt = execFileSync(
      "git",
      ["show", "-s", "--format=%cI", commitSha],
      { encoding: "utf8" },
    ).trim();
    await generateProductionMetadata({
      root: requiredArgument("--root"),
      version,
      baseUrl: requiredArgument("--base-url"),
      repository: process.env.BRIAR_RELEASE_REPOSITORY ?? "wordbricks/briar",
      commitSha,
      releasedAt,
      builderId:
        process.env.BRIAR_RELEASE_BUILDER_ID ??
        "https://github.com/wordbricks/briar/blob/main/scripts/release-macos-production.sh",
      invocationId:
        process.env.BRIAR_RELEASE_INVOCATION_ID ??
        `local:v${version}:${commitSha}`,
    });
    console.log(`Generated updater and provenance metadata for Briar v${version}.`);
  } else if (command === "verify-artifacts") {
    await verifyProductionArtifacts({
      root: requiredArgument("--root"),
      version,
      commitSha: requiredArgument("--commit-sha"),
      baseUrl: requiredArgument("--base-url"),
    });
    console.log(`Verified reusable Production artifacts for Briar v${version}.`);
  } else {
    throw new Error("Expected preflight, config, metadata, or verify-artifacts command.");
  }
}
