import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RefreshCw } from "lucide-react";

import { Spinner } from "./spinner";

describe("Spinner", () => {
  it("uses the shared spin class and forwards Lucide props", () => {
    const markup = renderToStaticMarkup(
      <Spinner aria-hidden size={16} strokeWidth={1.5} />,
    );

    expect(markup).toMatch(/class="[^"]*\bspin\b/);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('width="16"');
    expect(markup).toContain('height="16"');
    expect(markup).toContain('stroke-width="1.5"');
  });

  it("keeps a refresh icon's shape while applying the shared rotation", () => {
    const markup = renderToStaticMarkup(
      <Spinner aria-hidden icon={RefreshCw} size={14} />,
    );

    expect(markup).toMatch(/class="[^"]*\bspin\b/);
    expect(markup).toContain('width="14"');
    expect(markup).toContain('height="14"');
  });

  it("can render an idle icon without adding a second animation path", () => {
    const markup = renderToStaticMarkup(
      <Spinner icon={RefreshCw} size={14} spinning={false} />,
    );

    expect(markup).not.toMatch(/class="[^"]*\bspin\b/);
    expect(markup).toContain('width="14"');
  });
});
