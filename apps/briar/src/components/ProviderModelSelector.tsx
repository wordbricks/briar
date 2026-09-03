import * as PopoverPrimitive from "@radix-ui/react-popover";
import { ChevronDown, Search, Sparkles, Star } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { Kbd } from "@/components/ui/kbd";
import { useAgentProviderModelPreferences } from "../hooks/useAgentProviderModelPreferences";
import { useI18n } from "../i18n";
import { writeAgentProviderModelPreference } from "../lib/agent-model-preferences";
import {
  agentModelOptions,
  agentProviderLabels,
  sortAgentProviders,
  type AgentProvider,
  type AgentProviderModelCatalog,
} from "../lib/team-llm";
import { AgentProviderIcon } from "./AgentIcons";
import type { SelectMenuOption } from "./SelectMenu";

type ProviderFilter = AgentProvider | "default" | "favorites";

export function ProviderModelSelector({
  className,
  compact = false,
  disabled = false,
  disableUnknownSelectedModel = false,
  groupLabel,
  modelLabel,
  modelSearchEmptyMessage,
  modelSearchPlaceholder,
  modelValue,
  onModelChange,
  onProviderChange,
  providerEmptyOption,
  providerLabel,
  providerModels,
  providerValue,
  providers,
  providerDefaultModelLabel,
}: {
  className?: string;
  compact?: boolean;
  disabled?: boolean;
  disableUnknownSelectedModel?: boolean;
  groupLabel: string;
  modelLabel: string;
  modelSearchEmptyMessage?: string;
  modelSearchPlaceholder?: string;
  modelValue: string;
  onModelChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  providerEmptyOption?: Pick<SelectMenuOption, "label" | "value">;
  providerLabel: string;
  providerModels: AgentProviderModelCatalog;
  providerValue: string;
  providers: readonly AgentProvider[];
  providerDefaultModelLabel: string;
}) {
  const { t } = useI18n();
  const preferences = useAgentProviderModelPreferences();
  const orderedProviders = useMemo(
    () => sortAgentProviders(providers),
    [providers],
  );
  const selectedProvider = orderedProviders.find(
    (provider) => provider === providerValue,
  );
  const modelOptionsByProvider = useMemo(
    () => Object.fromEntries(
      orderedProviders.map((provider) => {
        const selectedForProvider = provider === selectedProvider
          ? modelValue
          : null;
        const selectedModelIsKnown = !selectedForProvider ||
          providerModels[provider].models.some(
            (model) => model.id === selectedForProvider,
          );
        const rawOptions = agentModelOptions(
          providerModels,
          provider,
          providerDefaultModelLabel,
          selectedForProvider,
          preferences[provider].favoriteModels,
        ).map((option) => ({
          ...option,
          disabled: Boolean(
            disableUnknownSelectedModel &&
            selectedForProvider &&
            !selectedModelIsKnown &&
            option.value === selectedForProvider
          ),
        }));
        const selectedIndex = selectedForProvider
          ? rawOptions.findIndex((option) => option.value === selectedForProvider)
          : -1;
        const options = selectedIndex > 0
          ? [
              rawOptions[selectedIndex]!,
              ...rawOptions.slice(0, selectedIndex),
              ...rawOptions.slice(selectedIndex + 1),
            ]
          : rawOptions;
        return [provider, options];
      }),
    ) as Partial<Record<AgentProvider, SelectMenuOption[]>>,
    [
      disableUnknownSelectedModel,
      modelValue,
      orderedProviders,
      preferences,
      providerDefaultModelLabel,
      providerModels,
      selectedProvider,
    ],
  );
  const allModels = useMemo(
    () => orderedProviders.flatMap((provider) =>
      (modelOptionsByProvider[provider] ?? []).map((option) => ({
        favorite: Boolean(
          option.value && preferences[provider].favoriteModels.includes(option.value),
        ),
        option,
        provider,
      }))
    ),
    [modelOptionsByProvider, orderedProviders, preferences],
  );
  const selectedOption = selectedProvider
    ? modelOptionsByProvider[selectedProvider]?.find(
        (option) => option.value === modelValue,
      )
    : undefined;
  const [open, setOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<ProviderFilter>(() =>
    selectedProvider ??
      (providerEmptyOption ? "default" : orderedProviders[0] ?? "favorites")
  );
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const controlId = `provider-model-picker-${useId().replaceAll(":", "")}`;
  const listboxId = `${controlId}-listbox`;

  const visibleModels = useMemo(() => {
    if (activeFilter === "default") return [];
    const candidates = activeFilter === "favorites"
      ? allModels.filter((candidate) => candidate.favorite)
      : allModels.filter((candidate) => candidate.provider === activeFilter);
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return candidates;
    return candidates.filter(({ option, provider }) =>
      [
        option.label,
        option.value,
        option.description,
        agentProviderLabels[provider],
      ].filter(Boolean).some((candidate) =>
        candidate!.toLocaleLowerCase().includes(query)
      )
    );
  }, [activeFilter, allModels, searchQuery]);

  const closePicker = useCallback((returnFocus = false) => {
    setOpen(false);
    setSearchQuery("");
    if (returnFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  const selectModel = useCallback((provider: AgentProvider, value: string) => {
    if (provider !== providerValue) onProviderChange(provider);
    if (provider !== providerValue || value !== modelValue) onModelChange(value);
    closePicker(true);
  }, [closePicker, modelValue, onModelChange, onProviderChange, providerValue]);

  const selectDefault = useCallback(() => {
    if (providerValue) onProviderChange("");
    if (providerValue || modelValue) onModelChange("");
    closePicker(true);
  }, [closePicker, modelValue, onModelChange, onProviderChange, providerValue]);

  const toggleFavorite = useCallback((provider: AgentProvider, model: string) => {
    const preference = preferences[provider];
    writeAgentProviderModelPreference(provider, {
      ...preference,
      favoriteModels: preference.favoriteModels.includes(model)
        ? preference.favoriteModels.filter((candidate) => candidate !== model)
        : [...preference.favoriteModels, model],
    });
  }, [preferences]);

  const focusModel = useCallback((index: number) => {
    const candidate = visibleModels[index];
    if (!candidate) return;
    optionRefs.current.get(`${candidate.provider}:${candidate.option.value}`)?.focus();
  }, [visibleModels]);

  const onModelKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    modelIndex: number,
  ) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      focusModel(
        (modelIndex + direction + visibleModels.length) % visibleModels.length,
      );
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusModel(event.key === "Home" ? 0 : visibleModels.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closePicker(true);
    }
  };

  useEffect(() => {
    if (!open) return;
    setActiveFilter(
      selectedProvider ??
        (providerEmptyOption ? "default" : orderedProviders[0] ?? "favorites"),
    );
    setSearchQuery("");
  }, [open, orderedProviders, providerEmptyOption, selectedProvider]);

  useEffect(() => {
    if (!open) return;
    const onShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const shortcut = Number.parseInt(event.key, 10);
      if (shortcut < 1 || shortcut > 9) return;
      const candidate = visibleModels[shortcut - 1];
      if (!candidate || candidate.option.disabled) return;
      event.preventDefault();
      selectModel(candidate.provider, candidate.option.value);
    };
    document.addEventListener("keydown", onShortcut);
    return () => document.removeEventListener("keydown", onShortcut);
  }, [open, selectModel, visibleModels]);

  const pickerDisabled = disabled || (
    orderedProviders.length === 0 && !providerEmptyOption
  );
  const triggerLabel = selectedProvider
    ? ((selectedOption?.label ?? modelValue) || providerDefaultModelLabel)
    : (providerEmptyOption?.label ?? modelLabel);
  const portalContainer = triggerRef.current?.closest<HTMLElement>('[role="dialog"]') ??
    undefined;

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
      <span className="provider-model-selector-label">
        {providerLabel} · {modelLabel}
      </span>
      <PopoverPrimitive.Root onOpenChange={setOpen} open={open}>
        <PopoverPrimitive.Trigger asChild>
          <button
            aria-controls={`${controlId}-dialog`}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label={modelLabel}
            className="provider-model-selector-trigger"
            data-provider={selectedProvider}
            disabled={pickerDisabled}
            id={controlId}
            ref={triggerRef}
            type="button"
          >
            <span className="provider-model-selector-trigger-icon">
              {selectedProvider ? (
                <AgentProviderIcon provider={selectedProvider} size={compact ? 16 : 18} />
              ) : (
                <Sparkles aria-hidden="true" size={compact ? 16 : 18} />
              )}
            </span>
            <span className="provider-model-selector-trigger-copy">
              {triggerLabel}
            </span>
            <ChevronDown
              aria-hidden="true"
              className="provider-model-selector-chevron"
              size={15}
              strokeWidth={1.9}
            />
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal container={portalContainer}>
          <PopoverPrimitive.Content
            align="start"
            aria-label={groupLabel}
            className="provider-model-picker"
            collisionPadding={10}
            id={`${controlId}-dialog`}
            onCloseAutoFocus={(event) => event.preventDefault()}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              window.requestAnimationFrame(() => searchInputRef.current?.focus());
            }}
            side={compact ? "top" : "bottom"}
            sideOffset={7}
            role="dialog"
          >
            <nav aria-label={providerLabel} className="provider-model-picker-providers">
              <button
                aria-label={t("issue.favoriteModels")}
                aria-pressed={activeFilter === "favorites"}
                className="provider-model-picker-provider"
                data-filter="favorites"
                onClick={() => setActiveFilter("favorites")}
                title={t("issue.favoriteModels")}
                type="button"
              >
                <Star
                  fill={activeFilter === "favorites" ? "currentColor" : "none"}
                  size={21}
                  strokeWidth={1.8}
                />
              </button>
              {providerEmptyOption ? (
                <button
                  aria-label={providerEmptyOption.label}
                  aria-pressed={activeFilter === "default"}
                  className="provider-model-picker-provider"
                  data-filter="default"
                  onClick={() => setActiveFilter("default")}
                  title={providerEmptyOption.label}
                  type="button"
                >
                  <Sparkles size={20} strokeWidth={1.8} />
                </button>
              ) : null}
              <span aria-hidden="true" className="provider-model-picker-provider-divider" />
              {orderedProviders.map((provider) => (
                <button
                  aria-label={agentProviderLabels[provider]}
                  aria-pressed={activeFilter === provider}
                  className="provider-model-picker-provider"
                  data-provider={provider}
                  key={provider}
                  onClick={() => setActiveFilter(provider)}
                  title={agentProviderLabels[provider]}
                  type="button"
                >
                  <AgentProviderIcon provider={provider} size={22} />
                </button>
              ))}
            </nav>
            <section className="provider-model-picker-models">
              <label className="provider-model-picker-search">
                <Search aria-hidden="true" size={17} strokeWidth={1.9} />
                <input
                  aria-label={modelSearchPlaceholder}
                  autoComplete="off"
                  onChange={(event) => setSearchQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      focusModel(0);
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      focusModel(visibleModels.length - 1);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      closePicker(true);
                    }
                  }}
                  placeholder={modelSearchPlaceholder}
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                />
              </label>
              <div
                aria-label={modelLabel}
                className="provider-model-picker-options"
                id={listboxId}
                role="group"
              >
                {activeFilter === "default" && providerEmptyOption ? (
                  <button
                    aria-pressed={!providerValue}
                    className="provider-model-picker-option-row is-default"
                    data-value=""
                    onClick={selectDefault}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        closePicker(true);
                      }
                    }}
                    type="button"
                  >
                    <span className="provider-model-picker-option-copy">
                      <strong>{providerEmptyOption.label}</strong>
                      <small><Sparkles size={14} /> {groupLabel}</small>
                    </span>
                  </button>
                ) : visibleModels.map((candidate, index) => {
                  const { favorite, option, provider } = candidate;
                  const selected = provider === providerValue && option.value === modelValue;
                  const optionKey = `${provider}:${option.value}`;
                  return (
                    <div
                      className="provider-model-picker-option-row"
                      data-selected={selected || undefined}
                      key={optionKey}
                    >
                      <button
                        aria-pressed={selected}
                        className="provider-model-picker-option"
                        data-provider={provider}
                        data-value={option.value}
                        disabled={option.disabled}
                        onClick={() => selectModel(provider, option.value)}
                        onKeyDown={(event) => onModelKeyDown(event, index)}
                        ref={(node) => {
                          if (node) optionRefs.current.set(optionKey, node);
                          else optionRefs.current.delete(optionKey);
                        }}
                        tabIndex={-1}
                        type="button"
                      >
                        <span className="provider-model-picker-option-copy">
                          <strong>{option.label}</strong>
                          <small>
                            <AgentProviderIcon provider={provider} size={14} />
                            {agentProviderLabels[provider]}
                            {option.description ? <span>{option.description}</span> : null}
                          </small>
                        </span>
                        {index < 9 ? <Kbd aria-hidden="true">⌘{index + 1}</Kbd> : null}
                      </button>
                      {option.value && !option.disabled ? (
                        <button
                          aria-label={t(
                            favorite
                              ? "appSettings.removeFavoriteModel"
                              : "appSettings.addFavoriteModel",
                            { model: option.label },
                          )}
                          aria-pressed={favorite}
                          className="provider-model-picker-favorite"
                          onClick={(event) => {
                            toggleFavorite(provider, option.value);
                          }}
                          title={t(
                            favorite
                              ? "appSettings.removeFavoriteModel"
                              : "appSettings.addFavoriteModel",
                            { model: option.label },
                          )}
                          type="button"
                        >
                          <Star
                            fill={favorite ? "currentColor" : "none"}
                            size={18}
                            strokeWidth={1.8}
                          />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                {activeFilter !== "default" && visibleModels.length === 0 ? (
                  <p className="provider-model-picker-empty">
                    {modelSearchEmptyMessage}
                  </p>
                ) : null}
              </div>
            </section>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </div>
  );
}
