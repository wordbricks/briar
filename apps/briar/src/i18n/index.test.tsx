/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider, localeTags, useI18n, type Locale } from ".";
import type { MessageKey } from "./messages";

function MissingTranslation() {
  const { t } = useI18n();
  return <span>{t("stage.merged" as MessageKey)}</span>;
}

function CurrentLocale() {
  const { locale, localeTag } = useI18n();
  return <span data-locale={locale} data-locale-tag={localeTag} />;
}

describe("i18n", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.setItem("briar.locale.v1", "ko");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.removeItem("briar.locale.v1");
  });

  it("returns the key instead of throwing for a missing translation", async () => {
    await act(async () =>
      root.render(
        <I18nProvider>
          <MissingTranslation />
        </I18nProvider>,
      ),
    );

    expect(container.textContent).toBe("stage.merged");
  });

  it.each(["ko", "en", "zh"] as const)(
    "uses the shared %s locale contract on mobile",
    async (locale: Locale) => {
      localStorage.setItem("briar.locale.v1", locale);

      await act(async () =>
        root.render(
          <I18nProvider>
            <CurrentLocale />
          </I18nProvider>,
        ),
      );

      const current = container.querySelector("[data-locale]");
      expect(current?.getAttribute("data-locale")).toBe(locale);
      expect(current?.getAttribute("data-locale-tag")).toBe(localeTags[locale]);
      expect(document.documentElement.lang).toBe(localeTags[locale]);
    },
  );
});
