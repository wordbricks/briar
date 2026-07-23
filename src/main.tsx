import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { DevelopmentBadge } from "./components/DevelopmentBadge";
import { NativeLaunchIntro } from "./components/NativeLaunchIntro";
import { I18nProvider } from "./i18n";
import { isNativeLaunchIntroWindow } from "./lib/launch-intro";
import "./lib/jelly-ui";
import "./styles.css";

const nativeLaunchIntro = isNativeLaunchIntroWindow();
if (nativeLaunchIntro) {
  document.documentElement.classList.add("launch-intro-document");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <AppErrorBoundary>
        {nativeLaunchIntro ? <NativeLaunchIntro /> : <App />}
      </AppErrorBoundary>
      {import.meta.env.DEV && !nativeLaunchIntro ? <DevelopmentBadge /> : null}
    </I18nProvider>
  </StrictMode>,
);
