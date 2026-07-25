import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { CompanionBottomNavigation } from "./CompanionBottomNavigation";

describe("CompanionBottomNavigation", () => {
  it("keeps Tasks, Search, and Inbox with the create action after the navigation", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <CompanionBottomNavigation
          activeDestination="inbox"
          onCreate={() => undefined}
          onInboxOpen={() => undefined}
          onSearchOpen={() => undefined}
          onStatusChange={() => undefined}
          unreadInboxCount={3}
        />
      </I18nProvider>,
    );

    expect(markup).toContain("Inbox");
    expect(markup).toContain("검색");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain(">3<");
    expect(markup).not.toContain(">Active<");
    expect(markup).not.toContain(">Alerts<");
    expect(markup).not.toContain(">Completed<");
    expect(markup.match(/<button/g)).toHaveLength(4);
    expect(markup.indexOf("companion-bottom-nav")).toBeLessThan(
      markup.indexOf("companion-fab"),
    );
  });
});
