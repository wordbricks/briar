import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { CompanionBottomNavigation } from "./CompanionBottomNavigation";

describe("CompanionBottomNavigation", () => {
  it("hides Ideas by default", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <CompanionBottomNavigation
          activeDestination="inbox"
          onCreate={() => undefined}
          onAgentsOpen={() => undefined}
          onIdeasOpen={() => undefined}
          onInboxOpen={() => undefined}
          onSearchOpen={() => undefined}
          onStatusChange={() => undefined}
          unreadInboxCount={3}
        />
      </I18nProvider>,
    );

    expect(markup).toContain("Inbox");
    expect(markup).toContain("에이전트");
    expect(markup).not.toContain("아이디어");
    expect(markup).toContain("검색");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain(">3<");
    expect(markup).not.toContain(">Active<");
    expect(markup).not.toContain(">Alerts<");
    expect(markup).not.toContain(">Completed<");
    expect(markup.match(/<button/g)).toHaveLength(5);
    expect(markup).toContain("grid-cols-4");
    expect(markup.indexOf("companion-bottom-nav")).toBeLessThan(
      markup.indexOf("companion-fab"),
    );
  });

  it("shows Ideas when the feature flag is enabled", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <CompanionBottomNavigation
          activeDestination="ideas"
          ideasEnabled
          onAgentsOpen={() => undefined}
          onIdeasOpen={() => undefined}
          onInboxOpen={() => undefined}
          onSearchOpen={() => undefined}
          onStatusChange={() => undefined}
          unreadInboxCount={0}
        />
      </I18nProvider>,
    );

    expect(markup).toContain("아이디어");
    expect(markup).toContain("grid-cols-5");
    expect(markup).toContain('aria-current="page"');
  });
});
