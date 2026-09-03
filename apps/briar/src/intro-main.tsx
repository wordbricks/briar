import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NativeLaunchIntro } from "./components/NativeLaunchIntro";
import { detectLocale, I18nProvider, loadLocaleMessages } from "./i18n";
// The bundled Inter/DM Mono faces the intro's brand line and eyebrow use; the
// app shell gets them through globals.css, which this entry does not load.
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/launch-intro.css";

/*
  Entry for the native launch intro window (intro.html).

  Deliberately tiny: the intro has to be on screen while the app bundle is
  still downloading, so it loads only the design tokens, the intro stylesheet,
  and the copy it renders — never the app shell, its providers, or its routes.
  `main.tsx` still renders the same component for the in-app preview flows.
*/

// Rust also injects this class before the document runs, so the window paints
// transparent from the first frame. Repeating it keeps `bun run dev` and a
// directly opened intro.html looking the same.
document.documentElement.classList.add("launch-intro-document");

async function start() {
  // Same handshake as main.tsx: resolve the locale chunk before the first
  // paint so an en/zh user never sees the Korean fallback copy flash.
  const locale = detectLocale();
  const messages = await loadLocaleMessages(locale);

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <I18nProvider initial={{ locale, messages }}>
        <NativeLaunchIntro />
      </I18nProvider>
    </StrictMode>,
  );
}

void start();
