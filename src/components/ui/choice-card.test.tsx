import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChoiceCard } from "./choice-card";

describe("ChoiceCard", () => {
  it("renders a semantic button with shared card slots", () => {
    const markup = renderToStaticMarkup(
      <ChoiceCard
        description="Use an existing repository"
        icon="git"
        title="Connect repository"
        trailing="next"
      />,
    );

    expect(markup.startsWith("<button")).toBe(true);
    expect(markup).toContain('data-slot="choice-card"');
    expect(markup).toContain('data-slot="choice-card-icon"');
    expect(markup).toContain("Connect repository");
  });

  it("exposes disabled and selected states", () => {
    const markup = renderToStaticMarkup(
      <ChoiceCard disabled icon="new" selected title="Create project" />,
    );

    expect(markup).toContain("disabled");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('data-state="selected"');
  });

  it("supports a compact horizontal selection row", () => {
    const markup = renderToStaticMarkup(
      <ChoiceCard
        description="Available"
        icon="worker"
        layout="horizontal"
        leading="status"
        selected
        title="Mango"
        trailing="selected"
      />,
    );

    expect(markup).toContain('data-slot="choice-card-leading"');
    expect(markup).toContain("flex-row");
    expect(markup).toContain("bg-card");
    expect(markup).toContain("Available");
  });
});
