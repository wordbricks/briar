import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(
  new URL("../components/AppSettings.tsx", import.meta.url),
  "utf8",
);
const layout = readFileSync(
  new URL("../components/settings/layout.tsx", import.meta.url),
  "utf8",
);

describe("application settings shell", () => {
  it("uses the design-system settings shell with sidebar and main content", () => {
    expect(component).toContain("<SettingsShell>");
    expect(component).toContain("<SettingsSidebar");
    expect(component).toContain("<SettingsMain");
    expect(component).toContain("<SettingsBackButton");
    expect(component).toContain("<SettingsSearch");
    expect(component).toContain("<SettingsPageHeader");
  });

  it("keeps the settings navigation aligned to a clean grouped sidebar", () => {
    expect(layout).toContain("settings-sidebar");
    expect(layout).toContain("settings-nav-group");
    expect(layout).toContain("settings-page-header");
    expect(layout).toContain("w-[252px]");
    expect(layout).toContain("bg-muted");
  });
});
