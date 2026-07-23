import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { CompanionBottomNavigation } from "./CompanionBottomNavigation";

describe("CompanionBottomNavigation", () => {
  it("replaces the rightmost search action with an Inbox tab", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <CompanionBottomNavigation
          activeDestination="inbox"
          counts={{ active: 2, attention: 1 }}
          onInboxOpen={() => undefined}
          onStatusChange={() => undefined}
          unreadInboxCount={3}
        />
      </I18nProvider>,
    );

    expect(markup).toContain("Inbox");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain(">3<");
    expect(markup).not.toContain('aria-label="작업 검색"');
    expect(markup.match(/<button/g)).toHaveLength(5);
  });
});
