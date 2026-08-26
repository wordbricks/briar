import {
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useI18n } from "../i18n";

export function WindowNavigationControls({
  canGoBack,
  canGoForward,
  isSidebarOpen,
  onBack,
  onForward,
  onSidebarToggle,
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  isSidebarOpen: boolean;
  onBack: () => void;
  onForward: () => void;
  onSidebarToggle: () => void;
}) {
  const { t } = useI18n();

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
