import {
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useEffect } from "react";
import { useI18n } from "../i18n";

export function WindowNavigationControls({
  canGoBack,
  canGoForward,
  isSidebarOpen,
  onBack,
  onForward,
  onSettings,
  onSidebarToggle,
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  isSidebarOpen: boolean;
  onBack: () => void;
  onForward: () => void;
  onSettings: () => void;
  onSidebarToggle: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        !event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      if (event.code === "BracketLeft" || event.key === "[") {
        event.preventDefault();
        if (!canGoBack) return;
        onBack();
      } else if (event.code === "BracketRight" || event.key === "]") {
        event.preventDefault();
        if (!canGoForward) return;
        onForward();
      } else if (event.code === "Comma" || event.key === ",") {
        event.preventDefault();
        onSettings();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canGoBack, canGoForward, onBack, onForward, onSettings]);

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
    </nav>
  );
}
