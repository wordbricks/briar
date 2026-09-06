import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  agentProviderBinaryName,
  managedComputerSetupProviders,
} from "../src/lib/agent-provider";
import { sandboxRuntimeAssets } from "./sandbox-runtime-assets";

/**
 * Build-context assembly for the Docker sandbox image.
 *
 * The image is content-addressed: every byte that ends up in the build
 * context (Dockerfile, CLI bundle, agent runners, provider manifest and
 * lockfile) feeds one SHA-256. The container records that digest as a label
 * so `briar sandbox up` can tell a stale sandbox from a current one without
 * consulting the registry, exactly like Grok Bot's local Docker VM.
 */

export const SANDBOX_SCHEMA_VERSION = "2";
export const SANDBOX_IMAGE_REPOSITORY = "briar-sandbox";
export const SANDBOX_RUNTIME_ROOT = "/opt/briar";
export const SANDBOX_CLI_PATH = `${SANDBOX_RUNTIME_ROOT}/bin/briar`;
export const SANDBOX_HOME = "/home/briar";
export const SANDBOX_CONFIG_HOME = `${SANDBOX_HOME}/.config/briar`;
export const DEFAULT_DEBIAN_MIRROR = "deb.debian.org";
/**
 * Display profiles, the shared browser login store, and the box service's auth
 * token live here. It is a volume so a container replacement keeps the logins.
 */
export const SANDBOX_COMPUTER_USE_ROOT = "/var/lib/briar-computer-use";
/** noVNC listens here inside the container; the host publishes it on loopback. */
export const SANDBOX_NOVNC_PORT = 6080;
export const SANDBOX_NOVNC_TOKEN_FILE = `${SANDBOX_COMPUTER_USE_ROOT}/novnc-tokens`;

const debianMirrorPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/u;

/**
 * Validate a Debian mirror host for the image build. Only a bare hostname is
 * accepted so it can be spliced into apt sources without shell or URL tricks.
 */
export function debianMirror(raw: string | undefined): string {
  const value = raw?.trim().toLowerCase() ?? DEFAULT_DEBIAN_MIRROR;
  if (value.length === 0) return DEFAULT_DEBIAN_MIRROR;
  if (!debianMirrorPattern.test(value)) {
    throw new Error("Debian mirror must be a bare hostname such as ftp.kr.debian.org");
  }
  return value;
}

/**
 * Every bundle the sandbox runtime needs. The Computer Use MCP server is
 * required: the sandbox runs Xvnc displays and a box service so agents can
 * see and drive a desktop, exactly like a managed computer.
 */
const agentBundles = [
  "agy-runner.js",
  "claude-runner.js",
  "codex-runner.js",
  "cursor-runner.js",
  "grok-runner.js",
  "opencode-runner.js",
  "pi-runner.js",
  "computer-use-mcp-server.js",
] as const;

export const SANDBOX_DESKTOP_FILES = [
  "briar-remote-desktop",
  "briar-computer-use-window",
  "briar-open-browser",
  "briar-computer-executor.py",
  "xfce4-helpers.rc",
  "xfce4-terminalrc",
  "mimeapps.list",
  "briar-google-chrome.desktop",
  "remote-desktop-packages.txt",
] as const;
export type SandboxDesktopFile = (typeof SANDBOX_DESKTOP_FILES)[number];

/**
 * A provider CLI the image downloads as a pinned standalone release. Both
 * Linux architectures are checksummed because the sandbox is built natively
 * on amd64 Macs and on ARM64 hosts such as a GX10.
 */
export type SandboxCliRelease = {
  readonly version: string;
  readonly sha256: {
    readonly amd64: string;
    readonly arm64: string;
  };
};

export type SandboxRuntimeAssets = {
  readonly bunVersion: string;
  readonly nodeVersion: string;
  readonly opencodeCli: SandboxCliRelease;
  readonly grokCli: SandboxCliRelease;
  readonly desktopFiles: Readonly<Record<SandboxDesktopFile, string>>;
  readonly providerRuntimePackageJson: string;
  readonly providerRuntimeBunLock: string;
};

