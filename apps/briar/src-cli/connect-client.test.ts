import { ProjectService } from "@briar/contracts/gen/briar/app/v1/project_pb";
import { afterEach, expect, it, vi } from "vitest";
import { createAuthenticatedConnectClient } from "./connect-client";

afterEach(() => vi.unstubAllGlobals());

it("adds bearer authentication to a generated Connect client", async () => {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    expect(request.headers.get("authorization")).toBe("Bearer user-token");
    return new Response(JSON.stringify({ projects: [] }), {
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetch);

  await expect(createAuthenticatedConnectClient(
    ProjectService,
    "https://briar.example/",
    "user-token",
  ).listProjects({})).resolves.toMatchObject({ projects: [] });
  expect(fetch).toHaveBeenCalledOnce();
});
