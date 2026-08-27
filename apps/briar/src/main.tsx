import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RegistryProvider } from "@effect/atom-react";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { AppUpdateProvider } from "./components/AppUpdateProvider";
import { AppKeyboardCommandProvider } from "./hooks/appKeyboardCommands";
import { DevelopmentBadge } from "./components/DevelopmentBadge";
import { NativeLaunchIntro } from "./components/NativeLaunchIntro";
import { ToastProvider } from "./components/ui/toast";
import { TooltipProvider } from "./components/ui/tooltip";
import { I18nProvider } from "./i18n";
import {
  createAppZoomCommands,
  type AppZoomCommands,
} from "./lib/app-zoom";
import { installExternalLinkHandler } from "./lib/external-links";
import { isNativeLaunchIntroWindow } from "./lib/launch-intro";
import { isMacDesktopTauri } from "./lib/platform";
import { initializeTheme, ThemeProvider } from "./theme";
import "./styles/globals.css";
import "./styles.css";
import "./styles/dark.css";

initializeTheme();
installExternalLinkHandler();
const nativeLaunchIntro = isNativeLaunchIntroWindow();
let appZoomCommands: AppZoomCommands | null = null;
if (nativeLaunchIntro) {
  document.documentElement.classList.add("launch-intro-document");
} else {
  if (isMacDesktopTauri()) {
    document.documentElement.classList.add("macos-vibrant-window");
  }
  appZoomCommands = createAppZoomCommands();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RegistryProvider>
      <ThemeProvider>
        <I18nProvider>
          <TooltipProvider delayDuration={200}>
            <ToastProvider>
              <AppErrorBoundary>
                {nativeLaunchIntro ? (
                  <NativeLaunchIntro />
                ) : (
                  <AppUpdateProvider>
                    <AppKeyboardCommandProvider>
                      <App appZoomCommands={appZoomCommands} />
                    </AppKeyboardCommandProvider>
                  </AppUpdateProvider>
                )}
              </AppErrorBoundary>
              {import.meta.env.DEV && !nativeLaunchIntro ? (
                <DevelopmentBadge />
              ) : null}
            </ToastProvider>
          </TooltipProvider>
        </I18nProvider>
      </ThemeProvider>
    </RegistryProvider>
  </StrictMode>,
);
