import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { arch } from "node:os";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { cliVersion } from "./command-support";
import { compareSemanticVersions } from "../src/lib/semantic-version";
import { sandboxRuntimeAssets } from "./sandbox-runtime-assets";
import {
  type SandboxRuntime, type SandboxActivation, type SandboxUpdateRequest,
  type SandboxUpdateProvider, sandboxRuntimeEnvironment, writeSandboxJson,
} from "./sandbox-update-state";

const Version = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/u));
const decodeVersion = Schema.decodeUnknownSync(Version);
const NpmRelease = Schema.Struct({
  name: Schema.String,
  version: Version,
  dist: Schema.Struct({ tarball: Schema.String, integrity: Schema.String }),
});
const GithubRelease = Schema.Struct({
  tag_name: Schema.String,
  prerelease: Schema.Boolean,
  assets: Schema.Array(Schema.Struct({
    name: Schema.String, browser_download_url: Schema.String,
    digest: Schema.NullOr(Schema.String),
  })),
});
export type SandboxArtifact = {
  provider: SandboxUpdateProvider;
  version: string;
  url: string;
  integrity?: string;
  packageName?: string;
};
export type SandboxUpdatePlan = {
  briarVersion: string;
  updateBriar: boolean;
  artifacts: SandboxArtifact[];
};
const npmPackages = { codex: "@openai/codex", claude: "@anthropic-ai/claude-code" } as const;

export function runSandboxProgram(command: string, args: string[], options: {
  cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number;
} = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, options.timeoutMs ?? 120_000);
    child.stdout.on("data", (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(-1_000_000); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8_000); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || timedOut) reject(new Error(`${command} ${timedOut ? "timed out" : "failed"}: ${stderr.trim()}`));
      else resolve(stdout.trim());
    });
  });
}

async function releaseText(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "Briar-Sandbox-Updater" } });
  if (!response.ok) throw new Error(`Release metadata returned HTTP ${response.status}: ${url}`);
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error("Release metadata is too large");
  return text;
}

export function sandboxArtifactUrl(raw: string, hosts: readonly string[]) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !hosts.includes(url.hostname) || url.username || url.password || url.port) {
    throw new Error("Untrusted sandbox artifact URL");
  }
  return url.href;
}

export async function resolveSandboxUpdatePlan(input: {
  request: SandboxUpdateRequest; before: SandboxActivation; apiUrl: string;
  installed: readonly SandboxUpdateProvider[];
}): Promise<SandboxUpdatePlan> {
  const architecture = arch();
  if (architecture !== "arm64" && architecture !== "x64") throw new Error("Unsupported sandbox architecture");
  const currentBriar = input.before.runtime.versions.briar ?? cliVersion;
  const requestedTarget = input.request.provider ? currentBriar : input.request.targetVersion ??
    Schema.decodeUnknownSync(Schema.Struct({ version: Version }))(
      JSON.parse(await releaseText(`${input.apiUrl}/releases/latest.json`)),
    ).version;
  const target = compareSemanticVersions(requestedTarget, currentBriar) < 0 ? currentBriar : requestedTarget;
  const providers = input.request.provider ? [input.request.provider] : input.installed;
  const artifacts: SandboxArtifact[] = [];
  for (const provider of providers) {
    if (provider === "codex" || provider === "claude") {
      const packageName = npmPackages[provider];
      const release = Schema.decodeUnknownSync(NpmRelease)(JSON.parse(
        await releaseText(`https://registry.npmjs.org/${packageName}/latest`),
      ));
      if (release.name !== packageName || !/^sha512-[A-Za-z0-9+/=]+$/u.test(release.dist.integrity)) {
        throw new Error(`Invalid ${provider} release integrity`);
      }
      artifacts.push({ provider, version: release.version, packageName,
        url: sandboxArtifactUrl(release.dist.tarball, ["registry.npmjs.org"]), integrity: release.dist.integrity });
    } else if (provider === "opencode") {
      const release = Schema.decodeUnknownSync(GithubRelease)(JSON.parse(
        await releaseText("https://api.github.com/repos/anomalyco/opencode/releases/latest"),
      ));
      const version = decodeVersion(release.tag_name.replace(/^v/u, ""));
      const name = architecture === "arm64" ? "opencode-linux-arm64.tar.gz" : "opencode-linux-x64-baseline.tar.gz";
      const asset = release.assets.find((item) => item.name === name);
      if (release.prerelease || !asset?.digest?.match(/^sha256:[0-9a-f]{64}$/u)) {
        throw new Error("OpenCode stable release has no verified artifact for this architecture");
      }
      artifacts.push({ provider, version, integrity: asset.digest,
        url: sandboxArtifactUrl(asset.browser_download_url, ["github.com"]) });
    } else {
      const version = decodeVersion((await releaseText("https://x.ai/cli/stable")).trim());
      // xAI's official stable endpoint does not publish an independent checksum.
      // Pin its HTTPS artifact and record the downloaded SHA-256 before activation.
      artifacts.push({ provider, version,
        url: `https://x.ai/cli/grok-${version}-linux-${architecture === "arm64" ? "aarch64" : "x86_64"}` });
    }
  }
  return { briarVersion: target, updateBriar: target !== currentBriar, artifacts: artifacts.filter((artifact) => {
    const current = input.before.runtime.versions[artifact.provider];
    return !current || !/^\d+\.\d+\.\d+$/u.test(current) || compareSemanticVersions(artifact.version, current) > 0;
  }) };
}

