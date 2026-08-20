import { describe, expect, it } from "vitest";
import {
  decodeAccountProfileInput,
} from "./account-organization-request-contract";
import { decodeProjectInput } from "./project-request-contract";

describe("resource request contracts", () => {
  it("strips unknown fields at intentionally non-strict create boundaries", () => {
    expect(decodeAccountProfileInput({
      username: " Example_User ",
      name: " Example ",
      image: null,
      futureAccountField: true,
    })).toEqual({
      username: "example_user",
      name: "Example",
      image: null,
    });

    expect(decodeProjectInput({
      name: " Project ",
      futureProjectField: true,
    })).toEqual({ name: "Project" });
  });
});
