import { Keyboard, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n";

export type KeyboardShortcutHelpItem = {
  description?: string;
  id: string;
  join?: "or" | "then";
  keys: readonly string[];
  label: string;
};

export type KeyboardShortcutHelpSection = {
  id: string;
  items: readonly KeyboardShortcutHelpItem[];
  label: string;
};

function normalizedSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .toLocaleLowerCase()
    .trim();
}

export function KeyboardShortcutsDialog({
  onOpenChange,
  open,
  sections,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  sections: readonly KeyboardShortcutHelpSection[];
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const filteredSections = useMemo(() => {
    const normalizedQuery = normalizedSearchText(query);
    if (!normalizedQuery) return sections;
    return sections.flatMap((section) => {
      const items = section.items.filter((item) =>
        normalizedSearchText(
          `${item.label} ${item.description ?? ""} ${item.keys.join(" ")}`,
        ).includes(normalizedQuery)
      );
      return items.length > 0 ? [{ ...section, items }] : [];
    });
  }, [query, sections]);
  const resultCount = filteredSections.reduce(
    (count, section) => count + section.items.length,
    0,
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        aria-describedby="keyboard-shortcuts-description"
        className="top-[7vh] z-[1310] block max-h-[86vh] w-[min(780px,calc(100vw-24px))] max-w-none translate-y-0 overflow-hidden rounded-2xl border-border/80 bg-card p-0 shadow-2xl backdrop-blur-xl"
        closeLabel={t("common.close")}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
        overlayClassName="z-[1310] bg-foreground/30 backdrop-blur-[3px]"
      >
        <header className="border-b border-border/70 px-5 pb-4 pt-5">
          <div className="flex items-start gap-3 pr-9">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-border/70 bg-muted/60 text-muted-foreground">
              <Keyboard aria-hidden="true" size={18} />
            </span>
            <div className="min-w-0">
              <DialogTitle>{t("keyboardShortcuts.title")}</DialogTitle>
              <DialogDescription id="keyboard-shortcuts-description">
                {t("keyboardShortcuts.description")}
              </DialogDescription>
            </div>
          </div>
          <label className="mt-4 flex h-10 items-center gap-2 rounded-xl border border-border/80 bg-background/70 px-3 focus-within:ring-2 focus-within:ring-ring">
            <Search
              aria-hidden="true"
              className="shrink-0 text-muted-foreground"
              size={16}
            />
            <input
              aria-label={t("keyboardShortcuts.search")}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("keyboardShortcuts.searchPlaceholder")}
              ref={inputRef}
              type="search"
              value={query}
            />
          </label>
        </header>

        <div className="max-h-[calc(86vh-168px)] overflow-y-auto overscroll-contain p-3 sm:p-4">
          {resultCount > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {filteredSections.map((section) => (
                <section
                  aria-labelledby={`keyboard-shortcuts-section-${section.id}`}
                  className={cn(
                    "overflow-hidden rounded-xl border border-border/70 bg-background/45",
                    section.items.length > 5 && "sm:row-span-2",
                  )}
                  key={section.id}
                >
                  <h2
                    className="border-b border-border/60 bg-muted/35 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
                    id={`keyboard-shortcuts-section-${section.id}`}
                  >
                    {section.label}
                  </h2>
                  <dl className="divide-y divide-border/55">
                    {section.items.map((item) => (
                      <div
                        className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2"
                        key={item.id}
                      >
                        <div className="min-w-0">
                          <dt className="text-[13px] font-medium text-foreground">
                            {item.label}
                          </dt>
                          {item.description ? (
                            <dd className="mt-0.5 text-[11px] text-muted-foreground">
                              {item.description}
                            </dd>
                          ) : null}
                        </div>
                        <dd
                          aria-label={item.keys.join(
                            ` ${t(
                              item.join === "or"
                                ? "keyboardShortcuts.or"
                                : "keyboardShortcuts.then",
                            )} `,
                          )}
                          className="flex shrink-0 items-center gap-1"
                        >
                          {item.keys.map((key, index) => (
                            <span className="contents" key={`${item.id}-${key}-${index}`}>
                              {index > 0 ? (
                                <span
                                  aria-hidden="true"
                                  className="text-[10px] text-muted-foreground"
                                >
                                  {t(
                                    item.join === "or"
                                      ? "keyboardShortcuts.or"
                                      : "keyboardShortcuts.then",
                                  )}
                                </span>
                              ) : null}
                              <kbd className="min-w-6 rounded-md border border-border bg-card px-1.5 py-1 text-center font-mono text-[10px] font-semibold text-foreground shadow-xs">
                                {key}
                              </kbd>
                            </span>
                          ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          ) : (
            <div className="grid min-h-52 place-items-center px-6 text-center">
              <div>
                <Search
                  aria-hidden="true"
                  className="mx-auto mb-3 text-muted-foreground/65"
                  size={28}
                />
                <p className="text-sm font-medium text-foreground">
                  {t("keyboardShortcuts.noResults")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("keyboardShortcuts.noResultsHint")}
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