export async function downloadSandboxArtifact(url: string, path: string, integrity?: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!response.ok || !response.body) throw new Error(`Artifact download failed: HTTP ${response.status}`);
  const file = await open(path, "wx", 0o600);
  const sha256 = createHash("sha256"), sha512 = createHash("sha512");
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 512 * 1024 * 1024) throw new Error("Sandbox artifact exceeds 512 MiB");
      sha256.update(chunk); sha512.update(chunk);
      await file.writeFile(chunk);
    }
    await file.sync();
  } finally { await file.close(); }
  const digest = sha256.digest("hex");
  const sri = `sha512-${sha512.digest("base64")}`;
  if (integrity && integrity !== `sha256:${digest}` && integrity !== sri) {
    throw new Error("Sandbox artifact integrity mismatch");
  }
  if (bytes === 0) throw new Error("Sandbox artifact is empty");
  return `sha256:${digest}`;
}

export function safeSandboxArchiveEntry(entry: string) {
  const path = entry.replace(/^\.\//u, "");
  return !path.startsWith("/") && !path.split("/").includes("..") && !path.includes("\\");
}

async function extractSandboxArchive(archive: string, destination: string) {
  const names = await runSandboxProgram("tar", ["-tzf", archive]);
  const types = await runSandboxProgram("tar", ["-tvzf", archive]);
  if (names.split("\n").some((entry) => !safeSandboxArchiveEntry(entry)) ||
    types.split("\n").some((entry) => entry && entry[0] !== "-" && entry[0] !== "d")) {
    throw new Error("Sandbox archive contains unsafe paths or links");
  }
  await runSandboxProgram("tar", ["-xzf", archive, "-C", destination, "--no-same-owner", "--no-same-permissions"]);
}

export async function stageSandboxRuntime(input: {
  plan: SandboxUpdatePlan; before: SandboxActivation; apiUrl: string; root: string;
}): Promise<SandboxRuntime> {
  const id = randomUUID();
  const directory = join(input.root, "releases", id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let versions: SandboxRuntime["versions"] = { ...input.before.runtime.versions, briar: input.plan.briarVersion };
  const integrity = { ...input.before.runtime.integrity };
  let cli = input.before.runtime.cli;
  const paths: string[] = [];
  if (input.plan.updateBriar) {
    // This signed bundle contains JS, runners and Skills, not an x86 executable.
    const archiveName = `briar-managed-runtime-${input.plan.briarVersion}-linux-x86_64.tar.gz`;
    const url = `${input.apiUrl}/releases/v${input.plan.briarVersion}/${archiveName}`;
    const archive = join(directory, "runtime.tar.gz");
    integrity.briar = await downloadSandboxArtifact(url, archive);
    const signature = await releaseText(`${url}.sig`);
    await writeFile(`${archive}.sig`, signature.startsWith("untrusted comment:")
      ? signature : Buffer.from(signature.trim(), "base64"), { mode: 0o600 });
    const publicKey = join(directory, "runtime.pub");
    await writeFile(publicKey, sandboxRuntimeAssets.runtimePublicKey, { mode: 0o600 });
    await runSandboxProgram("minisign", ["-Vm", archive, "-x", `${archive}.sig`, "-p", publicKey]);
    const runtimeRoot = join(directory, "briar");
    await mkdir(runtimeRoot);
    await extractSandboxArchive(archive, runtimeRoot);
    const manifest = Schema.decodeUnknownSync(Schema.Struct({
      schemaVersion: Schema.Literal(1), version: Version,
      sourceCommit: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/u)),
      platform: Schema.Literal("linux-x86_64"),
    }))(JSON.parse(await readFile(join(runtimeRoot, "manifest.json"), "utf8")));
    if (manifest.version !== input.plan.briarVersion) throw new Error("Runtime manifest version mismatch");
    for (const runner of ["codex", "claude", "grok", "opencode", "agy", "cursor", "pi"]) {
      if (!(await readFile(join(runtimeRoot, "lib", "agent", `${runner}-runner.js`))).length) throw new Error("Runtime runner is empty");
    }
    if (!(await readFile(join(runtimeRoot, "lib", "agent", "computer-use-mcp-server.js"))).length) {
      throw new Error("Runtime Computer Use bundle is empty");
    }
    for (const skill of ["briar-workflow", "browser"]) {
      if ((await readFile(join(runtimeRoot, "skills", skill, "VERSION"), "utf8")).trim() !== manifest.version) {
        throw new Error("Runtime Skill version mismatch");
      }
    }
    cli = join(runtimeRoot, "bin", "briar");
    await chmod(cli, 0o755);
    if (await runSandboxProgram(cli, ["version"]) !== `briar ${manifest.version}`) throw new Error("Briar runtime self-check failed");
  }
  for (const artifact of input.plan.artifacts) {
    const providerRoot = join(directory, artifact.provider);
    await mkdir(providerRoot);
    const archive = join(providerRoot, "download");
    integrity[artifact.provider] = await downloadSandboxArtifact(artifact.url, archive, artifact.integrity);
    let binDirectory: string;
    if (artifact.packageName) {
      const tarball = `${archive}.tgz`;
      await rename(archive, tarball);
      await writeSandboxJson(join(providerRoot, "package.json"), {
        private: true, dependencies: { [artifact.packageName]: `file:${tarball}` },
      });
      await runSandboxProgram("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org"], {
        cwd: providerRoot, timeoutMs: 300_000,
      });
      binDirectory = join(providerRoot, "node_modules", ".bin");
      if (artifact.provider === "claude") {
        // Current Claude npm releases use a native optional package. Its default
        // .bin target is a placeholder until postinstall runs. Use the exact,
        // npm-integrity-verified native package directly without lifecycle scripts.
        const nativeName = `@anthropic-ai/claude-code-linux-${arch()}`;
        binDirectory = join(providerRoot, "node_modules", nativeName);
        const nativePackage = Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String, version: Version }))(
          JSON.parse(await readFile(join(binDirectory, "package.json"), "utf8")),
        );
        if (nativePackage.name !== nativeName || nativePackage.version !== artifact.version) {
          throw new Error("Claude native package version mismatch");
        }
      }
    } else {
      binDirectory = join(providerRoot, "bin");
      await mkdir(binDirectory);
      if (artifact.provider === "opencode") await extractSandboxArchive(archive, binDirectory);
      else await rename(archive, join(binDirectory, artifact.provider));
      await chmod(join(binDirectory, artifact.provider), 0o755);
    }
    const output = await runSandboxProgram(join(binDirectory, artifact.provider), ["--version"], {
      env: { ...process.env, ...sandboxRuntimeEnvironment(input.before) }, timeoutMs: 30_000,
    });
    if (output.match(/\b\d+\.\d+\.\d+\b/u)?.[0] !== artifact.version) throw new Error(`${artifact.provider} version self-check failed`);
    paths.push(binDirectory);
    versions = { ...versions, [artifact.provider]: artifact.version };
  }
  const runtime: SandboxRuntime = {
    id, cli, paths: [...paths, ...input.before.runtime.paths], versions, integrity,
  };
  await writeSandboxJson(join(directory, "manifest.json"), runtime);
  return runtime;
}
