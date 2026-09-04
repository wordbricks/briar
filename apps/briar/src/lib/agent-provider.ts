import {
  AgentProvider as ProtoAgentProvider,
  AgentProviderSchema,
} from "@briar/contracts/gen/briar/types/v1/provider_pb";
import * as Record from "effect/Record";

/**
 * `briar.types.v1.AgentProvider` owns provider identity (ADR-0008). A platform
 * provider name is the proto value name without its enum prefix, lowercased,
 * so adding a value to the proto adds it to this union without a second edit.
 */
export type AgentProvider = Lowercase<
  Exclude<keyof typeof ProtoAgentProvider, "UNSPECIFIED">
>;

/**
 * Providers in proto enum number order, which is also the menu order. Derived
 * from the generated enum descriptor so the runtime list cannot drift from the
 * type above.
 */
export const agentProviders: readonly AgentProvider[] = AgentProviderSchema
  .values
  .filter((value) => value.number !== 0)
  .sort((left, right) => left.number - right.number)
  .map((value) => value.localName.toLowerCase() as AgentProvider);

/**
 * Marker naming the Briar provider a runner process is executing for.
 *
 * The sidecar `RunRequest` is proto-derived and carries no provider id, and
 * several providers share one runner bundle, so the runner learns which
 * provider it runs as from this environment variable. Every execution
 * environment Briar builds stamps it, which also overrides a stale value
 * inherited from a parent process.
 */
export const agentProviderEnvironmentKey = "BRIAR_AGENT_PROVIDER";

/**
 * Credential an OpenCode upstream authenticates with. Upstreams do not share
 * one credential shape, so the descriptor names the shape and every consumer
 * switches over it exhaustively.
 *
 * - `apiKey`: one secret string Briar stores and hands to the process through
 *   the environment (OpenRouter).
 * - `googleAdc`: Briar stores only the addressing inputs (project and region).
 *   The secret is the machine's Google Application Default Credentials, which
 *   Briar never reads, stores, or transmits (Vertex AI).
 */
export type OpenCodeUpstreamCredential =
  | {
    readonly type: "apiKey";
    /** Environment variable the OpenCode config resolves the key through. */
    readonly environmentVariable: string;
    /** Briar config field holding the saved key. */
    readonly configField: "openrouterApiKey";
  }
  | {
    readonly type: "googleAdc";
    /** Environment variable naming the Google Cloud project. */
    readonly projectEnvironmentVariable: string;
    /** Environment variable naming the Vertex AI region. */
    readonly locationEnvironmentVariable: string;
    /** Briar config field holding the saved project and region. */
    readonly configField: "vertexAi";
  };

/**
 * A credential a user has actually saved, in the shape its descriptor names.
 * The descriptor stays a static table of variable names; this is the runtime
 * value read out of the Briar config.
 */
export type OpenCodeUpstreamCredentialValue =
  | { readonly type: "apiKey"; readonly apiKey: string }
  | {
    readonly type: "googleAdc";
    readonly projectId: string;
    readonly location: string;
  };

/**
 * A provider that is not its own CLI: it runs behind the OpenCode runner with
 * a Briar-generated OpenCode config, and its models are OpenCode models under
 * this upstream's provider id.
 */
