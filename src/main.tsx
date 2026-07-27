import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { DevelopmentBadge } from "./components/DevelopmentBadge";
import { NativeLaunchIntro } from "./components/NativeLaunchIntro";
import { TooltipProvider } from "./components/ui/tooltip";
import { I18nProvider } from "./i18n";
import { installAppZoomShortcuts } from "./lib/app-zoom";
import { isNativeLaunchIntroWindow } from "./lib/launch-intro";
import "./styles/globals.css";
import "./styles.css";

const nativeLaunchIntro = isNativeLaunchIntroWindow();
if (nativeLaunchIntro) {
  document.documentElement.classList.add("launch-intro-document");
} else {
  installAppZoomShortcuts();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <TooltipProvider delayDuration={200}>
        <AppErrorBoundary>
          {nativeLaunchIntro ? <NativeLaunchIntro /> : <App />}
        </AppErrorBoundary>
        {import.meta.env.DEV && !nativeLaunchIntro ? <DevelopmentBadge /> : null}
      </TooltipProvider>
    </I18nProvider>
  </StrictMode>,
);
