import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  decodeOrganizationAgentContextClaimQuery,
  decodeOrganizationAgentContextDescriptor,
  decodeOrganizationAgentContextLookupRequest,
  decodeOrganizationAgentContextLookupResult,
  organizationAgentContextCapability,
  OrganizationAgentContextDescriptor,
} from "./organization-agent-context-contract";

const snapshotAt = "2026-08-11T00:00:00.000Z";

describe("organization Agent context contract", () => {
  it("parses the fixed protocol descriptor", () => {
    expect(organizationAgentContextCapability).toEqual({ protocol: 1 });
    expect(
      decodeOrganizationAgentContextDescriptor({
        schemaVersion: 1,
        snapshotAt,
      }),
    ).toEqual({
      schemaVersion: 1,
      snapshotAt,
    });

    expect(() =>
      decodeOrganizationAgentContextDescriptor({
        schemaVersion: 2,
        snapshotAt,
      }),
    ).toThrow();
    expect(
      decodeOrganizationAgentContextDescriptor({
        schemaVersion: 1,
        snapshotAt: "2026-08-11T09:00:00.000+09:00",
      }).snapshotAt,
    ).toBe("2026-08-11T09:00:00.000+09:00");
    expect(() =>
      decodeOrganizationAgentContextDescriptor({
        schemaVersion: 1,
        snapshotAt: "2026-08-11T00:00:00",
      }),
    ).toThrow();

    const decodeCanonical = Schema.decodeUnknownSync(
      OrganizationAgentContextDescriptor,
    );
    expect(() =>
      decodeCanonical({
        schemaVersion: 1,
        snapshotAt,
        claimToken: "must-not-leak",
      }),
    ).toThrow();
  });

  it("accepts only the claim identity in manifest queries", () => {
    expect(
      decodeOrganizationAgentContextClaimQuery({ workerId: "  worker-1  " }),
    ).toEqual({ workerId: "worker-1" });
    expect(() => decodeOrganizationAgentContextClaimQuery({
      workerId: "worker-1",
      cursor: "legacy-cursor",
    })).toThrow();
  });

  it("applies lookup defaults while preserving unknown payload compatibility", () => {
    const request = decodeOrganizationAgentContextLookupRequest({
      resource: "issues",
      projectId: "project-1",
      detail: "summary",
    });
    expect(request).toEqual({
      resource: "issues",
      projectId: "project-1",
      detail: "summary",
      limit: 25,
      cursor: null,
    });
    expect(
      decodeOrganizationAgentContextLookupResult({
        request: {
          resource: "project-settings",
          projectId: "project-1",
        },
      }),
    ).toEqual({
      request: {
        resource: "project-settings",
        projectId: "project-1",
      },
    });
  });

});
