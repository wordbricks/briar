import { statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const image = join(root, "infrastructure", "managed-computers");
const text = async (path: string) => Bun.file(path).text();
const fail = (message: string): never => {
  throw new Error(`Managed computer image validation failed: ${message}`);
};

const lock = Object.fromEntries(
  (await text(join(image, "image-lock.env")))
    .split(/\r?\n/u)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const match = line.match(/^([A-Z0-9_]+)=([A-Za-z0-9._-]+)$/u);
      if (!match) fail(`invalid image-lock.env line: ${line}`);
      return [match[1]!, match[2]!] as const;
    }),
);
for (const key of [
  "DEBIAN_SNAPSHOT",
  "BUN_VERSION",
  "BUN_LINUX_X64_SHA256",
  "NODE_VERSION",
  "NODE_LINUX_X64_SHA256",
  "RUSTUP_VERSION",
  "RUSTUP_INIT_LINUX_X64_SHA256",
  "RUST_TOOLCHAIN_VERSION",
  "CARGO_AUDIT_VERSION",
  "CARGO_AUDIT_LINUX_X64_SHA256",
  "GITLEAKS_VERSION",
  "GITLEAKS_LINUX_X64_SHA256",
  "GOOGLE_CHROME_VERSION",
  "GOOGLE_CHROME_AMD64_SHA256",
  "SSM_AGENT_VERSION",
  "SSM_AGENT_PACKAGE_VERSION",
  "SSM_AGENT_DEBIAN_AMD64_SHA256",
  "PACKER_VERSION",
  "PACKER_AMAZON_PLUGIN_VERSION",
  "CODEX_CLI_VERSION",
  "CLAUDE_CODE_VERSION",
  "AGENT_BROWSER_VERSION",
  "OPENCODE_CLI_VERSION",
  "OPENCODE_CLI_LINUX_X64_SHA256",
  "GROK_CLI_VERSION",
  "GROK_CLI_LINUX_X64_SHA256",
  "CURSOR_AGENT_VERSION",
  "CURSOR_AGENT_LINUX_X64_SHA256",
  "ANTIGRAVITY_CLI_VERSION",
  "ANTIGRAVITY_CLI_BUILD",
  "ANTIGRAVITY_CLI_LINUX_X64_SHA512",
]) {
  if (!lock[key]) fail(`missing ${key}`);
}
for (const key of Object.keys(lock).filter((key) => key.endsWith("SHA256"))) {
  if (!/^[0-9a-f]{64}$/u.test(lock[key]!)) fail(`${key} is not SHA-256 hex`);
}
if (!/^[0-9a-f]{128}$/u.test(lock.ANTIGRAVITY_CLI_LINUX_X64_SHA512!)) {
  fail("ANTIGRAVITY_CLI_LINUX_X64_SHA512 is not SHA-512 hex");
}

const providerPackage = await Bun.file(
  join(image, "provider-runtime", "package.json"),
).json() as { packageManager?: string; dependencies?: Record<string, string> };
const expectedDependencies = {
  "@openai/codex": lock.CODEX_CLI_VERSION,
  "@anthropic-ai/claude-code": lock.CLAUDE_CODE_VERSION,
  "agent-browser": lock.AGENT_BROWSER_VERSION,
};
if (providerPackage.packageManager !== `bun@${lock.BUN_VERSION}`) {
  fail("provider runtime Bun version differs from image lock");
}
for (const [name, version] of Object.entries(expectedDependencies)) {
  if (providerPackage.dependencies?.[name] !== version) {
    fail(`${name} differs from image lock`);
  }
}
if (providerPackage.dependencies?.["opencode-ai"]) {
  fail("OpenCode must use the pinned standalone binary, not a lifecycle script");
}
const providerLock = await text(join(image, "provider-runtime", "bun.lock"));
for (const [name, version] of Object.entries(expectedDependencies)) {
  if (!providerLock.includes(`${name}@${version}`)) {
    fail(`provider lock does not contain ${name}@${version}`);
  }
}

const packages = (await text(join(image, "remote-desktop-packages.txt")))
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));
for (const required of [
  "ca-certificates",
  "build-essential",
  "curl",
  "fontconfig",
  "fonts-noto-cjk",
  "git",
  "libayatana-appindicator3-dev",
  "librsvg2-dev",
  "libssl-dev",
  "libwebkit2gtk-4.1-dev",
  "patchelf",
  "pkg-config",
  "sudo",
  "tigervnc-standalone-server",
  "xfce4-panel",
  "xfce4-session",
  "xz-utils",
]) {
  if (!packages.includes(required)) fail(`package list omits ${required}`);
}
if (packages.includes("chromium")) {
  fail("Chromium must not replace pinned Google Chrome");
}
if (packages.includes("nodejs")) {
  fail("Debian Node.js must not replace the pinned Node.js runtime");
}

const remoteDesktopInstaller = await text(
  join(image, "install-remote-desktop"),
);
if (remoteDesktopInstaller.includes("${binary:Package}=${Version}")) {
  fail("package lock verification must not add Debian architecture qualifiers");
}
if (
  !remoteDesktopInstaller.includes("--showformat='${Version}'") ||
  !remoteDesktopInstaller.includes("printf '%s=%s\\n' \"$name\" \"$version\"")
) {
  fail("package lock verification must preserve requested package names");
}

