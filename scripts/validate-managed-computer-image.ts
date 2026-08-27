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
  "gh",
  "git",
  "libayatana-appindicator3-dev",
  "librsvg2-dev",
  "libssl-dev",
  "libwebkit2gtk-4.1-dev",
  "minisign",
  "patchelf",
  "pkg-config",
  "sudo",
  "tigervnc-standalone-server",
  "xfce4-panel",
  "xfce4-session",
  "xfdesktop4",
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

const artifactPreparer = await text(join(image, "prepare-image-artifacts"));
if (
  artifactPreparer.match(/\bbriar-open-browser-style\b/gu)?.length !== 2
) {
  fail("browser helper must be packaged once and marked executable once");
}

const browserHelperPath = join(image, "briar-open-browser-style");
const browserHelper = await text(browserHelperPath);
for (const required of [
  "/usr/bin/nohup /usr/bin/setsid --fork",
  '/usr/bin/google-chrome-stable --new-window "$url"',
  '</dev/null >>"$log_file" 2>&1 &',
  'log_file="$log_directory/google-chrome.log"',
]) {
  if (!browserHelper.includes(required)) {
    fail(`browser helper omits detached launch behavior: ${required}`);
  }
}
if (!browserHelper.includes('case "$url" in') || browserHelper.includes("eval ")) {
  fail("browser helper must validate and quote the URL without eval");
}

const installer = await text(join(image, "install-image-runtime"));
if (!installer.includes("ln -sfn /opt/briar/bin/bun /opt/briar/bin/bunx")) {
  fail("image installer must provide the standard bunx command");
}
if (!installer.includes("--frozen-lockfile --production --ignore-scripts")) {
  fail("provider runtime install must be locked and ignore lifecycle scripts");
}
if (!installer.includes("agent-browser/bin/agent-browser-linux-x64")) {
  fail("agent-browser must install its pinned Linux native binary directly");
}
if (
  !installer.includes('"$source_dir/briar-open-browser-style"') ||
  !installer.includes("/opt/briar/bin/briar-open-browser-style") ||
  !installer.includes("/home/briar/.local/state/briar")
) {
  fail("image installer must install the browser helper and its log directory");
}
for (const required of [
  "/home/briar/.cargo/bin",
  "/home/briar/.rustup/downloads",
  "/home/briar/.rustup/tmp",
  "/home/briar/.rustup/toolchains",
  'chown -h briar:briar "$user_toolchain"',
  'initial_release="/opt/briar/releases/$briar_version"',
  "ln -s /opt/briar/current/bin/briar /opt/briar/bin/briar",
  "/home/briar/.codex/skills",
]) {
  if (!installer.includes(required)) {
    fail(`image installer omits writable managed-user Rust state: ${required}`);
  }
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
  "CARGO_HOME=/home/briar/.cargo",
  "RUSTUP_HOME=/home/briar/.rustup",
  "export GH_BROWSER=/opt/briar/bin/briar-open-browser-style",
  "BRIAR_CI_SERIAL_CONTEXTS=true",
  "VITEST_MAX_WORKERS=2",
  "/opt/briar/bin",
]) {
  if (!profile.includes(required)) fail(`runtime profile omits ${required}`);
}
if (/^\s*(?:export\s+)?BROWSER=/mu.test(profile)) {
  fail("runtime profile must not override global BROWSER");
}

const remoteDesktop = await text(join(image, "briar-remote-desktop"));
if (!remoteDesktop.includes('/usr/bin/Xtigervnc "$display"')) {
  fail("remote desktop does not start Xtigervnc");
}
if (remoteDesktop.includes("-fg")) {
  fail("Debian 13 Xtigervnc does not support the -fg option");
}
if (
  !remoteDesktop.includes("BRIAR_REMOTE_DISPLAY_STARTUP_TIMEOUT_SECONDS:-120") ||
  !remoteDesktop.includes("startup_deadline=$((SECONDS + startup_timeout_seconds))")
) {
  fail("remote desktop must allow cold EBS starts to wait for TigerVNC");
}

