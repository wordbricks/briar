import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../styles.css", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const dialog = readFileSync(
  new URL("../components/ui/dialog.tsx", import.meta.url),
  "utf8",
);

function cssZIndex(source: string, selector: string): number {
  const match = source.match(
    new RegExp(
      `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[^}]*z-index\\s*:\\s*(\\d+)`,
    ),
  );
  if (!match) {
    throw new Error(`Missing z-index for ${selector}`);
  }
  return Number(match[1]);
}

function tailwindZIndex(source: string, utility: string): number {
  const match = source.match(new RegExp(`${utility.replace(/[[\]]/g, "\\$&")}`));
  if (!match) {
    throw new Error(`Missing Tailwind utility ${utility}`);
  }
  const valueMatch = utility.match(/z-\[(\d+)\]|z-(\d+)/);
  if (!valueMatch) {
    throw new Error(`Could not parse z-index from ${utility}`);
  }
  return Number(valueMatch[1] ?? valueMatch[2]);
}

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

  it("stacks shared dialogs above the inbox side panel so result images are not covered", () => {
    const drawerZ = cssZIndex(styles, ".inbox-detail-drawer");
    const overlayZ = cssZIndex(styles, ".inbox-detail-overlay");
    // Shared Dialog (result image enlarge, confirmations) portals to body and must
    // paint above the inbox side tab when opened from an issue inside it.
    expect(dialog).toContain("z-[90]");
    expect(tailwindZIndex(dialog, "z-[90]")).toBeGreaterThan(drawerZ);
    expect(tailwindZIndex(dialog, "z-[90]")).toBeGreaterThan(overlayZ);
    expect(drawerZ).toBeGreaterThan(overlayZ);
  });
});
