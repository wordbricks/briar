/** @vitest-environment jsdom */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./page";

describe("PageHeader", () => {
  it("makes only the empty header surface draggable by default", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <PageHeader action={<button type="button">Save</button>} title="Project" />,
    );

    const header = container.querySelector("header");
    expect(header?.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(
      header?.querySelector("h1")?.hasAttribute("data-tauri-drag-region"),
    ).toBe(false);
    expect(
      header?.querySelector("button")?.hasAttribute("data-tauri-drag-region"),
    ).toBe(false);
  });

  it("preserves an explicit deep drag region", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <PageHeader data-tauri-drag-region="deep" title="Project" />,
    );

    expect(
      container
        .querySelector("header")
        ?.getAttribute("data-tauri-drag-region"),
    ).toBe("deep");
  });
});
