import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { AppUpdateProvider } from "./components/AppUpdateProvider";
import { DevelopmentBadge } from "./components/DevelopmentBadge";
import { NativeLaunchIntro } from "./components/NativeLaunchIntro";
import { TooltipProvider } from "./components/ui/tooltip";
import { I18nProvider } from "./i18n";
import { installAppZoomShortcuts } from "./lib/app-zoom";
import { installExternalLinkHandler } from "./lib/external-links";
import { isNativeLaunchIntroWindow } from "./lib/launch-intro";
import { initializeTheme, ThemeProvider } from "./theme";
import "./styles/globals.css";
import "./styles.css";
import "./styles/dark.css";

initializeTheme();
installExternalLinkHandler();
const nativeLaunchIntro = isNativeLaunchIntroWindow();
if (nativeLaunchIntro) {
  document.documentElement.classList.add("launch-intro-document");
} else {
  installAppZoomShortcuts();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <TooltipProvider delayDuration={200}>
          <AppErrorBoundary>
            {nativeLaunchIntro ? (
              <NativeLaunchIntro />
            ) : (
              <AppUpdateProvider>
                <App />
              </AppUpdateProvider>
            )}
          </AppErrorBoundary>
          {import.meta.env.DEV && !nativeLaunchIntro ? (
            <DevelopmentBadge />
          ) : null}
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);
