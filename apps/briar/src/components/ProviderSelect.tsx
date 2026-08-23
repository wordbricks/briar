import type { ComponentProps } from "react";

import {
  agentProviderLabels,
  agentProviders,
  sortAgentProviders,
  type AgentProvider,
} from "../lib/project-llm";
import { AgentProviderIcon } from "./AgentIcons";
import { SelectMenu, type SelectMenuOption } from "./SelectMenu";

type ProviderSelectProps = Omit<ComponentProps<typeof SelectMenu>, "options"> & {
  emptyOption?: Pick<SelectMenuOption, "label" | "value">;
  optionExtras?: (
    provider: AgentProvider,
  ) => Partial<Omit<SelectMenuOption, "label" | "leading" | "value">>;
  providers?: readonly AgentProvider[];
};

function providerSelectOptions(
  providers: readonly AgentProvider[],
  extras?: (
    provider: AgentProvider,
  ) => Partial<Omit<SelectMenuOption, "label" | "leading" | "value">>,
  iconSize = 16,
): SelectMenuOption[] {
  return sortAgentProviders(providers).map((provider) => ({
    ...extras?.(provider),
    label: agentProviderLabels[provider],
    leading: <AgentProviderIcon provider={provider} size={iconSize} />,
    value: provider,
  }));
}

export function ProviderSelect({
  className,
  emptyOption,
  optionExtras,
  providers = agentProviders,
  size = "large",
  ...props
}: ProviderSelectProps) {
  const iconSize = size === "small" ? 14 : 16;
  const options = [
    ...(emptyOption ? [emptyOption] : []),
    ...providerSelectOptions(providers, optionExtras, iconSize),
  ];

  return (
    <SelectMenu
      {...props}
      className={[size === "large" ? "native-select" : null, className]
        .filter(Boolean)
        .join(" ")}
      options={options}
      size={size}
    />
  );
}
