import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Typography } from "./typography";

describe("Typography", () => {
  it("renders the default body element", () => {
    const markup = renderToStaticMarkup(<Typography>Hello</Typography>);
    expect(markup).toContain("<p");
    expect(markup).toContain("Hello");
  });

  it("maps title variant to h1", () => {
    const markup = renderToStaticMarkup(
      <Typography variant="title">Settings</Typography>,
    );
    expect(markup.startsWith("<h1")).toBe(true);
    expect(markup).toContain("Settings");
  });

  it("allows element override", () => {
    const markup = renderToStaticMarkup(
      <Typography as="span" variant="caption">
        helper
      </Typography>,
    );
    expect(markup.startsWith("<span")).toBe(true);
    expect(markup).toContain("helper");
  });
});
