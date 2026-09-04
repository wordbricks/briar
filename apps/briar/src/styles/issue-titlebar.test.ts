import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve("src", "styles.css"), "utf8");

function blockContaining(selector: string) {
  const index = css.indexOf(selector);
  expect(index, `missing selector ${selector}`).toBeGreaterThan(-1);
  const open = css.indexOf("{", index);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("issue titlebar compact properties", () => {
  it("keeps header selects from inheriting full-width select-menu sizing", () => {
    const body = blockContaining(".run-page-property-select.select-menu");
    expect(body).toMatch(/width:\s*auto/);
    expect(body).toMatch(/max-width:\s*160px/);
    expect(body).toMatch(/min-width:\s*0/);
    expect(body).toMatch(/flex:\s*0 1 auto/);
  });

  it("keeps compact chips at 28px pill size instead of select-menu-small", () => {
    const body = blockContaining(
      ".run-page-property-select.select-menu-small .select-menu-trigger",
    );
    expect(body).toMatch(/height:\s*28px/);
    expect(body).toMatch(/min-height:\s*28px/);
    expect(body).toMatch(/border-radius:\s*999px/);
  });

  it("pins assignee and worker avatars to a 28px circle", () => {
    const body = blockContaining(".run-page-property-badge.assignee");
    expect(body).toMatch(/width:\s*28px/);
    expect(body).toMatch(/min-width:\s*28px/);
    expect(body).toMatch(/flex:\s*0 0 28px/);
    expect(body).toMatch(/border-radius:\s*50%/);
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).toMatch(/aspect-ratio:\s*1/);
  });

  it("matches process-now and outline tool buttons at 28px", () => {
    const processNow = blockContaining(
      ".run-page-titlebar-actions .run-page-process-now",
    );
    const toolButton = blockContaining(".run-page-tool-button {");
    expect(processNow).toMatch(/width:\s*28px/);
    expect(processNow).toMatch(/height:\s*28px/);
    expect(processNow).toMatch(/flex:\s*0 0 28px/);
    expect(processNow).toMatch(/border-radius:\s*50%/);
    expect(toolButton).toMatch(/width:\s*28px/);
    expect(toolButton).toMatch(/height:\s*28px/);
    expect(toolButton).toMatch(/flex:\s*0 0 28px/);
    expect(toolButton).toMatch(/border-radius:\s*50%/);
  });
});