export type OpenCodeUpstreamDescriptor = {
  /**
   * Provider id inside OpenCode's `provider` config, which is also the model
   * id prefix (`${openCodeProviderId}/…`).
   */
  readonly openCodeProviderId: string;
  /** Env prefixes the read-only isolation allowlist keeps for this upstream. */
  readonly environmentPrefixes: readonly string[];
  /** Exact env keys the read-only isolation allowlist keeps. */
  readonly environmentKeys: readonly string[];
  readonly credential: OpenCodeUpstreamCredential;
  /**
   * How this upstream's OpenCode catalog is narrowed to models that can drive
   * a coding turn.
   *
   * - `"all"`: every model under the upstream's prefix. OpenRouter's catalog
   *   is already chat models.
   * - `"agentCapable"`: models this upstream serves through its own AI SDK
   *   package that also report tool calling. Vertex AI publishes speech,
   *   image and embedding models under the same provider id, and resells
   *   partner models through an OpenAI-compatible endpoint; none of those can
   *   run an agent turn.
   */
  readonly modelSelection: "all" | "agentCapable";
  /** `"none"` upstreams report connectivity instead of quota windows. */
  readonly usage: "none";
  /** Shown when a turn is requested before the credential is saved. */
  readonly missingCredentialMessage: string;
  /** Shown by `briar provider usage` while the credential is missing. */
  readonly missingCredentialUsageMessage: string;
};

type AgentProviderCatalogEntryBase = {
  /** Name shown in menus, dialogs, and generated agent names. */
  readonly label: string;
  /** Executable Briar looks for on `PATH` when it drives the provider CLI. */
  readonly binaryName: string;
  /** Provider the managed-computer setup agent can connect on its own. */
  readonly managedComputerSetup: boolean;
  /** Provider accepts model ids it never advertised in its capability report. */
  readonly allowsCustomModels: boolean;
};

/**
 * Runtime shape a provider runs under.
 *
 * - `sidecarCli`: its own CLI behind its own `src-agent/<provider>-runner.ts`.
 * - `acpAgent`: an ACP agent driven by the shared `acp-runner.ts`.
 * - `openCodeUpstream`: an upstream model provider behind the OpenCode runner.
 */
export type AgentProviderCatalogEntry =
  | (AgentProviderCatalogEntryBase & { readonly kind: "sidecarCli" })
  | (AgentProviderCatalogEntryBase & { readonly kind: "acpAgent" })
  | (AgentProviderCatalogEntryBase & {
    readonly kind: "openCodeUpstream";
    readonly upstream: OpenCodeUpstreamDescriptor;
  });

/**
 * The one place platform metadata for a provider is written. Typing it as a
 * total `Record` means a proto value with no entry here fails typecheck.
 */
export const agentProviderCatalog = {
  codex: {
    kind: "sidecarCli",
    label: "Codex",
    binaryName: "codex",
    managedComputerSetup: true,
    allowsCustomModels: false,
  },
  claude: {
    kind: "sidecarCli",
    label: "Claude",
    binaryName: "claude",
    managedComputerSetup: true,
    allowsCustomModels: true,
  },
  cursor: {
    kind: "acpAgent",
    label: "Cursor",
    binaryName: "cursor-agent",
    managedComputerSetup: false,
    allowsCustomModels: true,
  },
  grok: {
    kind: "acpAgent",
    label: "Grok",
    binaryName: "grok",
    managedComputerSetup: true,
    allowsCustomModels: false,
  },
  agy: {
    kind: "sidecarCli",
    label: "Antigravity",
    binaryName: "agy",
    managedComputerSetup: false,
    allowsCustomModels: false,
  },
  opencode: {
    kind: "sidecarCli",
    label: "OpenCode",
    binaryName: "opencode",
    managedComputerSetup: true,
    allowsCustomModels: true,
  },
  openrouter: {
    kind: "openCodeUpstream",
    label: "OpenRouter",
    binaryName: "opencode",
    managedComputerSetup: false,
    allowsCustomModels: true,
    upstream: {
      openCodeProviderId: "openrouter",
      environmentPrefixes: ["OPENROUTER_"],
      environmentKeys: ["OPENCODE_CONFIG_CONTENT"],
      credential: {
        type: "apiKey",
        environmentVariable: "OPENROUTER_API_KEY",
        configField: "openrouterApiKey",
      },
      modelSelection: "all",
      usage: "none",
      missingCredentialMessage: "앱 설정에서 OpenRouter API 키를 먼저 저장하세요.",
      missingCredentialUsageMessage: "OpenRouter API 키가 필요합니다.",
    },
  },
  vertex: {
    kind: "openCodeUpstream",
    label: "Vertex AI",
    binaryName: "opencode",
    managedComputerSetup: false,
    allowsCustomModels: true,
    upstream: {
      openCodeProviderId: "google-vertex",
      // `CLOUDSDK_` carries the gcloud config root the Application Default
      // Credentials file is resolved under.
      environmentPrefixes: ["GOOGLE_VERTEX_", "GOOGLE_CLOUD_", "CLOUDSDK_"],
      environmentKeys: [
        "OPENCODE_CONFIG_CONTENT",
        "GOOGLE_APPLICATION_CREDENTIALS",
      ],
      credential: {
        type: "googleAdc",
        projectEnvironmentVariable: "GOOGLE_VERTEX_PROJECT",
        locationEnvironmentVariable: "GOOGLE_VERTEX_LOCATION",
        configField: "vertexAi",
      },
      modelSelection: "agentCapable",
      usage: "none",
      missingCredentialMessage:
        "앱 설정에서 Vertex AI 프로젝트 ID와 리전을 먼저 저장하세요.",
      missingCredentialUsageMessage: "Vertex AI 프로젝트 설정이 필요합니다.",
    },
  },
} as const satisfies Record.ReadonlyRecord<
  AgentProvider,
  AgentProviderCatalogEntry
