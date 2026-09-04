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

export type AgentProviderCatalogEntry = {
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
 * The one place platform metadata for a provider is written. Typing it as a
 * total `Record` means a proto value with no entry here fails typecheck.
 */
export const agentProviderCatalog = {
  codex: {
    label: "Codex",
    binaryName: "codex",
    managedComputerSetup: true,
    allowsCustomModels: false,
  },
  claude: {
    label: "Claude",
    binaryName: "claude",
    managedComputerSetup: true,
    allowsCustomModels: true,
  },
  cursor: {
    label: "Cursor",
    binaryName: "cursor-agent",
    managedComputerSetup: false,
    allowsCustomModels: true,
  },
  grok: {
    label: "Grok",
    binaryName: "grok",
    managedComputerSetup: true,
    allowsCustomModels: false,
  },
  agy: {
    label: "Antigravity",
    binaryName: "agy",
    managedComputerSetup: false,
    allowsCustomModels: false,
  },
  opencode: {
    label: "OpenCode",
    binaryName: "opencode",
    managedComputerSetup: true,
    allowsCustomModels: true,
  },
  openrouter: {
    label: "OpenRouter",
    binaryName: "opencode",
    managedComputerSetup: false,
    allowsCustomModels: true,
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
