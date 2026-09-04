import type {
  AgentProviderAvailability,
  AgentProviderKind,
} from "../generated/tauri";

/*
  Which agent backend a repository connection runs its analysis on.

  The connection preflight reports every provider with the reason it can or
  cannot run — install, sign-in, the app settings switch, and a spent usage
  window. Install and sign-in decide whether a provider can be picked at all;
  an exhausted quota only decides which provider is picked by default, because
  a limit that resets in an hour is the user's call to make.
*/

/** Why a provider is not the obvious choice, for the connection screen copy. */
export type ProviderChoiceNote =
  | { readonly kind: "disabled" }
  | { readonly kind: "notInstalled" }
  | { readonly kind: "notAuthenticated" }
  | { readonly kind: "usageExhausted"; readonly resetsAt: number | null }
  | { readonly kind: "usage"; readonly usedPercent: number }
  | null;

export function providerChoiceNote(
  availability: AgentProviderAvailability,
): ProviderChoiceNote {
  if (!availability.enabled) return { kind: "disabled" };
  if (!availability.installed) return { kind: "notInstalled" };
  if (!availability.authenticated) return { kind: "notAuthenticated" };
  if (availability.usageExhausted) {
    return { kind: "usageExhausted", resetsAt: availability.usageResetsAt };
  }
  return availability.maxUsedPercent === null
    ? null
    : { kind: "usage", usedPercent: availability.maxUsedPercent };
}

/** Providers the user may pick, in the order the preflight reported them. */
export function selectableProviders(
  providers: readonly AgentProviderAvailability[],
): AgentProviderKind[] {
  return providers
    .filter((availability) => availability.selectable)
    .map((availability) => availability.provider);
}

/**
 * The provider a connection screen should show as chosen. An explicit choice
 * survives a repeated preflight; it is dropped only once that provider stops
 * being usable, which is when the fallback matters.
 */
export function preferredProvider(
  providers: readonly AgentProviderAvailability[],
  chosen: AgentProviderKind | null,
  resolved: AgentProviderKind,
): AgentProviderKind {
  const isSelectable = (provider: AgentProviderKind) =>
    providers.some(
      (availability) =>
        availability.provider === provider && availability.selectable,
    );
  if (chosen && isSelectable(chosen)) return chosen;
  return resolved;
}

/** True when connecting on this provider will start against a spent quota. */
export function isProviderUsageExhausted(
  providers: readonly AgentProviderAvailability[],
  provider: AgentProviderKind | null,
): boolean {
  return providers.some(
    (availability) =>
      availability.provider === provider && availability.usageExhausted,
  );
}
