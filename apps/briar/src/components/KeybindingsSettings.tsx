import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import {
  SettingsCard,
  SettingsGroupHeading,
  SettingsNote,
  SettingsSection,
} from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/typography";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import {
  defaultKeybindings,
  formatShortcut,
  keybindingIds,
  loadKeybindings,
  resetKeybinding,
  saveKeybinding,
  setRecordingKeybinding,
  shortcutFromEvent,
  shortcutsEqual,
  type KeybindingId,
  type Keybindings,
} from "../lib/keybindings";

const bindingLabels: Record<KeybindingId, MessageKey> = {
  sidebarToggle: "appSettings.keybindingsSidebarToggle",
};

const bindingDescriptions: Record<KeybindingId, MessageKey> = {
  sidebarToggle: "appSettings.keybindingsSidebarToggleDescription",
};

export function KeybindingsSettings() {
  const { t } = useI18n();
  const [keybindings, setKeybindings] = useState<Keybindings>(loadKeybindings);
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
      <SettingsGroupHeading title={t("appSettings.keybindingsShortcuts")} />
      <SettingsCard>
        {keybindingIds.map((id) => {
          const shortcut = keybindings[id];
          const recording = recordingId === id;
          const isDefault = shortcutsEqual(shortcut, defaultKeybindings[id]);
          return (
            <div
              className="grid min-h-[72px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border/70 px-[18px] py-4 last:border-b-0"
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
                  <kbd
                    aria-label={t(bindingLabels[id])}
                    className="shrink-0 rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs font-medium text-foreground"
                  >
                    {formatShortcut(shortcut)}
                  </kbd>
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
