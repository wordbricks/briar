import { homedir } from "node:os";
import { create, toJsonString } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import {
  LocalProviderAuthSnapshotSchema,
  LocalProviderEffortSchema,
  LocalProviderModelCatalogSchema,
  LocalProviderModelSchema,
  LocalProviderModelsSchema,
  LocalProviderUsageSchema,
  LocalProviderUsageSnapshotSchema,
  LocalProviderUsageStatus,
  LocalProviderUsageWindowSchema,
  type LocalProviderEffort,
  type LocalProviderModels,
  type LocalProviderUsage,
} from "@briar/contracts/gen/briar/local/v1/local_pb";
import {
  agentProviderBinaryName,
  agentProviderExecutionEnvironment,
  agentProviders,
  isOpenCodeUpstreamProvider,
  openCodeUpstreamOf,
  type AgentProvider,
  type OpenCodeUpstreamCredentialValue,
} from "../src/lib/agent-provider";
import type {
  AgentEffortCapability,
  AgentProviderCapability,
} from "../src/lib/agent-provider-contract";
import {
  has,
  loadConfig,
  openCodeUpstreamCredential,
  value,
  values,
} from "./command-support";
import { discoverWorkerProviderCapabilities } from "./provider-capabilities";
import {
  agyAuthenticated,
  claudeAuthenticated,
  codexAuthenticated,
  cursorAuthenticated,
  grokAuthenticated,
  opencodeAuthenticated,
} from "./provider-credentials";
import {
  loadProviderUsageSnapshot,
  type AgentUsageWindow,
  type ProviderUsageReport,
} from "./provider-usage";

/**
 * `briar provider …` is the single implementation of provider quota, model and
 * sign-in discovery. The desktop app runs these subcommands instead of keeping
 * a second copy of the same credential files, endpoints and CLI protocols in
 * Rust, so both surfaces always agree.
 */

const providerOrder = agentProviders;

const usageStatus = {
  ok: LocalProviderUsageStatus.OK,
  error: LocalProviderUsageStatus.ERROR,
  unavailable: LocalProviderUsageStatus.UNAVAILABLE,
} as const;

const requestedProviders = (): AgentProvider[] => {
  const requested = values("--provider")
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
  const unknown = requested.filter(
    (entry) => !providerOrder.includes(entry as AgentProvider),
  );
  if (unknown.length > 0) {
    throw new Error(
      `Unknown provider ${unknown.join(", ")}. Known providers: ${
        providerOrder.join(", ")
      }`,
    );
  }
  return requested.length > 0
    ? providerOrder.filter((provider) =>
      requested.includes(provider)
    )
    : [...providerOrder];
};

const requestedHome = () => value("--home")?.trim() || homedir();

/**
 * The desktop resolves provider binaries through its own execution PATH, so it
 * hands that PATH to the CLI rather than trusting the inherited environment.
 */
const applyExecutionPath = () => {
  const executionPath = value("--execution-path")?.trim();
  if (executionPath) process.env.PATH = executionPath;
};

const requestedTimeout = (fallback: number) => {
  const raw = value("--timeout-ms")?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("--timeout-ms must be a positive integer");
  }
  return parsed;
};

/** Saved credential of every OpenCode upstream, keyed by provider. */
type UpstreamCredentials = Partial<
  Record<AgentProvider, OpenCodeUpstreamCredentialValue | null>
>;

/** The CLI owns the Briar config, so it reads its own upstream credentials. */
const upstreamCredentials = async (): Promise<UpstreamCredentials> => {
  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    config = await loadConfig();
  } catch {
    return {};
  }
  return Object.fromEntries(
    agentProviders
      .filter((provider) => openCodeUpstreamOf(provider))
      .map((provider) =>
        [provider, openCodeUpstreamCredential(config, provider)] as const
      ),
  );
};

/**
 * `--<provider>-configured` lets the desktop answer for a credential it owns
 * without handing it to the CLI. The flag name is derived from the provider, so
 * every upstream has one; the CLI otherwise reads the same config the desktop
 * writes.
 */
const upstreamConfigured =
  (credentials: UpstreamCredentials) => (provider: AgentProvider) =>
    (isOpenCodeUpstreamProvider(provider) && has(`--${provider}-configured`)) ||
    (credentials[provider] ?? null) !== null;

const providerBinary = (provider: AgentProvider) =>
  Bun.which(agentProviderBinaryName(provider));

const usageWindow = (window: AgentUsageWindow | null) =>
  window
    ? create(LocalProviderUsageWindowSchema, {
      usedPercent: window.usedPercent,
      windowMinutes: BigInt(Math.max(0, Math.trunc(window.windowMinutes))),
      resetsAt: window.resetsAt === null
        ? undefined
        : timestampFromMs(window.resetsAt),
    })
    : undefined;

export const providerUsageMessage = (
  usage: ProviderUsageReport,
): LocalProviderUsage =>
  create(LocalProviderUsageSchema, {
    status: usageStatus[usage.status],
    session: usageWindow(usage.session),
    weekly: usageWindow(usage.weekly),
    monthly: usageWindow(usage.monthly),
    planType: usage.planType ?? undefined,
    accountLabel: usage.accountLabel ?? undefined,
    authenticated: usage.authenticated,
    reauthenticationRequired: usage.reauthenticationRequired,
    updatedAt: timestampFromMs(usage.updatedAt),
    error: usage.error ?? undefined,
  });

