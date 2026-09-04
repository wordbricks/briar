import { Check, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useI18n } from "../i18n";
import { teamIconColors, teamIcons } from "../lib/team-icon-library";
import { teamIconComponent } from "./TeamIcon";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";
import { Typography } from "./ui/typography";

export function TeamIconPicker({
  disabled = false,
  onOpenChange,
  onSelect,
  open,
  selectedColor,
  selectedName,
}: {
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (icon: { name: string; color: string | null }) => Promise<void>;
  open: boolean;
  selectedColor: string | null;
  selectedName: string | null;
}) {
  const { localeTag, t } = useI18n();
  const [query, setQuery] = useState("");
  const [color, setColor] = useState<string | null>(selectedColor);
  const [savingName, setSavingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setColor(selectedColor);
      setError(null);
    }
  }, [open, selectedColor]);

  const visibleIcons = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return teamIcons;
    return teamIcons.filter((icon) =>
      [icon.name, icon.ko, icon.en].some((value) =>
        value.toLocaleLowerCase().includes(normalized),
      ),
    );
  }, [query]);

  const labelFor = (icon: { ko: string; en: string }) =>
    localeTag.startsWith("ko") ? icon.ko : icon.en;

  const select = (name: string, nextColor: string | null) => {
    if (disabled || savingName) return;
    setSavingName(name);
    setError(null);
    void onSelect({ name, color: nextColor })
      .then(() => onOpenChange(false))
      .catch(() => setError(t("settings.iconLibrarySaveFailed")))
      .finally(() => setSavingName(null));
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-w-xl"
        closeLabel={t("common.close")}
      >
        <DialogHeader>
          <DialogTitle>{t("settings.iconLibraryTitle")}</DialogTitle>
          <DialogDescription>
            {t("settings.iconLibraryDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("settings.iconColorLabel")}>
          <button
            aria-label={t("settings.iconColorDefault")}
            aria-pressed={color === null}
            className="grid size-6 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-secondary"
            disabled={disabled || Boolean(savingName)}
            onClick={() => {
              setColor(null);
              if (selectedName) select(selectedName, null);
            }}
            type="button"
          >
            {color === null ? <Check aria-hidden="true" size={13} strokeWidth={2.4} /> : <span aria-hidden="true" className="text-[10px]">A</span>}
          </button>
          {teamIconColors.map((swatch) => (
            <button
              aria-label={t("settings.iconColorSwatch", { color: swatch })}
              aria-pressed={color === swatch}
              className="size-6 rounded-full border border-transparent transition-transform hover:scale-110 aria-pressed:border-foreground/60"
              disabled={disabled || Boolean(savingName)}
              key={swatch}
              onClick={() => {
                setColor(swatch);
                if (selectedName) select(selectedName, swatch);
              }}
              style={{ backgroundColor: swatch }}
              type="button"
            >
              {color === swatch ? (
                <Check aria-hidden="true" className="mx-auto text-white" size={13} strokeWidth={2.4} />
              ) : null}
            </button>
          ))}
        </div>
        <label className="relative block">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            size={15}
          />
          <Input
            aria-label={t("settings.iconLibrarySearch")}
            className="pl-8"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("settings.iconLibrarySearch")}
            value={query}
          />
        </label>
        <div className="grid max-h-72 grid-cols-8 gap-1 overflow-y-auto sm:grid-cols-10">
          {visibleIcons.map((icon) => {
            const Icon = teamIconComponent(icon.name);
            const isSelected = selectedName === icon.name;
            const saving = savingName === icon.name;
            return (
              <button
                aria-label={t("settings.iconLibrarySelect", { name: labelFor(icon) })}
                aria-pressed={isSelected}
                className="grid aspect-square place-items-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-secondary aria-pressed:border-foreground/40"
                disabled={disabled || Boolean(savingName)}
                key={icon.name}
                onClick={() => select(icon.name, color)}
                title={labelFor(icon)}
                type="button"
              >
                {saving ? (
                  <Spinner className="size-[16px]" />
                ) : (
                  <Icon
                    aria-hidden="true"
                    size={18}
                    strokeWidth={1.8}
                    style={color ? { color } : undefined}
                  />
                )}
              </button>
            );
          })}
        </div>
        {visibleIcons.length === 0 ? (
          <Typography tone="muted" variant="caption">
            {t("settings.iconLibraryEmpty")}
          </Typography>
        ) : null}
        {error ? (
          <Typography className="text-destructive" role="alert" variant="caption">
            {error}
          </Typography>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
