import { Check, CornerDownLeft, LoaderCircle, Search } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useI18n } from "../i18n";
import {
  groupCommandPaletteItems,
  loadCommandPaletteRecents,
  rememberCommandPaletteItem,
  type CommandPaletteSearchItem,
} from "../lib/command-palette";

export type CommandPaletteItem = CommandPaletteSearchItem & {
  active?: boolean;
  icon?: ReactNode;
  onSelect: () => void;
  remember?: boolean;
  restoreFocusOnSelect?: boolean;
  shortcut?: string;
};

const emptyGroupLimit = 6;
const searchGroupLimit = 20;
const emptySectionOrder = new Map([
  ["context", 0],
  ["continue", 1],
  ["recent", 2],
  ["actions", 3],
  ["navigation", 4],
  ["projects", 5],
  ["issues", 6],
  ["channels", 7],
  ["direct-messages", 8],
]);

function keyboardEventIsComposing(
  event: KeyboardEvent<HTMLInputElement> | globalThis.KeyboardEvent,
): boolean {
  const nativeEvent = "nativeEvent" in event ? event.nativeEvent : event;
  return nativeEvent.isComposing || nativeEvent.keyCode === 229;
}

function canReceiveRestoredFocus(element: HTMLElement): boolean {
  return (
    element !== document.body &&
    element.isConnected &&
    !element.closest("[inert], [hidden]")
  );
}

function focusWithoutScrolling(element: HTMLElement) {
  const addedTabIndex = element.tabIndex < 0 && !element.hasAttribute("tabindex");
  if (addedTabIndex) element.setAttribute("tabindex", "-1");
  element.focus({ preventScroll: true });
  if (!addedTabIndex) return;
  if (document.activeElement !== element) {
    element.removeAttribute("tabindex");
    return;
  }
  element.addEventListener(
    "blur",
    () => element.removeAttribute("tabindex"),
    { once: true },
  );
}

