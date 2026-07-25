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
  it("uses a dedicated settings shell with sidebar and main content", () => {
    expect(component).toContain(
      'className={`sidebar app-settings-sidebar${\n          isSidebarOpen ? "" : " sidebar-collapsed"\n        }`}',
    );
    expect(component).toContain('className="main-content app-settings-main"');
    expect(component).toContain('className="app-settings-back"');
    expect(component).toContain('className="app-settings-search"');
    expect(component).toContain('className="app-settings-page-header"');
  });

  it("keeps the settings navigation aligned to a clean grouped sidebar", () => {
    expect(styles).toMatch(
      /\.sidebar \{[^}]*width: 252px;[^}]*flex: 0 0 252px;/u,
    );
    expect(styles).toMatch(
      /\.app-settings-sidebar \{[^}]*background:#f5f5f4;/u,
    );
    expect(styles).toMatch(
      /\.app-settings-nav-group button\.active \{[^}]*background:rgba\(48,49,45,\.09\);/u,
    );
    expect(styles).toMatch(
      /\.app-settings-page-header h1 \{[^}]*font-size:24px;/u,
    );
  });
});
