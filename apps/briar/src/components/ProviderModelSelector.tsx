import { BrainCircuit, Waypoints } from "lucide-react";

import type { AgentProvider } from "../lib/project-llm";
import { ProviderSelect } from "./ProviderSelect";
import { SelectMenu, type SelectMenuOption } from "./SelectMenu";

export function ProviderModelSelector({
  className,
  compact = false,
  disabled = false,
  groupLabel,
  modelClassName,
  modelDisabled = false,
  modelLabel,
  modelOptions,
  modelPlaceholder,
  modelSearchEmptyMessage,
  modelSearchPlaceholder,
  modelSearchable = false,
  modelValue,
  onModelChange,
  onProviderChange,
  providerClassName,
  providerEmptyOption,
  providerLabel,
  providers,
  providerValue,
}: {
  className?: string;
  compact?: boolean;
  disabled?: boolean;
  groupLabel: string;
  modelClassName?: string;
  modelDisabled?: boolean;
  modelLabel: string;
  modelOptions: SelectMenuOption[];
  modelPlaceholder?: string;
  modelSearchEmptyMessage?: string;
  modelSearchPlaceholder?: string;
  modelSearchable?: boolean;
  modelValue: string;
  onModelChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  providerClassName?: string;
  providerEmptyOption?: Pick<SelectMenuOption, "label" | "value">;
  providerLabel: string;
  providers: readonly AgentProvider[];
  providerValue: string;
}) {
  const size = compact ? "small" : "large";

  return (
    <div
      aria-label={groupLabel}
      className={[
        "provider-model-selector",
        compact ? "is-compact" : null,
        className,
      ].filter(Boolean).join(" ")}
      role="group"
    >
      <div className="provider-model-selector-field provider">
        <span className="provider-model-selector-label">
          <Waypoints aria-hidden="true" size={15} />
          {providerLabel}
        </span>
        <ProviderSelect
          className={[
            "provider-model-selector-provider",
            providerClassName,
          ].filter(Boolean).join(" ")}
          disabled={disabled}
          emptyOption={providerEmptyOption}
          label={providerLabel}
          onValueChange={onProviderChange}
          providers={providers}
          size={size}
          value={providerValue}
        />
      </div>
      <div className="provider-model-selector-field model">
        <span className="provider-model-selector-label">
          <BrainCircuit aria-hidden="true" size={15} />
          {modelLabel}
        </span>
        <SelectMenu
          className={[
            !compact ? "native-select" : null,
            "provider-model-selector-model",
            modelClassName,
          ].filter(Boolean).join(" ")}
          disabled={disabled || modelDisabled}
          label={modelLabel}
          leadingIcon={<BrainCircuit aria-hidden="true" size={15} />}
          onValueChange={onModelChange}
          options={modelOptions}
          placeholder={modelPlaceholder}
          searchEmptyMessage={modelSearchEmptyMessage}
          searchPlaceholder={modelSearchPlaceholder}
          searchable={modelSearchable}
          size={size}
          value={modelValue}
        />
      </div>
    </div>
  );
}
