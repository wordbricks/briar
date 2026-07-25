import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

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
  publish = false,
) {
  requireSemver(version);
  const required = publish
    ? [...requiredProductionSecrets, ...requiredPublishingSecrets]
    : requiredProductionSecrets;
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing Production secrets: ${missing.join(", ")}`);
  }
  const requiredConfig = publish
    ? [...requiredProductionConfig, ...requiredPublishingConfig]
    : requiredProductionConfig;
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
  return {
    bundle: {
      createUpdaterArtifacts: true,
      ...(signingIdentity
        ? { macOS: { signingIdentity } }
        : {}),
    },
    plugins: { updater: { pubkey, endpoints: [endpoint] } },
  };
}

async function sha256(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
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
    validateProductionEnvironment(process.env, version, process.argv.includes("--publish"));
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
  } else {
    throw new Error("Expected preflight, config, or metadata command.");
  }
}
