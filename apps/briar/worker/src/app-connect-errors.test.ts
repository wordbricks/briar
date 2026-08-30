import { Code, createClient, ConnectError } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { ProjectService } from "@briar/contracts/gen/briar/app/v1/project_pb";
import {
  ValidationErrorDetailSchema,
} from "@briar/contracts/gen/briar/types/v1/error_pb";
import { describe, expect, it, vi } from "vitest";
import type { BriarAuth } from "./auth";
import {
  handleAppConnectRequest,
  type AppConnectServices,
} from "./app-connect";
import { appConnectProjectServices } from "./app-connect-project";

describe("App Connect errors", () => {
  it("preserves validation details across the HTTP boundary", async () => {
    const services: AppConnectServices = {
      ...appConnectProjectServices,
      requireSession: vi.fn(async () => ({
        user: { id: "user-1" },
      }) as never),
      updateTabs: vi.fn(),
    };
    const transport = createConnectTransport({
      baseUrl: "https://api.example.test",
      fetch: async (input, init) => {
        const response = await handleAppConnectRequest({
          request: new Request(input, init),
          auth: {} as BriarAuth,
          env: {
            DB: {} as D1Database,
            ARCHIVES: {} as R2Bucket,
            ATTACHMENTS: {} as R2Bucket,
          } as Env,
          requireRunExecutionProject: vi.fn(),
        }, services);
        return response ?? new Response(null, { status: 404 });
      },
    });
    const client = createClient(ProjectService, transport);

    const connectError = await client.updateProjectTabs({
      projectId: "not-a-uuid",
      schedule: true,
    }).catch((error: unknown) => error);

    expect(connectError).toBeInstanceOf(ConnectError);
    expect((connectError as ConnectError).code).toBe(Code.InvalidArgument);
    expect((connectError as ConnectError).rawMessage).toBe("Invalid request");
    expect(
      (connectError as ConnectError)
        .findDetails(ValidationErrorDetailSchema),
    ).toMatchObject([{
      violations: [{
        path: "",
        rule: "schema",
        message: expect.any(String),
      }],
    }]);
    expect(services.requireSession).toHaveBeenCalledOnce();
    expect(services.updateTabs).not.toHaveBeenCalled();
  });
});
