import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { DevelopmentBadge } from "./components/DevelopmentBadge";
import { I18nProvider } from "./i18n";
import "./lib/jelly-ui";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
      {import.meta.env.DEV && <DevelopmentBadge />}
    </I18nProvider>
  </StrictMode>,
);