>;

export type ManagedComputerSetupProvider = {
  [Provider in AgentProvider]: (typeof agentProviderCatalog)[Provider][
    "managedComputerSetup"
  ] extends true ? Provider
    : never;
}[AgentProvider];

export const managedComputerSetupProviders: readonly ManagedComputerSetupProvider[] =
  agentProviders.filter((provider): provider is ManagedComputerSetupProvider =>
    agentProviderCatalog[provider].managedComputerSetup
  );

const agentProviderMenuPositions = new Map<AgentProvider, number>(
  agentProviders.map((provider, index) => [provider, index]),
);

export function sortAgentProviders(
  providers: readonly AgentProvider[],
): AgentProvider[] {
  return providers
    .map((provider, index) => ({ provider, index }))
    .sort((left, right) => {
      const order = (agentProviderMenuPositions.get(left.provider) ?? Infinity) -
        (agentProviderMenuPositions.get(right.provider) ?? Infinity);
      return order || left.index - right.index;
    })
    .map(({ provider }) => provider);
}

export function agentProviderBinaryName(provider: AgentProvider) {
  return agentProviderCatalog[provider].binaryName;
}

export function agentProviderAllowsCustomModels(provider: AgentProvider) {
  return agentProviderCatalog[provider].allowsCustomModels;
}

export const agentProviderLabels = Record.map(
  agentProviderCatalog,
  (entry) => entry.label,
);

/** Providers whose catalog entry declares an OpenCode upstream. */
export type OpenCodeUpstreamProvider = {
  [Provider in AgentProvider]: (typeof agentProviderCatalog)[Provider]["kind"] extends
    "openCodeUpstream" ? Provider
    : never;
}[AgentProvider];

export function isOpenCodeUpstreamProvider(
  provider: AgentProvider,
): provider is OpenCodeUpstreamProvider {
  return agentProviderCatalog[provider].kind === "openCodeUpstream";
}

export const openCodeUpstreamProviders: readonly OpenCodeUpstreamProvider[] =
  agentProviders.filter(isOpenCodeUpstreamProvider);

/** The upstream descriptor for a provider, or `null` when it has its own CLI. */
export function openCodeUpstreamOf(
  provider: AgentProvider,
): OpenCodeUpstreamDescriptor | null {
  const entry = agentProviderCatalog[provider];
  return entry.kind === "openCodeUpstream" ? entry.upstream : null;
}

