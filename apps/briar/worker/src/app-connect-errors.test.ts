import { env } from "cloudflare:workers";
import { Code, createClient, ConnectError } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { TeamService } from "@briar/contracts/gen/briar/app/v1/team_pb";
import {
  ValidationErrorDetailSchema,
} from "@briar/contracts/gen/briar/types/v1/error_pb";
import { describe, expect, it, vi } from "vitest";
import type { BriarAuth } from "./auth";
import {
  handleAppConnectRequest,
  type AppConnectServices,
} from "./app-connect";
import { appConnectTeamServices } from "./app-connect-team";

describe("App Connect errors", () => {
  it("preserves validation details across the HTTP boundary", async () => {
    const services: AppConnectServices = {
      ...appConnectTeamServices,
      requireSession: vi.fn(async () => ({
        user: { id: "user-1" },
      }) as never),
      updateTabs: vi.fn(),
    };
    const transport = createConnectTransport({
      baseUrl: "https://api.example.test",
      fetch: async (input, init) => {
        // Connect-Web uses redirect:error, which workerd deliberately does not
        // implement. This in-memory fetch cannot redirect, so manual preserves
        // the intended fail-closed behavior while using the real HTTP codec.
        const request = new Request(input, { ...init, redirect: "manual" });
        const response = await handleAppConnectRequest({
          request,
          auth: {} as BriarAuth,
          env,
          requireRunExecutionProject: vi.fn(),
        }, services);
        return response ?? new Response(null, { status: 404 });
      },
    });
    const client = createClient(TeamService, transport);

    const connectError = await client.updateTeamTabs({
      teamId: "not-a-uuid",
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
