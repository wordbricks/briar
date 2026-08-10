import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import worker from "./index";
import {
  mobileClientIds,
  mobileDashboardDeltaSchema,
  mobileDashboardSnapshotSchema,
  mobileOperationSchemas,
  mobileProjectAgentTaskRequestSchema,
} from "./mobile-contract";

type FixtureOperation = {
  method: string;
  path: string;
  status: number;
  request?: unknown;
  response: unknown;
  errorResponse?: unknown;
};

const fixture = JSON.parse(readFileSync(
  new URL("../../contracts/mobile/fixtures/companion-v1.json", import.meta.url),
  "utf8",
)) as {
  mobileClientIds: string[];
  operations: Record<string, FixtureOperation>;
};

const openapi = JSON.parse(readFileSync(
  new URL("../../contracts/mobile/companion.openapi.yaml", import.meta.url),
  "utf8",
)) as {
  openapi: string;
  paths: Record<string, Record<string, { operationId: string }>>;
};

describe("Companion mobile API contract", () => {
  it("keeps the OpenAPI subset and Worker fixture operation map aligned", () => {
    expect(openapi.openapi).toBe("3.1.0");
    expect(fixture.mobileClientIds).toEqual([...mobileClientIds]);
    expect(Object.keys(fixture.operations).sort()).toEqual(
      Object.keys(mobileOperationSchemas).sort(),
    );

    for (const [operationId, operation] of Object.entries(fixture.operations)) {
      const documentedPath = operation.path.replace(/\?.*$/u, "");
      const documentedOperation = openapi.paths[documentedPath]?.[
        operation.method.toLowerCase()
      ];
      expect(documentedOperation?.operationId).toBe(operationId);
      expect(operation.status).toBe(200);
    }
  });

  it("validates every shared request, response, and polling error fixture", () => {
    for (const operationId of Object.keys(mobileOperationSchemas) as Array<
      keyof typeof mobileOperationSchemas
    >) {
      const schemas = mobileOperationSchemas[operationId] as {
        request?: { parse(value: unknown): unknown };
        response: { parse(value: unknown): unknown };
        errorResponse?: { parse(value: unknown): unknown };
      };
      const operation = fixture.operations[operationId];
      expect(() => schemas.response.parse(operation.response)).not.toThrow();
      if (schemas.request) {
        expect(() => schemas.request?.parse(operation.request)).not.toThrow();
      }
      if (schemas.errorResponse) {
        expect(() => schemas.errorResponse?.parse(operation.errorResponse))
          .not.toThrow();
      }
    }
  });

  it("carries the Agent name with session snapshots", () => {
    const listResponse = mobileOperationSchemas.listProjectAgentSessions.response
      .parse(fixture.operations.listProjectAgentSessions.response);
    const taskResponse = mobileOperationSchemas.runProjectAgentTask.response
      .parse(fixture.operations.runProjectAgentTask.response);

    expect(listResponse.sessions[0]?.agentName).toBe("Issue processing agent");
    expect(taskResponse.session.agentName).toBe("Issue processing agent");
  });

  it("preserves organization providers in full and delta dashboard payloads", () => {
    const organizationProviders = ["grok", "opencode", "codex"] as const;
    const snapshot = mobileDashboardSnapshotSchema.parse({
      ...(fixture.operations.getDashboardSnapshot.response as object),
      organizationProviders,
    });
    const delta = mobileDashboardDeltaSchema.parse({
      ...(fixture.operations.getDashboardDelta.response as object),
      organizationProviders,
    });

    expect(snapshot.organizationProviders).toEqual(organizationProviders);
    expect(delta.organizationProviders).toEqual(organizationProviders);
  });

  it("requires callers to choose an Agent Skill before running a task", () => {
    const request = fixture.operations.runProjectAgentTask.request as Record<
      string,
      unknown
    >;

    expect(mobileProjectAgentTaskRequestSchema.parse(request).skillId).toBe(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    const requestWithoutSkill = { ...request };
    delete requestWithoutSkill.skillId;
    expect(
      mobileProjectAgentTaskRequestSchema.safeParse(requestWithoutSkill).success,
    ).toBe(false);
  });

  it("serves the documented health fixture from the Worker", async () => {
    const response = await worker.fetch(
      new Request("https://briar-api.example/health"),
      {} as never,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      fixture.operations.getHealth.response,
    );
  });

  it.each(["mobile", "android"])(
    "renders Companion authorization for the %s client route",
    async (client) => {
      const response = await worker.fetch(
        new Request(`https://briar-api.example/device?client=${client}`),
        {} as never,
      );
      const page = await response.text();

      expect(response.status).toBe(200);
      expect(page).toContain("Companion 로그인 승인");
      expect(page).toContain("briar-companion://auth-complete");
    },
  );
});