const remoteDesktopService = await text(
  join(image, "briar-remote-desktop.service"),
);
if (
  !remoteDesktopService.includes(
    "Environment=BRIAR_REMOTE_DISPLAY_STARTUP_TIMEOUT_SECONDS=120",
  )
) {
  fail("remote desktop service omits the cold-start timeout");
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
if (!verifier.includes('export HOME="${HOME:-/root}"')) {
  fail("image verifier must provide HOME for non-login SSM commands");
}
if (!verifier.includes("command -v xfdesktop >/dev/null")) {
  fail("image verifier must require the XFCE desktop process");
}
for (const required of [
  "command -v gh >/dev/null",
  "test -x /opt/briar/bin/briar-open-browser-style",
  'printf %s "$GH_BROWSER"',
  "gh auth login --help",
  "for required_flag in --hostname --git-protocol --web",
  "gh auth status --help",
]) {
  if (!verifier.includes(required)) {
    fail(`image verifier omits GitHub browser-login check: ${required}`);
  }
}
for (const required of [
  "test -w /home/briar/.cargo",
  "test -w /home/briar/.rustup/downloads",
  "test -w /home/briar/.rustup/tmp",
  "rustup run 1.96.0 rustc --version",
]) {
  if (!verifier.includes(required)) {
    fail(`image verifier omits managed-user Rust check: ${required}`);
  }
}
for (const forbidden of [
  "/home/admin/.ssh",
  "/root/.aws",
  "/home/briar/.aws",
  "/home/briar/.ssh",
  "/home/briar/.git-credentials",
  "/home/briar/.config/gh",
  "/home/briar/.local/share/opencode/auth.json",
]) {
  if (!cleanup.includes(forbidden) || !verifier.includes(forbidden)) {
    fail(`capture credential boundary omits ${forbidden}`);
  }
}
for (const [providerRoot, skillSubdirectory] of [
  ["/home/briar/.cursor", "skills"],
  ["/home/briar/.grok", "skills"],
  ["/home/briar/.gemini", "config/skills"],
]) {
  const invocation = `verify_skill_only_provider_root ${providerRoot} ${skillSubdirectory}`;
  if (!cleanup.includes(invocation) || !verifier.includes(invocation)) {
    fail(`capture provider-state boundary omits ${providerRoot}`);
  }
}

const service = await text(join(image, "briar-managed-worker.service"));
for (const required of [
  "User=briar",
  "Group=briar",
  "BRIAR_MANAGED_CREDENTIAL_FILE=/var/lib/briar/worker-credential.json",
  "BRIAR_MANAGED_RUNTIME_UPDATER=/opt/briar/bin/briar-managed-runtime-update-request",
  "CARGO_HOME=/home/briar/.cargo",
  "RUSTUP_HOME=/home/briar/.rustup",
  "BRIAR_CI_SERIAL_CONTEXTS=true",
  "VITEST_MAX_WORKERS=2",
  "ExecStart=/opt/briar/bin/briar managed-computer worker-supervisor",
]) {
  if (!service.includes(required)) fail(`managed worker unit omits ${required}`);
}
if (service.includes("briar_worker_")) fail("managed worker unit embeds a token");

const updater = await text(join(image, "briar-managed-runtime-updater"));
for (const required of [
  "minisign_binary",
  "wait_for_handoff",
  "safe_archive",
  "mv -Tf -- \"$temporary_link\" \"$current_link\"",
  "wait_for_health",
  "rollback_release",
  "Refusing to downgrade the managed runtime",
  "update-handoff/fail",
]) {
  if (!updater.includes(required)) fail(`runtime updater omits ${required}`);
}
if (updater.includes("curl | sh") || updater.includes("eval ")) {
  fail("runtime updater must not execute an unverified download");
}
const updaterService = await text(
  join(image, "briar-managed-runtime-updater.service"),
);
for (const required of [
  "User=root",
  "Group=briar",
  "RuntimeDirectory=briar-runtime-updater",
  "ProtectSystem=strict",
  "ReadOnlyPaths=/var/lib/briar",
  "ExecStart=/opt/briar/bin/briar-managed-runtime-updater",
]) {
  if (!updaterService.includes(required)) {
    fail(`runtime updater unit omits ${required}`);
  }
}

const releaseConfig = Object.fromEntries(
  (await text(join(root, "config", "release.env")))
    .split(/\r?\n/u)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=", 2) as [string, string]),
);
const updaterPublicKey = Buffer.from(
  releaseConfig.BRIAR_UPDATER_PUBLIC_KEY ?? "",
  "base64",
).toString("utf8");
if (updaterPublicKey !== await text(join(image, "runtime-updater.pub"))) {
  fail("managed runtime updater public key differs from Production releases");
}

const localCi = await text(join(root, "scripts", "ci-local.sh"));
if (!localCi.includes('"${BRIAR_CI_SERIAL_CONTEXTS:-false}" == "true"')) {
  fail("local CI must honor managed-computer serial context execution");
}

const viteConfig = await text(join(root, "apps", "briar", "vite.config.ts"));
if (!viteConfig.includes("process.env.VITEST_MAX_WORKERS ?? 4")) {
  fail("Vitest must honor the managed-computer worker limit");
}
const turboConfig = await Bun.file(join(root, "turbo.json")).json() as {
  globalPassThroughEnv?: string[];
};
if (!turboConfig.globalPassThroughEnv?.includes("VITEST_MAX_WORKERS")) {
  fail("Turborepo must pass the managed-computer Vitest worker limit");
}

const pilotGuide = await text(
  join(root, "docs", "operations", "managed-computer-pilot.md"),
);
for (const required of [
  "gh auth login --hostname github.com --git-protocol https --web",
  "gh auth status --hostname github.com",
  "GH_BROWSER",
  "/opt/briar/bin/briar-open-browser-style",
]) {
  if (!pilotGuide.includes(required)) {
    fail(`managed-computer guidance omits GitHub login detail: ${required}`);
  }
}
if (pilotGuide.includes("--skip-ssh-key")) {
  fail("managed-computer guidance must not use unsupported --skip-ssh-key");
}

for (const executable of [
  "briar",
  "briar-managed-runtime-update-request",
  "briar-managed-runtime-updater",
  "briar-open-browser-style",
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