/**
 * Every managed-computer provider must resolve its binary on the sandbox's
 * `PATH`, otherwise the in-container worker never advertises the provider and
 * the app hides this sandbox in the designated-worker picker. The paths are
 * derived from the provider catalog and asserted inside the image build, so a
 * provider added to `managedComputerSetupProviders` without a matching install
 * step fails the build instead of silently shipping.
 */
export const sandboxProviderBinaryPaths = (): string[] =>
  managedComputerSetupProviders
    .map((provider) => `${SANDBOX_RUNTIME_ROOT}/bin/${agentProviderBinaryName(provider)}`)
    .sort();

/**
 * Debian packages for the desktop session, shared with the managed-computer
 * AMI list. The sandbox adds Chromium because Google Chrome ships no Linux
 * ARM64 build; `briar-open-browser` keeps calling `google-chrome-stable`
 * through a wrapper so the desktop files stay identical.
 */
export function sandboxDesktopPackages(
  assets: SandboxRuntimeAssets = sandboxRuntimeAssets,
): string[] {
  const listed = assets.desktopFiles["remote-desktop-packages.txt"]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  // The sandbox never grants administrator rights, so the AMI's sudo policy
  // package is left out.
  return [...new Set([...listed, "chromium", "novnc", "websockify"])]
    .filter((name) => name !== "sudo")
    .sort();
}

