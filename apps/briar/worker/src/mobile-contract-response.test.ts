import { listProjectsOperation } from "@briar/mobile-contracts";
import { describe, expect, it } from "vitest";
import { mobileJson } from "./mobile-contract-response";

const currentProject = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Briar",
  issueKeyPrefix: "BR",
  scheduleTabEnabled: true,
  icon: null,
  organizationId: "22222222-2222-4222-8222-222222222222",
  organizationName: "Wordbricks",
  role: "owner",
  createdAt: "2026-08-20T00:00:00.000Z",
} as const;

describe("canonical mobile responses", () => {
  it("validates the current wire shape without stripping additive fields", async () => {
    const response = mobileJson(listProjectsOperation, {
      projects: [{ ...currentProject, futureProjectField: true }],
      futureEnvelopeField: "preserved",
    });

    expect(response.status).toBe(listProjectsOperation.response.status);
    expect(await response.json()).toEqual({
      projects: [{ ...currentProject, futureProjectField: true }],
      futureEnvelopeField: "preserved",
    });
  });

  it("rejects a success response that omits a current wire field", () => {
    const { scheduleTabEnabled: _scheduleTabEnabled, ...staleProject } =
      currentProject;

    expect(() =>
      mobileJson(listProjectsOperation, { projects: [staleProject] })
    ).toThrow();
    expect(() =>
      mobileJson(listProjectsOperation, {
        projects: [{ ...currentProject, createdAt: "not-a-datetime" }],
      })
    ).toThrow();
  });
});