const packer = await text(join(image, "image.pkr.hcl"));
if (!packer.includes(`required_version = "= ${lock.PACKER_VERSION}"`)) {
  fail("Packer version differs from image lock");
}
if (!packer.includes(`version = "= ${lock.PACKER_AMAZON_PLUGIN_VERSION}"`)) {
  fail("Packer Amazon plugin version differs from image lock");
}
if (
  !packer.includes('variable "debian_snapshot"') ||
  !packer.includes("debian_snapshot = var.debian_snapshot")
) {
  fail("Packer bootstrap does not receive the pinned Debian snapshot");
}
if (!packer.includes("verify-managed-image --capture-ready")) {
  fail("Packer does not verify the final credential-free capture state");
}
if (
  !packer.includes("install -d -m 0755 /tmp/briar-image") ||
  !packer.includes('destination = "/tmp/briar-image/"')
) {
  fail("Packer must create the artifact upload directory before file provisioning");
}

const installer = await text(join(image, "install-image-runtime"));
if (!installer.includes("--frozen-lockfile --production --ignore-scripts")) {
  fail("provider runtime install must be locked and ignore lifecycle scripts");
}
if (!installer.includes("agent-browser/bin/agent-browser-linux-x64")) {
  fail("agent-browser must install its pinned Linux native binary directly");
}
if (!installer.includes("sha256sum --check --strict artifact-manifest.sha256")) {
  fail("image installer does not verify the uploaded artifact manifest");
}
for (const required of [
  "node-v${NODE_VERSION}-linux-x64.tar.xz",
  "rustup/archive/${RUSTUP_VERSION}/x86_64-unknown-linux-gnu/rustup-init",
  "cargo-audit-x86_64-unknown-linux-gnu-v${CARGO_AUDIT_VERSION}.tgz",
  "gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz",
  "opencode-linux-x64-baseline.tar.gz",
  "grok-${GROK_CLI_VERSION}-linux-x86_64",
  "agent-cli-package.tar.gz",
  "cli_linux_x64.tar.gz",
]) {
  if (!installer.includes(required)) fail(`image installer omits ${required}`);
}

const profile = await text(join(image, "briar-runtime-profile.sh"));
for (const required of [
  "CARGO_HOME=/opt/briar/cargo",
  "RUSTUP_HOME=/opt/briar/rustup",
  "/opt/briar/bin",
]) {
  if (!profile.includes(required)) fail(`runtime profile omits ${required}`);
}

const remoteDesktop = await text(join(image, "briar-remote-desktop"));
if (!remoteDesktop.includes('/usr/bin/Xtigervnc "$display"')) {
  fail("remote desktop does not start Xtigervnc");
}
if (remoteDesktop.includes("-fg")) {
  fail("Debian 13 Xtigervnc does not support the -fg option");
}

const remoteDesktopVerifier = await text(
  join(image, "verify-remote-desktop"),
);
if (
  !remoteDesktopVerifier.includes("awk '{print $4}'") ||
  !remoteDesktopVerifier.includes('"127.0.0.1:${expected_port}"') ||
  !remoteDesktopVerifier.includes('"[::1]:${expected_port}"')
) {
  fail("remote desktop verification must inspect only local listener addresses");
}

const cleanup = await text(join(image, "prepare-image-for-capture"));
const verifier = await text(join(image, "verify-managed-image"));
for (const forbidden of [
  "/home/admin/.ssh",
  "/root/.aws",
  "/home/briar/.aws",
  "/home/briar/.ssh",
  "/home/briar/.git-credentials",
  "/home/briar/.config/gh",
  "/home/briar/.cursor",
  "/home/briar/.grok",
  "/home/briar/.gemini",
  "/home/briar/.local/share/opencode/auth.json",
]) {
  if (!cleanup.includes(forbidden) || !verifier.includes(forbidden)) {
    fail(`capture credential boundary omits ${forbidden}`);
  }
}

const service = await text(join(image, "briar-managed-worker.service"));
for (const required of [
  "User=briar",
  "Group=briar",
  "BRIAR_MANAGED_CREDENTIAL_FILE=/var/lib/briar/worker-credential.json",
  "CARGO_HOME=/opt/briar/cargo",
  "RUSTUP_HOME=/opt/briar/rustup",
  "ExecStart=/opt/briar/bin/briar managed-computer worker-supervisor",
]) {
  if (!service.includes(required)) fail(`managed worker unit omits ${required}`);
}
if (service.includes("briar_worker_")) fail("managed worker unit embeds a token");

for (const executable of [
  "briar",
  "build-managed-computer-image",
  "configure-debian-snapshot",
  "install-image-runtime",
  "prepare-image-artifacts",
  "prepare-image-for-capture",
  "verify-managed-image",
]) {
  if ((statSync(join(image, executable)).mode & 0o111) === 0) {
    fail(`${executable} is not executable`);
  }
}

console.log("managed computer image source validation passed");