export function sandboxDockerfile(
  assets: SandboxRuntimeAssets = sandboxRuntimeAssets,
): string {
  return `# Generated by briar sandbox. Debian 13 runtime for Briar execution workers.
FROM debian:trixie-slim
ARG TARGETARCH
ARG BUN_VERSION=${assets.bunVersion}
ARG NODE_VERSION=${assets.nodeVersion}
ARG OPENCODE_CLI_VERSION=${assets.opencodeCli.version}
ARG GROK_CLI_VERSION=${assets.grokCli.version}
ARG DEBIAN_MIRROR=deb.debian.org
ENV DEBIAN_FRONTEND=noninteractive
RUN if [ "$DEBIAN_MIRROR" != "deb.debian.org" ]; then \\
    sed -i "s|http://deb.debian.org/|http://$DEBIAN_MIRROR/|g" /etc/apt/sources.list.d/debian.sources; \\
  fi \\
  && apt-get update \\
  && apt-get install -y --no-install-recommends \\
    build-essential ca-certificates curl git jq libssl-dev openssh-client \\
    pkg-config procps python3 unzip xz-utils \\
  && rm -rf /var/lib/apt/lists/*
RUN set -eu; \\
  case "$TARGETARCH" in \\
    amd64) bun_arch=x64; node_arch=x64 ;; \\
    arm64) bun_arch=aarch64; node_arch=arm64 ;; \\
    *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \\
  esac; \\
  mkdir -p ${SANDBOX_RUNTIME_ROOT}/bin ${SANDBOX_RUNTIME_ROOT}/node /tmp/briar-download; \\
  curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v\${BUN_VERSION}/bun-linux-\${bun_arch}.zip" \\
    -o /tmp/briar-download/bun.zip; \\
  unzip -q /tmp/briar-download/bun.zip -d /tmp/briar-download/bun; \\
  install -m 0755 "/tmp/briar-download/bun/bun-linux-\${bun_arch}/bun" ${SANDBOX_RUNTIME_ROOT}/bin/bun; \\
  ln -s bun ${SANDBOX_RUNTIME_ROOT}/bin/bunx; \\
  curl -fsSL "https://nodejs.org/dist/v\${NODE_VERSION}/node-v\${NODE_VERSION}-linux-\${node_arch}.tar.xz" \\
    -o /tmp/briar-download/node.tar.xz; \\
  tar -xJf /tmp/briar-download/node.tar.xz --strip-components=1 -C ${SANDBOX_RUNTIME_ROOT}/node; \\
  for binary in node npm npx; do \\
    ln -s ${SANDBOX_RUNTIME_ROOT}/node/bin/$binary ${SANDBOX_RUNTIME_ROOT}/bin/$binary; \\
  done; \\
  rm -rf /tmp/briar-download
COPY provider-runtime/package.json provider-runtime/bun.lock ${SANDBOX_RUNTIME_ROOT}/provider/
RUN set -eu; \\
  HOME=/root ${SANDBOX_RUNTIME_ROOT}/bin/bun install --cwd ${SANDBOX_RUNTIME_ROOT}/provider \\
    --frozen-lockfile --production --ignore-scripts; \\
  for binary in claude codex velen; do \\
    test -x "${SANDBOX_RUNTIME_ROOT}/provider/node_modules/.bin/$binary"; \\
    ln -s "${SANDBOX_RUNTIME_ROOT}/provider/node_modules/.bin/$binary" "${SANDBOX_RUNTIME_ROOT}/bin/$binary"; \\
  done; \\
  find ${SANDBOX_RUNTIME_ROOT}/provider/node_modules -path '*/vendor/*/velen/velen' -type f -exec chmod 0755 {} +; \\
  case "$TARGETARCH" in amd64) browser=agent-browser-linux-x64 ;; *) browser=agent-browser-linux-arm64 ;; esac; \\
  if [ -s "${SANDBOX_RUNTIME_ROOT}/provider/node_modules/agent-browser/bin/$browser" ]; then \\
    install -m 0755 "${SANDBOX_RUNTIME_ROOT}/provider/node_modules/agent-browser/bin/$browser" \\
      ${SANDBOX_RUNTIME_ROOT}/bin/agent-browser; \\
  fi
# OpenCode and Grok ship as standalone releases, pinned and checksum-verified
# per architecture exactly like the managed-computer AMI installs them. Neither
# comes from npm: OpenCode's package installs through a lifecycle script the
# provider runtime deliberately runs with --ignore-scripts, and Grok has no
# package at all.
RUN set -eu; \\
  case "$TARGETARCH" in \\
    amd64) \\
      opencode_url="https://github.com/anomalyco/opencode/releases/download/v\${OPENCODE_CLI_VERSION}/opencode-linux-x64-baseline.tar.gz"; \\
      opencode_sha=${assets.opencodeCli.sha256.amd64}; \\
      grok_url="https://x.ai/cli/grok-\${GROK_CLI_VERSION}-linux-x86_64"; \\
      grok_sha=${assets.grokCli.sha256.amd64} ;; \\
    arm64) \\
      opencode_url="https://github.com/anomalyco/opencode/releases/download/v\${OPENCODE_CLI_VERSION}/opencode-linux-arm64.tar.gz"; \\
      opencode_sha=${assets.opencodeCli.sha256.arm64}; \\
      grok_url="https://x.ai/cli/grok-\${GROK_CLI_VERSION}-linux-aarch64"; \\
      grok_sha=${assets.grokCli.sha256.arm64} ;; \\
    *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \\
  esac; \\
  mkdir -p /tmp/briar-download; \\
  curl -fsSL "$opencode_url" -o /tmp/briar-download/opencode.tar.gz; \\
  printf '%s  %s\\n' "$opencode_sha" /tmp/briar-download/opencode.tar.gz | sha256sum -c -; \\
  tar -xzf /tmp/briar-download/opencode.tar.gz -C /tmp/briar-download opencode; \\
  install -m 0755 /tmp/briar-download/opencode ${SANDBOX_RUNTIME_ROOT}/bin/opencode; \\
  curl -fsSL "$grok_url" -o /tmp/briar-download/grok; \\
  printf '%s  %s\\n' "$grok_sha" /tmp/briar-download/grok | sha256sum -c -; \\
  install -m 0755 /tmp/briar-download/grok ${SANDBOX_RUNTIME_ROOT}/bin/grok; \\
  rm -rf /tmp/briar-download; \\
  for provider_binary in ${sandboxProviderBinaryPaths().join(" ")}; do \\
    test -x "$provider_binary"; \\
  done
# Desktop session, VNC displays, and Computer Use input executor.
RUN apt-get update \\
  && apt-get install -y --no-install-recommends \\
    ${sandboxDesktopPackages(assets).join(" ")} \\
  && rm -rf /var/lib/apt/lists/*
COPY briar.js ${SANDBOX_RUNTIME_ROOT}/lib/briar.js
COPY agent ${SANDBOX_RUNTIME_ROOT}/lib/agent
COPY briar ${SANDBOX_RUNTIME_ROOT}/bin/briar
COPY desktop/briar-remote-desktop desktop/briar-computer-use-window desktop/briar-open-browser \\
  ${SANDBOX_RUNTIME_ROOT}/bin/
COPY desktop/briar-computer-executor.py ${SANDBOX_RUNTIME_ROOT}/libexec/briar-computer-executor.py
COPY desktop/briar-google-chrome.desktop /usr/share/applications/briar-google-chrome.desktop
COPY desktop/xfce4-helpers.rc ${SANDBOX_HOME}/.config/xfce4/helpers.rc
COPY desktop/xfce4-terminalrc ${SANDBOX_HOME}/.config/xfce4/terminal/terminalrc
COPY desktop/mimeapps.list ${SANDBOX_HOME}/.config/mimeapps.list
RUN set -eu; \\
  useradd --create-home --shell /bin/bash --uid 1000 briar; \\
  chmod 0755 ${SANDBOX_CLI_PATH} ${SANDBOX_RUNTIME_ROOT}/bin/briar-remote-desktop \\
    ${SANDBOX_RUNTIME_ROOT}/bin/briar-computer-use-window ${SANDBOX_RUNTIME_ROOT}/bin/briar-open-browser \\
    ${SANDBOX_RUNTIME_ROOT}/libexec/briar-computer-executor.py; \\
  printf '#!/bin/sh\\nexec /usr/bin/chromium --no-sandbox --disable-dev-shm-usage --disable-gpu "$@"\\n' \\
    > /usr/bin/google-chrome-stable; \\
  chmod 0755 /usr/bin/google-chrome-stable; \\
  update-alternatives --install /usr/bin/x-www-browser x-www-browser /usr/bin/google-chrome-stable 200; \\
  install -d -m 1777 /tmp/.X11-unix; \\
  install -d -o briar -g briar -m 0700 /var/lib/briar-computer-use; \\
  install -d -o briar -g briar -m 0755 ${SANDBOX_HOME}/Desktop; \\
  install -o briar -g briar -m 0644 /usr/share/applications/briar-google-chrome.desktop \\
    "${SANDBOX_HOME}/Desktop/Google Chrome.desktop"; \\
  chown -R briar:briar ${SANDBOX_HOME}
USER briar
WORKDIR ${SANDBOX_HOME}
ENV HOME=${SANDBOX_HOME} \\
  BRIAR_CLI=${SANDBOX_CLI_PATH} \\
  BRIAR_CONFIG_HOME=${SANDBOX_CONFIG_HOME} \\
  BRIAR_SANDBOX=1 \\
  BRIAR_COMPUTER_USE_WINDOW_SUPERVISOR=process \\
  GH_BROWSER=${SANDBOX_RUNTIME_ROOT}/bin/briar-open-browser \\
  PATH=${SANDBOX_RUNTIME_ROOT}/bin:${SANDBOX_HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin
CMD ["${SANDBOX_CLI_PATH}", "sandbox", "supervise"]
`;
}

