import { describe, expect, it } from "vitest";
import { decodeInboxReadVersions } from "./inbox-contract";
import { decodeOrganizationResponse } from "./organization-contract";

describe("API response contracts", () => {
  it("keeps organization logo defaults and record key/value validation", () => {
    expect(
      decodeOrganizationResponse({
        id: "33333333-3333-4333-8333-333333333333",
        name: "Wordbricks",
        handle: "wordbricks",
        role: "owner",
        createdAt: "2026-08-20T00:00:00.000Z",
        ignored: "server-extension",
      }),
    ).not.toHaveProperty("ignored");
    expect(decodeInboxReadVersions({ issue: "v2" })).toEqual({ issue: "v2" });
    expect(() => decodeInboxReadVersions({ "": "v2" })).toThrow();
    expect(() => decodeInboxReadVersions({ issue: "" })).toThrow();
  });
});
