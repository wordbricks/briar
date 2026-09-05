import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentProviderBinaryName,
  managedComputerSetupProviders,
} from "../src/lib/agent-provider";
import {
  debianMirror,
  resolveSandboxRuntimeSources,
  SANDBOX_CLI_PATH,
  SANDBOX_RUNTIME_ROOT,
  sandboxDockerfile,
  sandboxImageTag,
  sandboxProviderBinaryPaths,
  stageSandboxBuildContext,
} from "./sandbox-image";
import { sandboxRuntimeAssets } from "./sandbox-runtime-assets";

const directories: string[] = [];
const agentBundles = [
  "agy-runner.js",
  "claude-runner.js",
  "codex-runner.js",
  "cursor-runner.js",
  "grok-runner.js",
  "opencode-runner.js",
  "pi-runner.js",
  "computer-use-mcp-server.js",
];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

async function temporary(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

async function sources(cli = "console.log('briar')") {
  const root = await temporary("briar-sandbox-sources-");
  const cliBundlePath = join(root, "briar.js");
  const agentDirectory = join(root, "agent");
  await writeFile(cliBundlePath, cli);
  await mkdir(agentDirectory);
  for (const bundle of agentBundles) {
    await writeFile(join(agentDirectory, bundle), `// ${bundle}`);
  }
  return { root, cliBundlePath, agentDirectory };
}

describe("sandboxDockerfile", () => {
  it("pins the reviewed Bun and Node versions and never publishes ports", () => {
    const dockerfile = sandboxDockerfile();
    expect(dockerfile).toContain(`ARG BUN_VERSION=${sandboxRuntimeAssets.bunVersion}`);
    expect(dockerfile).toContain(`ARG NODE_VERSION=${sandboxRuntimeAssets.nodeVersion}`);
    expect(dockerfile).toContain("--frozen-lockfile --production --ignore-scripts");
    expect(dockerfile).toContain(`CMD ["${SANDBOX_CLI_PATH}", "sandbox", "supervise"]`);
    expect(dockerfile).toContain("USER briar");
    expect(dockerfile).not.toContain("EXPOSE");
    expect(dockerfile).not.toContain("sudo");
  });

  it("selects binaries by TARGETARCH so ARM64 hosts build natively", () => {
    const dockerfile = sandboxDockerfile();
    expect(dockerfile).toContain("arm64) bun_arch=aarch64; node_arch=arm64");
    expect(dockerfile).toContain("amd64) bun_arch=x64; node_arch=x64");
    expect(dockerfile).toContain("agent-browser-linux-arm64");
  });

  it("installs OpenCode and Grok from the pinned releases for both architectures", () => {
    const dockerfile = sandboxDockerfile();
    expect(dockerfile).toContain(
      `ARG OPENCODE_CLI_VERSION=${sandboxRuntimeAssets.opencodeCli.version}`,
    );
    expect(dockerfile).toContain(
      `ARG GROK_CLI_VERSION=${sandboxRuntimeAssets.grokCli.version}`,
    );
    expect(dockerfile).toContain(
      "https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_CLI_VERSION}/opencode-linux-x64-baseline.tar.gz",
    );
    expect(dockerfile).toContain(
      "https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_CLI_VERSION}/opencode-linux-arm64.tar.gz",
    );
    expect(dockerfile).toContain("https://x.ai/cli/grok-${GROK_CLI_VERSION}-linux-x86_64");
    expect(dockerfile).toContain("https://x.ai/cli/grok-${GROK_CLI_VERSION}-linux-aarch64");
    for (
      const sha256 of [
        sandboxRuntimeAssets.opencodeCli.sha256.amd64,
        sandboxRuntimeAssets.opencodeCli.sha256.arm64,
        sandboxRuntimeAssets.grokCli.sha256.amd64,
        sandboxRuntimeAssets.grokCli.sha256.arm64,
      ]
    ) {
      expect(sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(dockerfile).toContain(sha256);
    }
    expect(dockerfile).toContain("sha256sum -c -");
    expect(dockerfile).toContain(`install -m 0755 /tmp/briar-download/opencode ${SANDBOX_RUNTIME_ROOT}/bin/opencode`);
    expect(dockerfile).toContain(`install -m 0755 /tmp/briar-download/grok ${SANDBOX_RUNTIME_ROOT}/bin/grok`);
    // The npm package installs through a lifecycle script the provider runtime
    // refuses to run, so OpenCode must stay a pinned standalone binary.
    expect(dockerfile).not.toContain("opencode-ai");
  });

  it("carries a binary for every managed-computer provider", () => {
    const dockerfile = sandboxDockerfile();
    for (const provider of managedComputerSetupProviders) {
      expect(dockerfile).toContain(
        `${SANDBOX_RUNTIME_ROOT}/bin/${agentProviderBinaryName(provider)}`,
      );
    }
    expect(sandboxProviderBinaryPaths()).toEqual([
      `${SANDBOX_RUNTIME_ROOT}/bin/claude`,
      `${SANDBOX_RUNTIME_ROOT}/bin/codex`,
      `${SANDBOX_RUNTIME_ROOT}/bin/grok`,
      `${SANDBOX_RUNTIME_ROOT}/bin/opencode`,
    ]);
  });
});

describe("debianMirror", () => {
  it("defaults, normalizes, and rejects anything but a hostname", () => {
    expect(debianMirror(undefined)).toBe("deb.debian.org");
    expect(debianMirror(" FTP.kr.debian.org ")).toBe("ftp.kr.debian.org");
    expect(() => debianMirror("http://ftp.kr.debian.org")).toThrow("bare hostname");
    expect(() => debianMirror("mirror;rm -rf /")).toThrow("bare hostname");
  });

  it("is applied to apt sources only when it differs from the default", () => {
    expect(sandboxDockerfile()).toContain("ARG DEBIAN_MIRROR=deb.debian.org");
    expect(sandboxDockerfile()).toContain("/etc/apt/sources.list.d/debian.sources");
  });
});

describe("stageSandboxBuildContext", () => {
  it("writes every input and derives a stable content digest", async () => {
    const { cliBundlePath, agentDirectory } = await sources();
    const first = await temporary("briar-sandbox-stage-");
    const second = await temporary("briar-sandbox-stage-");
    const a = await stageSandboxBuildContext({ directory: first, cliBundlePath, agentDirectory });
    const b = await stageSandboxBuildContext({ directory: second, cliBundlePath, agentDirectory });
    expect(a.runtimeSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(a.runtimeSha256).toBe(b.runtimeSha256);
    expect(a.imageTag).toBe(sandboxImageTag(a.runtimeSha256));
    expect(await readFile(join(first, "Dockerfile"), "utf8")).toBe(sandboxDockerfile());
    expect(await readFile(join(first, "briar.js"), "utf8")).toBe("console.log('briar')");
    expect(await readFile(join(first, "provider-runtime", "bun.lock"), "utf8"))
      .toBe(sandboxRuntimeAssets.providerRuntimeBunLock);
    expect((await stat(join(first, "briar"))).mode & 0o111).not.toBe(0);
    for (const bundle of agentBundles) {
      expect(await readFile(join(first, "agent", bundle), "utf8")).toBe(`// ${bundle}`);
    }
  });

  it("changes the digest when any staged byte changes", async () => {
    const original = await sources("console.log('one')");
    const changed = await sources("console.log('two')");
    const a = await stageSandboxBuildContext({
      directory: await temporary("briar-sandbox-stage-"),
      cliBundlePath: original.cliBundlePath,
      agentDirectory: original.agentDirectory,
    });
    const b = await stageSandboxBuildContext({
      directory: await temporary("briar-sandbox-stage-"),
      cliBundlePath: changed.cliBundlePath,
      agentDirectory: changed.agentDirectory,
    });
    expect(a.runtimeSha256).not.toBe(b.runtimeSha256);
  });

  it("refuses to stage without the Computer Use bundle", async () => {
    const { cliBundlePath, agentDirectory } = await sources();
    await rm(join(agentDirectory, "computer-use-mcp-server.js"));
    await expect(stageSandboxBuildContext({
      directory: await temporary("briar-sandbox-stage-"),
      cliBundlePath,
      agentDirectory,
    })).rejects.toThrow("computer-use-mcp-server.js is missing");
  });

  it("stages the desktop files as executables beside the runtime", async () => {
    const { cliBundlePath, agentDirectory } = await sources();
    const directory = await temporary("briar-sandbox-stage-");
    await stageSandboxBuildContext({ directory, cliBundlePath, agentDirectory });
    expect((await stat(join(directory, "desktop", "briar-remote-desktop"))).mode & 0o111).not.toBe(0);
    expect(await readFile(join(directory, "desktop", "briar-computer-executor.py"), "utf8"))
      .toContain("from Xlib");
    const dockerfile = await readFile(join(directory, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("tigervnc-standalone-server");
    expect(dockerfile).toContain("chromium");
    expect(dockerfile).toContain("novnc");
    expect(dockerfile).toContain("websockify");
    expect(dockerfile).toContain("BRIAR_COMPUTER_USE_WINDOW_SUPERVISOR=process");
    expect(dockerfile).toContain("BRIAR_SANDBOX=1");
    expect(dockerfile).not.toMatch(/\bsudo\b/u);
  });

  it("refuses to stage without every agent runner", async () => {
    const { cliBundlePath, agentDirectory } = await sources();
    await rm(join(agentDirectory, "pi-runner.js"));
    await expect(stageSandboxBuildContext({
      directory: await temporary("briar-sandbox-stage-"),
      cliBundlePath,
      agentDirectory,
    })).rejects.toThrow("pi-runner.js is missing");
  });
});

describe("resolveSandboxRuntimeSources", () => {
  it("finds the installed layout beside the CLI bundle", async () => {
    const { root } = await sources();
    expect(await resolveSandboxRuntimeSources(root)).toEqual({
      cliBundlePath: join(root, "briar.js"),
      agentDirectory: join(root, "agent"),
    });
  });

  it("falls back to the checkout layout", async () => {
    const root = await temporary("briar-sandbox-checkout-");
    await mkdir(join(root, "dist-cli"));
    await mkdir(join(root, "dist-agent"));
    await writeFile(join(root, "dist-cli", "briar.js"), "");
    expect(await resolveSandboxRuntimeSources(join(root, "src-cli"))).toEqual({
      cliBundlePath: join(root, "dist-cli", "briar.js"),
      agentDirectory: join(root, "dist-agent"),
    });
  });

  it("explains how to build missing bundles", async () => {
    const root = await temporary("briar-sandbox-empty-");
    await expect(resolveSandboxRuntimeSources(root)).rejects.toThrow("bun run cli:build");
  });
});

describe("embedded briar-open-browser", () => {
  /** The launcher's `case` patterns, read out of the embedded AMI script. */
  const profilePatterns = () => {
    const script = sandboxRuntimeAssets.desktopFiles["briar-open-browser"];
    const start = script.indexOf('case "$profile_directory" in');
    const end = script.indexOf("*)", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return script
      .slice(start, end)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("/"))
      .flatMap((line) => line.replace(/\)\s*;;.*$/u, "").replace(/\\$/u, "").split("|"))
      .map((pattern) => pattern.trim())
      .filter((pattern) => pattern.length > 0);
  };

  /** Shell glob to RegExp, enough for the character classes the case uses. */
  const matches = (patterns: readonly string[], path: string) =>
    patterns.some((pattern) =>
      new RegExp(
        `^${
          pattern.replaceAll(
            /\[[^\]]+\]|[.*+?^${}()|\\]/gu,
            (token) => token.startsWith("[") ? token : `\\${token}`,
          )
        }$`,
        "u",
      ).test(path)
    );

  it("accepts the owner display and every Agent display profile", () => {
    const patterns = profilePatterns();
    const profile = (name: string) => `/var/lib/briar-computer-use/profiles/${name}`;
    expect(patterns).toContain(profile("display-1"));
    expect(matches(patterns, profile("display-1"))).toBe(true);
    expect(matches(patterns, profile("display-2"))).toBe(true);
    expect(matches(patterns, profile("display-42"))).toBe(true);
    expect(matches(patterns, profile("display-100"))).toBe(true);
    expect(matches(patterns, profile("display-0"))).toBe(false);
    expect(matches(patterns, profile("shared"))).toBe(false);
    expect(matches(patterns, profile("display-1/../shared"))).toBe(false);
  });
});
