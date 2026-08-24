/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  projectWindowLabel,
  projectWindowPresentationOptions,
  projectWindowUrl,
  readProjectWindowProjectId,
} from "./project-window";

describe("project window context", () => {
  it("reads a project id only when the window query parameter is populated", () => {
    expect(readProjectWindowProjectId("?projectWindow=project-1")).toBe(
      "project-1",
    );
    expect(readProjectWindowProjectId("?projectWindow=%20%20")).toBeNull();
    expect(readProjectWindowProjectId("?other=value")).toBeNull();
  });

  it("builds a same-app URL while preserving unrelated navigation context", () => {
    expect(
      projectWindowUrl("project 1", {
        pathname: "/app/",
        search: "?theme=dark",
        hash: "#issues",
      }),
    ).toBe("/app/?theme=dark&projectWindow=project+1#issues");
  });

  it("creates unique Tauri-safe labels for separate windows", () => {
    expect(projectWindowLabel("project with spaces", 42)).toBe(
      "project-project-with-spaces-16",
    );
    expect(projectWindowLabel("project with spaces", 43)).not.toBe(
      projectWindowLabel("project with spaces", 42),
    );
  });

  it("uses the native sidebar material for macOS project windows", () => {
    expect(projectWindowPresentationOptions(true)).toMatchObject({
      backgroundColor: "#00000000",
      transparent: true,
      windowEffects: {
        effects: ["sidebar"],
        state: "followsWindowActiveState",
      },
    });
    expect(projectWindowPresentationOptions(false)).toEqual({
      backgroundColor: "#f7f7f3",
    });
  });

  it("grants runtime project windows the desktop app capability", () => {
    const capability = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "src-tauri/capabilities/default.json"),
        "utf8",
      ),
    ) as { windows: string[]; permissions: string[] };

    expect(capability.windows).toContain("project-*");
    expect(capability.permissions).toContain(
      "core:webview:allow-create-webview-window",
    );
  });
});
