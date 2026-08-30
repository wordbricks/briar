import { describe, expect, it } from "vitest";
import { mobileOperationCatalog } from "../packages/contracts/src/index";
import {
  renderOpenApi,
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

  it("inserts migrated paths and schemas without OpenAPI placeholders", () => {
    const rendered = renderOpenApi(JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Mobile API", version: "0.0.0" },
      paths: {},
      components: { schemas: {} },
    }, null, 2));
    const openApi = JSON.parse(rendered);

    expect(openApi.paths["/projects"].get.operationId).toBe("listProjects");
    expect(openApi.components.schemas).toHaveProperty("Project");
    expect(openApi.components.schemas).toHaveProperty("ProjectsResponse");
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
