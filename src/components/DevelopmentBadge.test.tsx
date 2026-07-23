import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { DevelopmentBadge } from "./DevelopmentBadge";

describe("DevelopmentBadge", () => {
  it("identifies the development app", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <DevelopmentBadge />
      </I18nProvider>,
    );

    expect(markup).toContain('class="development-badge"');
    expect(markup).toContain("개발 앱");
  });
});
