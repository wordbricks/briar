import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { RegistryProvider } from "@effect/atom-react";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { AppUpdateProvider } from "./components/AppUpdateProvider";
import { AppKeyboardCommandProvider } from "./hooks/appKeyboardCommands";
import { DevelopmentBadge } from "./components/DevelopmentBadge";
import { ToastProvider } from "./components/ui/toast";
import { TooltipProvider } from "./components/ui/tooltip";
import { detectLocale, I18nProvider, loadLocaleMessages } from "./i18n";
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

async function start() {
  // Resolve the active locale (a local chunk, a few milliseconds) before the
  // first paint so non-Korean users never see the fallback strings flash.
  const locale = detectLocale();
  const [messages, NativeLaunchIntro] = await Promise.all([
    loadLocaleMessages(locale),
    nativeLaunchIntro
      ? import("./components/NativeLaunchIntro").then(
          (module): ComponentType => module.NativeLaunchIntro,
        )
      : Promise.resolve(null),
  ]);

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <RegistryProvider>
        <ThemeProvider>
          <I18nProvider initial={{ locale, messages }}>
            <TooltipProvider delayDuration={200}>
              <ToastProvider>
                <AppErrorBoundary>
                  {NativeLaunchIntro ? (
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
}

void start();
