/** @vitest-environment jsdom */

import { createReactTestRoot, renderReactTestRoot } from "../test/react";
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
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createReactTestRoot>["root"];

  beforeEach(() => {
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.setItem("briar.locale.v1", "ko");
    ({ cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    }));
  });

  afterEach(async () => {
    await cleanup();
    localStorage.removeItem("briar.locale.v1");
  });

  it("returns the key instead of throwing for a missing translation", async () => {
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <MissingTranslation />
      </I18nProvider>,
    );

    expect(container.textContent).toBe("stage.merged");
  });

  it.each(["ko", "en", "zh"] as const)(
    "uses the shared %s locale contract on mobile",
    async (locale: Locale) => {
      localStorage.setItem("briar.locale.v1", locale);

      await renderReactTestRoot(
        root,
        <I18nProvider>
          <CurrentLocale />
        </I18nProvider>,
      );

      const current = container.querySelector("[data-locale]");
      expect(current?.getAttribute("data-locale")).toBe(locale);
      expect(current?.getAttribute("data-locale-tag")).toBe(localeTags[locale]);
      expect(document.documentElement.lang).toBe(localeTags[locale]);
    },
  );
});
