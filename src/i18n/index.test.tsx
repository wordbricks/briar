/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider, useI18n } from ".";
import type { MessageKey } from "./messages";

function MissingTranslation() {
  const { t } = useI18n();
  return <span>{t("stage.merged" as MessageKey)}</span>;
}

describe("i18n", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
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
});
