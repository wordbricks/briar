import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  StatusPanel,
  StatusPanelAction,
  StatusPanelContent,
  StatusPanelDescription,
  StatusPanelIcon,
  StatusPanelMeta,
  StatusPanelTitle,
} from "./status-panel";

describe("StatusPanel", () => {
  it("renders composable status content with semantic slots", () => {
    const markup = renderToStaticMarkup(
      <StatusPanel role="status" tone="success">
        <StatusPanelIcon>✓</StatusPanelIcon>
        <StatusPanelContent>
          <StatusPanelTitle>Connected</StatusPanelTitle>
          <StatusPanelDescription>Last checked now</StatusPanelDescription>
        </StatusPanelContent>
        <StatusPanelMeta>10s</StatusPanelMeta>
        <StatusPanelAction>Manage</StatusPanelAction>
      </StatusPanel>,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('data-slot="status-panel"');
    expect(markup).toContain('data-slot="status-panel-description"');
    expect(markup).toContain("--status-success-surface");
  });

  it("uses theme-aware destructive tokens for errors", () => {
    const markup = renderToStaticMarkup(
      <StatusPanel density="compact" role="alert" tone="destructive">
        Failed
      </StatusPanel>,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("--status-destructive-border");
    expect(markup).toContain("rounded-lg");
  });
});