/** Model ids this upstream advertises are `openrouter/…` under OpenCode. */
export function openCodeUpstreamModelPrefix(
  upstream: OpenCodeUpstreamDescriptor,
) {
  return `${upstream.openCodeProviderId}/`;
}

/**
 * `OPENCODE_CONFIG_CONTENT` Briar generates so OpenCode talks to this upstream.
 * The credential itself stays in the environment; the config only names the
 * variable OpenCode resolves it through.
 */
export function openCodeUpstreamConfigJson(
  upstream: OpenCodeUpstreamDescriptor,
) {
  return JSON.stringify({
    provider: {
      [upstream.openCodeProviderId]: {
        options: openCodeUpstreamOptions(upstream.credential),
      },
    },
  });
}

/**
 * OpenCode's `provider.<id>.options` for a credential shape. OpenCode expands
 * `{env:NAME}` in nested option values, so the generated config names the
 * variables and never carries a value.
 */
function openCodeUpstreamOptions(credential: OpenCodeUpstreamCredential) {
  switch (credential.type) {
    case "apiKey":
      return { apiKey: `{env:${credential.environmentVariable}}` };
    case "googleAdc":
      return {
        project: `{env:${credential.projectEnvironmentVariable}}`,
        location: `{env:${credential.locationEnvironmentVariable}}`,
      };
  }
}

/**
 * Environment pairs a saved credential contributes to a provider process. The
 * value's shape is checked against the descriptor's, so a config field holding
 * the wrong shape fails here instead of reaching the provider.
 */
function openCodeUpstreamCredentialEnvironment(
  upstream: OpenCodeUpstreamDescriptor,
  credential: OpenCodeUpstreamCredentialValue,
): Record<string, string> {
  const { credential: descriptor } = upstream;
  if (descriptor.type === "apiKey" && credential.type === "apiKey") {
    return { [descriptor.environmentVariable]: credential.apiKey };
  }
  if (descriptor.type === "googleAdc" && credential.type === "googleAdc") {
    return {
      [descriptor.projectEnvironmentVariable]: credential.projectId,
      [descriptor.locationEnvironmentVariable]: credential.location,
    };
  }
  throw new Error(upstream.missingCredentialMessage);
}

/** Whether a saved credential carries every input its shape requires. */
function openCodeUpstreamCredentialComplete(
  credential: OpenCodeUpstreamCredentialValue,
) {
  switch (credential.type) {
    case "apiKey":
      return credential.apiKey.trim().length > 0;
    case "googleAdc":
      return credential.projectId.trim().length > 0 &&
        credential.location.trim().length > 0;
  }
}

/**
 * Environment a provider process runs with: the provider marker for every
 * provider, plus the credential and generated OpenCode config for an upstream.
 * Throws the upstream's own message when its credential has not been saved.
 */
export function agentProviderExecutionEnvironment<
  Environment extends Readonly<Record<string, string | undefined>>,
>(
  provider: AgentProvider,
  credential: OpenCodeUpstreamCredentialValue | null | undefined,
  environment: Environment,
): Environment & Record<string, string | undefined> {
  const marked = { ...environment, [agentProviderEnvironmentKey]: provider };
  const upstream = openCodeUpstreamOf(provider);
  if (!upstream) return marked;
  if (!credential || !openCodeUpstreamCredentialComplete(credential)) {
    throw new Error(upstream.missingCredentialMessage);
  }
  return {
    ...marked,
    ...openCodeUpstreamCredentialEnvironment(upstream, credential),
    OPENCODE_CONFIG_CONTENT: openCodeUpstreamConfigJson(upstream),
  };
}

/**
 * Whether this upstream authenticates through Google Application Default
 * Credentials, which live under the real home rather than in the Briar config.
 * Read-only isolation swaps `HOME`, so those turns have to pin the ADC path.
 */
export function usesGoogleApplicationDefaultCredentials(
  provider: AgentProvider,
) {
  return openCodeUpstreamOf(provider)?.credential.type === "googleAdc";
}
