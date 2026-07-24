import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(
  new URL("../components/AppSettings.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../styles.css", import.meta.url),
  "utf8",
);

describe("application settings shell", () => {
  it("shares the main page sidebar and topbar primitives", () => {
    expect(component).toContain(
      'className={`sidebar app-settings-sidebar${\n          isSidebarOpen ? "" : " sidebar-collapsed"\n        }`}',
    );
    expect(component).toContain(
      'className={`topbar app-settings-topbar${\n            isSidebarOpen ? "" : " sidebar-closed"\n          }`}',
    );
    expect(component).toContain('className="main-content app-settings-main"');
  });

  it("keeps the settings navigation aligned to the main sidebar rhythm", () => {
    expect(styles).toMatch(
      /\.sidebar \{[^}]*width: 252px;[^}]*flex: 0 0 252px;/u,
    );
    expect(styles).toMatch(
      /\.app-settings-brand \{[^}]*height:88px;[^}]*padding:46px 17px 0;/u,
    );
    expect(styles).toMatch(
      /\.app-settings-sidebar nav \{[^}]*padding:3px 10px 16px;[^}]*gap:2px;/u,
    );
  });
});