export const sandboxLauncherScript = `#!/bin/sh
set -eu
exec "${SANDBOX_RUNTIME_ROOT}/bin/bun" "${SANDBOX_RUNTIME_ROOT}/lib/briar.js" "$@"
`;

async function firstExisting(candidates: readonly string[], label: string) {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next layout.
    }
  }
  throw new Error(
    `${label} is unavailable at ${candidates.join(" or ")}; run \`bun run cli:build\` and \`bun run agent:build\``,
  );
}

/**
 * Locate the CLI bundle and agent runners next to the running CLI. The
 * installed layout keeps `briar.js` beside an `agent/` directory; a checkout
 * keeps them in `dist-cli/` and `dist-agent/`.
 */
export async function resolveSandboxRuntimeSources(
  moduleDirectory = import.meta.dir,
) {
  const cliBundlePath = await firstExisting([
    resolve(moduleDirectory, "briar.js"),
    resolve(moduleDirectory, "../dist-cli/briar.js"),
  ], "The Briar CLI bundle");
  const agentDirectory = await firstExisting([
    resolve(moduleDirectory, "agent"),
    resolve(moduleDirectory, "../dist-agent"),
  ], "The agent runner bundle directory");
  return { cliBundlePath, agentDirectory };
}

export type SandboxBuildContext = {
  readonly directory: string;
  readonly runtimeSha256: string;
  readonly imageTag: string;
};

