/** @vitest-environment jsdom */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectIcon } from "./ProjectIcon";

const baseProject = {
  name: "Briar",
  icon: null,
  iconName: null,
  iconColor: null,
};

describe("ProjectIcon", () => {
  it("renders an uploaded image when present", () => {
    const markup = renderToStaticMarkup(
      <ProjectIcon
        project={{
          ...baseProject,
          icon: "data:image/png;base64,aA==",
          iconName: "rocket",
          iconColor: "#6366f1",
        }}
      />,
    );
    expect(markup).toContain("<img");
    expect(markup).toContain("data:image/png;base64,aA==");
    expect(markup).not.toContain("<svg");
  });

  it("renders the named lucide icon with its color", () => {
    const markup = renderToStaticMarkup(
      <ProjectIcon
        project={{ ...baseProject, iconName: "rocket", iconColor: "#6366f1" }}
      />,
    );
    expect(markup).toContain("<svg");
    expect(markup).toContain('style="color:#6366f1"');
  });

  it("renders the named lucide icon without a color style when unset", () => {
    const markup = renderToStaticMarkup(
      <ProjectIcon project={{ ...baseProject, iconName: "rocket" }} />,
    );
    expect(markup).toContain("<svg");
    expect(markup).not.toContain("style=");
  });

  it("falls back to the default folder icon without an icon", () => {
    const markup = renderToStaticMarkup(
      <ProjectIcon project={baseProject} />,
    );
    expect(markup).toContain("<svg");
  });

  it("falls back to the default folder icon for an unknown icon name", () => {
    const markup = renderToStaticMarkup(
      // Unknown names cannot arrive from the API (validated), but the renderer
      // must degrade gracefully if one ever slips through.
      <ProjectIcon
        project={{ ...baseProject, iconName: "definitely-not-an-icon" }}
      />,
    );
    expect(markup).toContain("<svg");
  });

  it("supports minimal project picks without named icon fields", () => {
    const markup = renderToStaticMarkup(
      <ProjectIcon project={{ name: "Briar", icon: null }} />,
    );
    expect(markup).toContain("<svg");
  });
});
