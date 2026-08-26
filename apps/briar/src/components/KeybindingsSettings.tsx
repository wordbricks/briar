import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import {
  SettingsCard,
  SettingsGroupHeading,
  SettingsNote,
  SettingsSection,
  SettingsToggleRow,
} from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Typography } from "@/components/ui/typography";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import {
  defaultKeybindings,
  formatShortcut,
  keybindingIds,
  loadKeyboardNavigationPreferences,
  loadKeybindings,
  resetKeybinding,
  saveKeybinding,
  saveKeyboardNavigationPreferences,
  setRecordingKeybinding,
  shortcutFromEvent,
  shortcutsEqual,
  type KeybindingId,
  type Keybindings,
  type KeyboardNavigationPreferences,
} from "../lib/keybindings";

const bindingLabels = {
  commandPalette: "appSettings.keybindingsCommandPalette",
  sidebarToggle: "appSettings.keybindingsSidebarToggle",
} satisfies Record<KeybindingId, MessageKey>;

const bindingDescriptions = {
  commandPalette: "appSettings.keybindingsCommandPaletteDescription",
  sidebarToggle: "appSettings.keybindingsSidebarToggleDescription",
} satisfies Record<KeybindingId, MessageKey>;

export function KeybindingsSettings() {
  const { t } = useI18n();
  const [keybindings, setKeybindings] = useState<Keybindings>(loadKeybindings);
  const [navigationPreferences, setNavigationPreferences] =
    useState<KeyboardNavigationPreferences>(
      loadKeyboardNavigationPreferences,
    );
  const [recordingId, setRecordingId] = useState<KeybindingId | null>(null);

  useEffect(() => {
    setRecordingKeybinding(recordingId);
    return () => setRecordingKeybinding(null);
  }, [recordingId]);

  useEffect(() => {
    if (!recordingId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setRecordingId(null);
        return;
      }
      const shortcut = shortcutFromEvent(event);
      if (!shortcut) return;
      event.preventDefault();
      event.stopPropagation();
      setKeybindings(saveKeybinding(recordingId, shortcut));
      setRecordingId(null);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [recordingId]);

  return (
    <SettingsSection>
      <SettingsGroupHeading
        title={t("appSettings.keybindingsKeyboardNavigation")}
      />
      <SettingsCard>
        <SettingsToggleRow
          checked={navigationPreferences.sequenceShortcutsEnabled}
          description={t(
            "appSettings.keybindingsSequenceShortcutsDescription",
          )}
          label={t("appSettings.keybindingsSequenceShortcuts")}
          onCheckedChange={(sequenceShortcutsEnabled) => {
            const next = saveKeyboardNavigationPreferences({
              sequenceShortcutsEnabled,
            });
            setNavigationPreferences(next);
          }}
          title={t("appSettings.keybindingsSequenceShortcuts")}
        />
      </SettingsCard>
      <SettingsGroupHeading title={t("appSettings.keybindingsShortcuts")} />
      <SettingsCard>
        {keybindingIds.map((id) => {
          const shortcut = keybindings[id];
          const recording = recordingId === id;
          const isDefault = shortcutsEqual(shortcut, defaultKeybindings[id]);
          return (
            <div
              className="grid min-h-[72px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border/70 px-[18px] py-4 last:border-b-0"
              data-keybinding-id={id}
              key={id}
            >
              <div className="grid min-w-0 gap-1">
                <Typography as="strong" variant="body">
                  {t(bindingLabels[id])}
                </Typography>
                <Typography as="p" tone="muted" variant="bodySm">
                  {t(bindingDescriptions[id])}
                </Typography>
              </div>
              <div className="flex min-w-0 items-center gap-2 justify-self-end">
                {recording ? (
                  <Typography
                    aria-live="polite"
                    className="shrink-0 text-warning"
                    tone="muted"
                    variant="bodySm"
                  >
                    {t("appSettings.keybindingsRecordHint")}
                  </Typography>
                ) : (
                  <Kbd
                    aria-label={t(bindingLabels[id])}
                    className="h-auto shrink-0 rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs font-medium text-foreground"
                  >
                    {formatShortcut(shortcut)}
                  </Kbd>
                )}
                {recording ? (
                  <Button
                    aria-label={t("appSettings.keybindingsCancel")}
                    onClick={() => setRecordingId(null)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {t("appSettings.keybindingsCancel")}
                  </Button>
                ) : (
                  <Button
                    aria-label={t("appSettings.keybindingsChange")}
                    onClick={() => setRecordingId(id)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {t("appSettings.keybindingsChange")}
                  </Button>
                )}
                {!isDefault && !recording ? (
                  <Button
                    aria-label={t("appSettings.keybindingsReset")}
                    onClick={() => setKeybindings(resetKeybinding(id))}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <RotateCcw aria-hidden="true" />
                    {t("appSettings.keybindingsReset")}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </SettingsCard>
      <SettingsNote>{t("appSettings.keybindingsNote")}</SettingsNote>
    </SettingsSection>
  );
}
