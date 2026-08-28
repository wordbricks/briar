import { describe, expect, it } from "vitest";
import { mobileOperationCatalog } from "../packages/mobile-contracts/src/index";
import {
  renderSwift,
  renderSwiftObject,
} from "./generate-mobile-contracts";

describe("mobile Swift contract rendering", () => {
  it("emits every executable operation in the catalog", () => {
    const rendered = renderSwift();

    for (const operation of Object.values(mobileOperationCatalog)) {
      expect(rendered).toContain(`id: "${operation.id}"`);
      expect(rendered).toContain(`method: "${operation.method}"`);
      expect(rendered).toContain(`path: "${operation.path}"`);
    }
    expect(rendered).toContain(
      "AuthenticatedMobileAPIOperation<ProjectsResponse>",
    );
  });

  it("preserves optional properties and nullable array items", () => {
    const rendered = renderSwiftObject(
      "ExampleResponse",
      {
        type: "object",
        properties: {
          nickname: { type: "string" },
          aliases: {
            type: "array",
            items: {
              anyOf: [{ type: "string" }, { type: "null" }],
            },
          },
        },
        required: ["aliases"],
      },
      {},
      new Set(),
    );

    expect(rendered).toContain("let nickname: String?");
    expect(rendered).toContain("let aliases: [String?]");
    expect(rendered).toContain("nickname: String? = nil");
    expect(rendered).toContain("if container.contains(.nickname)");
    expect(rendered).toContain(
      "nickname = try container.decode(String.self, forKey: .nickname)",
    );
    expect(rendered).toContain(
      "try container.encodeIfPresent(nickname, forKey: .nickname)",
    );
  });
});
