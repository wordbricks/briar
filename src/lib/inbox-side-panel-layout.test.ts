import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../styles.css", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

describe("inbox side panel layout", () => {
  it("uses most of the desktop viewport without covering the whole inbox", () => {
    expect(styles).toContain(
      ".inbox-detail-drawer { width:min(1180px,calc(100vw - 96px));",
    );
    expect(styles).toContain("right:12px");
    expect(styles).toContain("height:calc(100vh - 24px)");
  });

  it("provides reduced-motion and loading fallbacks", () => {
    expect(styles).toContain(
      ".inbox-detail-overlay,.inbox-detail-drawer { animation:none; }",
    );
    expect(styles).toContain(".inbox-detail-loading");
    expect(styles).toContain(".inbox-detail-unavailable");
  });

  it("keeps desktop inbox destinations inside the side panel", () => {
    expect(app).toContain("setInboxDetailTarget(target);");
    expect(app).toContain("<InboxDetailPanel");
    expect(app).toContain("<RunPage");
    expect(app).toContain("<ProjectAgentSessionDetail");
    expect(app).toContain("inbox.markRead(message.id);");
  });
});