export function CommandPalette({
  contextLabel,
  initialQuery = "",
  items,
  loading = false,
  onOpenChange,
  open,
  shortcutLabel,
}: {
  contextLabel?: string | null;
  initialQuery?: string;
  items: readonly CommandPaletteItem[];
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  shortcutLabel: string;
}) {
  const { t } = useI18n();
  const generatedId = useId().replaceAll(":", "");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocusOnCloseRef = useRef(true);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [recentIds, setRecentIds] = useState<string[]>(() =>
    open ? loadCommandPaletteRecents() : []
  );

  useEffect(() => {
    if (!open) return;
    restoreFocusOnCloseRef.current = true;
    setQuery(initialQuery);
    setActiveId(null);
    setRecentIds(loadCommandPaletteRecents());
  }, [initialQuery, open]);

  const hasQuery = query.trim().length > 0;
  const matchedGroups = useMemo(() => {
    const matched = groupCommandPaletteItems(items, query);
    if (hasQuery) return matched;
    return matched.sort(
      (left, right) =>
        (emptySectionOrder.get(left.section) ?? Number.MAX_SAFE_INTEGER) -
        (emptySectionOrder.get(right.section) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [hasQuery, items, query]);
  const totalResultCount = useMemo(
    () =>
      matchedGroups.reduce(
        (count, group) => count + group.items.length,
        0,
      ),
    [matchedGroups],
  );
  const groups = useMemo(() => {
    const limit = hasQuery ? searchGroupLimit : emptyGroupLimit;
    if (hasQuery || recentIds.length === 0) {
      return matchedGroups.map((group) => ({
        ...group,
        items: group.items.slice(0, limit),
      }));
    }

    const itemById = new Map(items.map((item) => [item.id, item]));
    const recentItems = recentIds.flatMap((id) => {
      const item = itemById.get(id);
      return item && item.remember !== false ? [item] : [];
    });
    if (recentItems.length === 0) {
      return matchedGroups.map((group) => ({
        ...group,
        items: group.items.slice(0, limit),
      }));
    }

    const recentSet = new Set(recentItems.map(({ id }) => id));
    return [
      {
        items: recentItems,
        section: "recent",
        sectionLabel: t("commandPalette.groupRecent"),
      },
      ...matchedGroups.flatMap((group) => {
        const remaining = group.items
          .filter(({ id }) => !recentSet.has(id))
          .slice(0, limit);
        return remaining.length > 0 ? [{ ...group, items: remaining }] : [];
      }),
    ].sort(
      (left, right) =>
        (emptySectionOrder.get(left.section) ?? Number.MAX_SAFE_INTEGER) -
        (emptySectionOrder.get(right.section) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [hasQuery, items, matchedGroups, recentIds, t]);
  const visibleItems = useMemo(
    () => groups.flatMap((group) => group.items),
    [groups],
  );
  const storedActiveIndex = activeId
    ? visibleItems.findIndex((item) => item.id === activeId)
    : -1;
  const activeIndex = storedActiveIndex >= 0 ? storedActiveIndex : 0;
  const activeItem = visibleItems[activeIndex] ?? null;
  const activeItemId = activeItem?.id ?? null;
  const listboxId = `command-palette-${generatedId}-listbox`;
  const activeOptionId = activeItem
    ? `command-palette-${generatedId}-option-${activeItem.id}`
    : undefined;

  useEffect(() => {
    setActiveId((current) =>
      current && visibleItems.some((item) => item.id === current)
        ? current
        : visibleItems[0]?.id ?? null
    );
  }, [visibleItems]);

  useEffect(() => {
    if (!activeItemId) return;
    optionRefs.current.get(activeItemId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeItemId]);

  const selectItem = (item: CommandPaletteItem) => {
    if (item.remember !== false) {
      setRecentIds(rememberCommandPaletteItem(item.id));
    }
    restoreFocusOnCloseRef.current = item.restoreFocusOnSelect !== false;
    handleOpenChange(false);
    item.onSelect();
  };

  const moveActive = (direction: 1 | -1) => {
    if (visibleItems.length === 0) return;
    const nextIndex =
      (activeIndex + direction + visibleItems.length) % visibleItems.length;
    setActiveId(visibleItems[nextIndex]?.id ?? null);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (keyboardEventIsComposing(event)) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" && activeItem) {
      event.preventDefault();
      selectItem(activeItem);
    }
  };

  const restorePreviousFocus = () => {
    const target = returnFocusRef.current;
    queueMicrotask(() => {
      if (document.activeElement && document.activeElement !== document.body) {
        return;
      }
      const main = [...document.querySelectorAll<HTMLElement>('main, [role="main"]')]
        .find(canReceiveRestoredFocus);
      const focusTarget = target && canReceiveRestoredFocus(target)
        ? target
        : main;
      if (focusTarget) focusWithoutScrolling(focusTarget);
    });
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen && restoreFocusOnCloseRef.current) restorePreviousFocus();
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        aria-describedby={`command-palette-${generatedId}-description`}
        className="top-[14vh] z-[1300] block w-[min(680px,calc(100vw-24px))] max-w-none translate-y-0 gap-0 overflow-hidden rounded-2xl border-border/80 bg-card p-0 shadow-2xl backdrop-blur-xl duration-150"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (restoreFocusOnCloseRef.current) restorePreviousFocus();
        }}
        onEscapeKeyDown={(event) => {
          if (keyboardEventIsComposing(event)) {
            event.preventDefault();
          }
        }}
        overlayClassName="z-[1300] bg-foreground/30 backdrop-blur-[3px]"
        showClose={false}
      >
        <DialogTitle className="sr-only">
          {t("commandPalette.title")}
        </DialogTitle>
        <DialogDescription
          className="sr-only"
          id={`command-palette-${generatedId}-description`}
        >
          {t("commandPalette.description")}
        </DialogDescription>

        <div className="border-b border-border/70 px-4 pb-3 pt-3.5">
          <div className="mb-2 flex min-h-5 items-center justify-between gap-3 px-1">
            <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {contextLabel ?? t("commandPalette.globalContext")}
            </span>
            <Kbd className="h-auto shrink-0 rounded border border-border/80 bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
              {shortcutLabel}
            </Kbd>
          </div>
          <div className="flex items-center gap-3">
            <Search
              aria-hidden="true"
              className="shrink-0 text-muted-foreground"
              size={20}
              strokeWidth={1.8}
            />
            <input
              aria-activedescendant={activeOptionId}
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-expanded="true"
              aria-label={t("commandPalette.searchLabel")}
              autoComplete="off"
              className="h-10 min-w-0 flex-1 bg-transparent text-[17px] text-foreground outline-none placeholder:text-muted-foreground/80"
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveId(null);
              }}
              onKeyDown={handleInputKeyDown}
              placeholder={t("commandPalette.placeholder")}
              ref={inputRef}
              role="combobox"
              spellCheck={false}
              value={query}
            />
          </div>
        </div>

        <div className="max-h-[min(58vh,520px)] overflow-y-auto overscroll-contain p-2">
          <div
            aria-label={t("commandPalette.results")}
            id={listboxId}
            role="listbox"
          >
            {groups.map((group) => (
              <section
                aria-label={group.sectionLabel}
                className="pb-1 last:pb-0"
                key={group.section}
                role="group"
              >
                <h3
                  aria-hidden="true"
                  className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
                >
                  {group.sectionLabel}
                </h3>
                {group.items.map((item) => {
                  const selected = item.id === activeItemId;
                  const optionId =
                    `command-palette-${generatedId}-option-${item.id}`;
                  return (
                    <button
                      aria-selected={selected}
                      className={`group flex min-h-[48px] w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-none transition-colors ${
                        selected
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground hover:bg-muted/70"
                      }`}
                      id={optionId}
                      key={item.id}
                      onClick={() => selectItem(item)}
                      onMouseEnter={() => setActiveId(item.id)}
                      ref={(element) => {
                        if (element) optionRefs.current.set(item.id, element);
                        else optionRefs.current.delete(item.id);
                      }}
                      role="option"
                      tabIndex={-1}
                      type="button"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-background/70 text-muted-foreground shadow-xs [&>img]:size-full [&>img]:object-cover [&>svg]:size-4">
                        {item.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-[13px] font-medium">
                          {item.label}
                        </strong>
                        {item.description ? (
                          <small className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                            {item.description}
                          </small>
                        ) : null}
                      </span>
                      {item.active ? (
                        <Check
                          aria-label={t("commandPalette.current")}
                          className="shrink-0 text-primary"
                          size={15}
                          strokeWidth={2.2}
                        />
                      ) : null}
                      {item.shortcut ? (
                        <Kbd className="h-auto shrink-0 rounded border border-border/70 bg-background/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {item.shortcut}
                        </Kbd>
                      ) : selected ? (
                        <CornerDownLeft
                          aria-hidden="true"
                          className="shrink-0 text-muted-foreground"
                          size={14}
                        />
                      ) : null}
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
          {groups.length === 0 ? (
            <div
              className="grid min-h-40 place-items-center px-6 py-8 text-center"
              role="status"
            >
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin"
                    size={17}
                  />
                  {t("commandPalette.loading")}
                </div>
              ) : (
                <div>
                  <Search
                    aria-hidden="true"
                    className="mx-auto mb-3 text-muted-foreground/70"
                    size={28}
                    strokeWidth={1.4}
                  />
                  <p className="text-sm font-medium text-foreground">
                    {t("commandPalette.noResults")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("commandPalette.noResultsHint")}
                  </p>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/70 bg-muted/30 px-4 py-2.5 text-[10px] text-muted-foreground">
          <span>{t("commandPalette.scopeHint")}</span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <KbdGroup>
                <Kbd className="h-auto rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px]">↑</Kbd>
                <Kbd className="h-auto rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px]">↓</Kbd>
              </KbdGroup>
              {t("commandPalette.select")}
            </div>
            <span className="flex items-center gap-1">
              <Kbd className="h-auto rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px]">↵</Kbd>
              {t("common.open")}
            </span>
            <span className="flex items-center gap-1">
              <Kbd className="h-auto rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px]">esc</Kbd>
              {t("common.close")}
            </span>
          </div>
        </div>
        {groups.length > 0 ? (
          <span aria-live="polite" className="sr-only">
            {visibleItems.length < totalResultCount
              ? t("commandPalette.resultCountLimited", {
                  total: totalResultCount,
                  visible: visibleItems.length,
                })
              : t("commandPalette.resultCount", { count: visibleItems.length })}
          </span>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