const effortMessage = (effort: AgentEffortCapability): LocalProviderEffort =>
  create(LocalProviderEffortSchema, {
    id: effort.id,
    label: effort.label,
    description: effort.description ?? undefined,
    isDefault: effort.isDefault === true,
  });

export const providerModelsMessage = (
  capability: AgentProviderCapability,
): LocalProviderModels =>
  create(LocalProviderModelsSchema, {
    models: capability.models.map((model) =>
      create(LocalProviderModelSchema, {
        id: model.id,
        label: model.label,
        isDefault: model.isDefault === true,
        defaultEffortId: model.defaultEffortId ?? undefined,
        efforts: (model.efforts ?? []).map(effortMessage),
      })
    ),
    defaultEfforts: (capability.defaultEfforts ?? []).map(effortMessage),
    allowCustomModels: capability.allowCustomModels,
    // A provider that reports nothing and refuses unknown model ids leaves the
    // selector empty, so say why instead of showing a blank list.
    error: capability.error ??
      (capability.models.length === 0 && !capability.allowCustomModels
        ? "CLI가 지원 모델을 반환하지 않았습니다."
        : undefined),
  });

const percent = (window: AgentUsageWindow | null) =>
  window ? `${window.usedPercent.toFixed(1)}%` : "-";

async function providerUsageCommand() {
  applyExecutionPath();
  const providers = requestedProviders();
  const snapshot = await loadProviderUsageSnapshot({
    home: requestedHome(),
    providers,
    timeoutMs: requestedTimeout(10_000),
    upstreamConfigured: upstreamConfigured(await upstreamCredentials()),
  });
  if (!has("--json")) {
    for (const provider of providers) {
      const usage = snapshot.providers[provider];
      if (!usage) continue;
      console.log(
        `${provider}\t${usage.status}\tsession ${percent(usage.session)}\tweekly ${
          percent(usage.weekly)
        }\tmonthly ${percent(usage.monthly)}${
          usage.error ? `\t${usage.error}` : ""
        }`,
      );
    }
    return;
  }
  const message = create(LocalProviderUsageSnapshotSchema, {
    updatedAt: timestampFromMs(snapshot.updatedAt),
  });
  for (const provider of providers) {
    const usage = snapshot.providers[provider];
    if (usage) message[provider] = providerUsageMessage(usage);
  }
  console.log(toJsonString(LocalProviderUsageSnapshotSchema, message));
}

async function providerModelsCommand() {
  applyExecutionPath();
  const providers = requestedProviders();
  const credentials = await upstreamCredentials();
  const catalog = await discoverWorkerProviderCapabilities(
    Object.fromEntries(
      providerOrder.map((provider) => [provider, providers.includes(provider)]),
    ) as Record<AgentProvider, boolean>,
    {
      refresh: true,
      home: requestedHome(),
      which: providerBinary,
      environment: (provider) =>
        agentProviderExecutionEnvironment(
          provider,
          credentials[provider] ?? null,
          process.env,
        ),
    },
  );
  if (!has("--json")) {
    for (const provider of providers) {
      const capability = catalog[provider];
      console.log(
        `${provider}\t${capability.models.length} models${
          capability.error ? `\t${capability.error}` : ""
        }`,
      );
    }
    return;
  }
  const message = create(LocalProviderModelCatalogSchema);
  for (const provider of providers) {
    message[provider] = providerModelsMessage(catalog[provider]);
  }
  console.log(toJsonString(LocalProviderModelCatalogSchema, message));
}

const providerAuthenticated = async (
  provider: AgentProvider,
  home: string,
  now: number,
  configured: (provider: AgentProvider) => boolean,
) => {
  // An upstream has no sign-in of its own; its saved credential is its auth.
  if (openCodeUpstreamOf(provider)) return configured(provider);
  if (provider === "codex") return codexAuthenticated(home);
  if (provider === "grok") return grokAuthenticated(home, now);
  if (provider === "opencode") return opencodeAuthenticated(home);
  const binary = providerBinary(provider);
  if (!binary) return false;
  if (provider === "claude") return claudeAuthenticated(binary);
  if (provider === "cursor") return cursorAuthenticated(binary);
  return agyAuthenticated(binary);
};

async function providerAuthCommand() {
  applyExecutionPath();
  const providers = requestedProviders();
  const home = requestedHome();
  const now = Date.now();
  const configured = upstreamConfigured(await upstreamCredentials());
  const entries = await Promise.all(
    providers.map(async (provider) =>
      [
        provider,
        await providerAuthenticated(provider, home, now, configured),
      ] as const
    ),
  );
  if (!has("--json")) {
    for (const [provider, authenticated] of entries) {
      console.log(`${provider}\t${authenticated ? "signed-in" : "signed-out"}`);
    }
    return;
  }
  const message = create(LocalProviderAuthSnapshotSchema);
  for (const [provider, authenticated] of entries) {
    message[provider] = authenticated;
  }
  console.log(toJsonString(LocalProviderAuthSnapshotSchema, message));
}

export { providerAuthCommand, providerModelsCommand, providerUsageCommand };