export const sandboxImageTag = (runtimeSha256: string) =>
  `${SANDBOX_IMAGE_REPOSITORY}:${runtimeSha256.slice(0, 12)}`;

/**
 * Write the Docker build context into `directory` and return its digest.
 * Files are hashed in sorted path order so the digest is stable across
 * machines and independent of filesystem timestamps.
 */
export async function stageSandboxBuildContext(input: {
  readonly directory: string;
  readonly cliBundlePath: string;
  readonly agentDirectory: string;
  readonly assets?: SandboxRuntimeAssets;
}): Promise<SandboxBuildContext> {
  const assets = input.assets ?? sandboxRuntimeAssets;
  const files = new Map<string, Buffer>();
  files.set("Dockerfile", Buffer.from(sandboxDockerfile(assets), "utf8"));
  files.set("briar", Buffer.from(sandboxLauncherScript, "utf8"));
  files.set("briar.js", await readFile(input.cliBundlePath));
  files.set(
    "provider-runtime/package.json",
    Buffer.from(assets.providerRuntimePackageJson, "utf8"),
  );
  files.set(
    "provider-runtime/bun.lock",
    Buffer.from(assets.providerRuntimeBunLock, "utf8"),
  );
  const available = new Set(await readdir(input.agentDirectory));
  for (const bundle of agentBundles) {
    if (!available.has(bundle)) {
      throw new Error(
        `Agent bundle ${bundle} is missing from ${input.agentDirectory}; run \`bun run agent:build\``,
      );
    }
    files.set(`agent/${bundle}`, await readFile(join(input.agentDirectory, bundle)));
  }
  for (const name of SANDBOX_DESKTOP_FILES) {
    files.set(`desktop/${name}`, Buffer.from(assets.desktopFiles[name], "utf8"));
  }
  const digest = createHash("sha256");
  for (const path of [...files.keys()].sort()) {
    const content = files.get(path)!;
    digest.update(path);
    digest.update("\0");
    digest.update(String(content.byteLength));
    digest.update("\0");
    digest.update(content);
  }
  const runtimeSha256 = digest.digest("hex");
  for (const [path, content] of files) {
    const target = join(input.directory, path);
    await mkdir(resolve(target, ".."), { recursive: true, mode: 0o700 });
    const executable = path === "briar" || path.startsWith("desktop/briar-");
    await writeFile(target, content, { mode: executable ? 0o755 : 0o644 });
  }
  return {
    directory: input.directory,
    runtimeSha256,
    imageTag: sandboxImageTag(runtimeSha256),
  };
}
