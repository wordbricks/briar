import * as PopoverPrimitive from "@radix-ui/react-popover";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useCallback, useId, useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "../i18n";

export type WindowNavigationHistoryItem = {
  readonly context: string | null;
  readonly eyebrow: string;
  readonly icon: ReactNode;
  readonly index: number;
  readonly label: string;
  readonly location: string;
};

export function WindowNavigationControls({
  canGoBack,
  canGoForward,
  historyIndex,
  historyItems,
  isHistoryOpen,
  isSidebarOpen,
  onBack,
  onForward,
  onHistoryOpenChange,
  onHistorySelect,
  onSidebarToggle,
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  historyIndex: number;
  historyItems: readonly WindowNavigationHistoryItem[];
  isHistoryOpen: boolean;
  isSidebarOpen: boolean;
  onBack: () => void;
  onForward: () => void;
  onHistoryOpenChange: (open: boolean) => void;
  onHistorySelect: (index: number) => void;
  onSidebarToggle: () => void;
}) {
  const { t } = useI18n();
  const historyTriggerRef = useRef<HTMLButtonElement | null>(null);
  const historyItemRefs = useRef(new Map<number, HTMLButtonElement>());
  const historyPopoverId = `navigation-history-${useId().replaceAll(":", "")}`;
  const orderedHistoryItems = useMemo(() => {
    const current = historyItems.find((item) => item.index === historyIndex);
    const remaining = [...historyItems]
      .filter((item) => item.index !== historyIndex)
      .sort((left, right) => right.index - left.index);
    return current ? [current, ...remaining] : remaining;
  }, [historyIndex, historyItems]);
  const focusHistoryItem = useCallback((position: number) => {
    const item = orderedHistoryItems[position];
    if (!item) return;
    historyItemRefs.current.get(item.index)?.focus();
  }, [orderedHistoryItems]);
  const handleHistoryItemKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    position: number,
  ) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      focusHistoryItem(
        (position + offset + orderedHistoryItems.length) %
          orderedHistoryItems.length,
      );
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusHistoryItem(event.key === "Home" ? 0 : orderedHistoryItems.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onHistoryOpenChange(false);
      window.requestAnimationFrame(() => historyTriggerRef.current?.focus());
    } else if (event.key === "Tab") {
      onHistoryOpenChange(false);
    }
  };

  return (
    <nav
      aria-label={t("navigation.history")}
      className="window-navigation-controls"
      data-tauri-drag-region="deep"
    >
      <button
        aria-controls="app-sidebar"
        aria-expanded={isSidebarOpen}
        aria-label={t(isSidebarOpen ? "sidebar.close" : "sidebar.open")}
        className="window-navigation-button sidebar-control"
        onClick={onSidebarToggle}
        title={t(isSidebarOpen ? "sidebar.close" : "sidebar.open")}
        type="button"
      >
        {isSidebarOpen ? (
          <PanelLeftClose size={16} strokeWidth={1.7} />
        ) : (
          <PanelLeftOpen size={17} strokeWidth={1.7} />
        )}
      </button>
      <button
        aria-keyshortcuts="Meta+["
        aria-label={t("navigation.back")}
        className="window-navigation-button"
        disabled={!canGoBack}
        onClick={onBack}
        title={`${t("navigation.back")} (⌘[)`}
        type="button"
      >
        <ChevronLeft size={20} strokeWidth={1.7} />
      </button>
      <button
        aria-keyshortcuts="Meta+]"
        aria-label={t("navigation.forward")}
        className="window-navigation-button"
        disabled={!canGoForward}
        onClick={onForward}
        title={`${t("navigation.forward")} (⌘])`}
        type="button"
      >
        <ChevronRight size={20} strokeWidth={1.7} />
      </button>
      <PopoverPrimitive.Root
        onOpenChange={onHistoryOpenChange}
        open={isHistoryOpen}
      >
        <PopoverPrimitive.Trigger asChild>
          <button
            aria-controls={isHistoryOpen ? historyPopoverId : undefined}
            aria-expanded={isHistoryOpen}
            aria-haspopup="menu"
            aria-keyshortcuts="Meta+Y"
            aria-label={t("navigation.history")}
            className="window-navigation-button"
            data-history-trigger
            ref={historyTriggerRef}
            title={`${t("navigation.history")} (⌘Y)`}
            type="button"
          >
            <Clock3 aria-hidden="true" size={20} strokeWidth={1.7} />
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            aria-label={t("navigation.history")}
            className="window-navigation-history-popover"
            collisionPadding={10}
            id={historyPopoverId}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              window.requestAnimationFrame(() => {
                const current = orderedHistoryItems.findIndex(
                  (item) => item.index === historyIndex,
                );
                focusHistoryItem(current >= 0 ? current : 0);
              });
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              window.requestAnimationFrame(() => historyTriggerRef.current?.focus());
            }}
            role="menu"
            side="bottom"
            sideOffset={8}
          >
            <div className="window-navigation-history-header">
              <strong>{t("navigation.recentlyViewed")}</strong>
              <kbd aria-hidden="true">⌘Y</kbd>
            </div>
            {orderedHistoryItems.length > 0 ? (
              <div className="window-navigation-history-items">
                {orderedHistoryItems.map((item, position) => {
                  const current = item.index === historyIndex;
                  return (
                    <button
                      aria-current={current ? "page" : undefined}
                      className="window-navigation-history-item"
                      data-current={current || undefined}
                      data-history-index={item.index}
                      key={`${item.location}-${item.index}`}
                      onClick={() => {
                        onHistorySelect(item.index);
                        onHistoryOpenChange(false);
                      }}
                      onKeyDown={(event) =>
                        handleHistoryItemKeyDown(event, position)}
                      ref={(element) => {
                        if (element) historyItemRefs.current.set(item.index, element);
                        else historyItemRefs.current.delete(item.index);
                      }}
                      role="menuitem"
                      title={item.context ? `${item.label} · ${item.context}` : item.label}
                      type="button"
                    >
                      <span className="window-navigation-history-eyebrow">
                        {item.eyebrow}
                      </span>
                      <span aria-hidden="true" className="window-navigation-history-icon">
                        {item.icon}
                      </span>
                      <span className="window-navigation-history-copy">
                        <strong>{item.label}</strong>
                        {item.context ? <small>{item.context}</small> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="window-navigation-history-empty">
                {t("navigation.empty")}
              </p>
            )}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </nav>
  );
}
