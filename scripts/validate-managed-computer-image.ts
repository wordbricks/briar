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
]) {
  if (!lock[key]) fail(`missing ${key}`);
}
for (const key of Object.keys(lock).filter((key) => key.endsWith("SHA256"))) {
  if (!/^[0-9a-f]{64}$/u.test(lock[key]!)) fail(`${key} is not SHA-256 hex`);
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
  "curl",
  "git",
  "nodejs",
  "tigervnc-standalone-server",
  "xfce4-panel",
  "xfce4-session",
]) {
  if (!packages.includes(required)) fail(`package list omits ${required}`);
}
if (packages.includes("chromium")) {
  fail("Chromium must not replace pinned Google Chrome");
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
if (!installer.includes("sha256sum --check --strict artifact-manifest.sha256")) {
  fail("image installer does not verify the uploaded artifact manifest");
}

const remoteDesktop = await text(join(image, "briar-remote-desktop"));
if (!remoteDesktop.includes('/usr/bin/Xtigervnc "$display"')) {
  fail("remote desktop does not start Xtigervnc");
}
if (remoteDesktop.includes("-fg")) {
  fail("Debian 13 Xtigervnc does not support the -fg option");
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
