import { describe, expect, it } from "vitest";

import { bunTargetTriple } from "./prepare-bun-sidecar";

describe("bundled Bun target selection", () => {
  it("maps both supported macOS architectures to Rust target triples", () => {
    expect(bunTargetTriple("darwin", "arm64")).toBe("aarch64-apple-darwin");
    expect(bunTargetTriple("darwin", "x64")).toBe("x86_64-apple-darwin");
  });

  it("rejects unsupported platforms and architectures", () => {
    expect(() => bunTargetTriple("linux", "arm64")).toThrow(
      "supported only for macOS",
    );
    expect(() => bunTargetTriple("darwin", "riscv64")).toThrow(
      "Unsupported macOS architecture",
    );
  });
});
