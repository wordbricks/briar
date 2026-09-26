import { describe, expect, test } from "vitest";
import worker, { normalizeWebAppApiRequest } from "./api-worker";

const preflight = (origin: string) => worker.fetch(
  new Request(
    "https://briar-api.wbai.workers.dev/api/auth/device/code",
    {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    },
  ),
  {} as Env,
);

describe("credentialed auth CORS", () => {
  test("allows the production web app to send credentialed auth requests", async () => {
    const response = await preflight("https://briar.onequery.dev");

    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://briar.onequery.dev",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
    expect(response.headers.get("vary")).toContain("Origin");
  });

  test("still allows the legacy domain during transition", async () => {
    const response = await preflight("https://briar.wordbricks.ai");

    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://briar.wordbricks.ai",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
  });

  test("does not grant credentialed access to an untrusted origin", async () => {
    const response = await preflight("https://attacker.example");

    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(response.headers.has("access-control-allow-credentials")).toBe(
      false,
    );
  });
});

describe("web app API proxy", () => {
  test("strips only the first-party API prefix before routing", async () => {
    const request = new Request(
      "https://briar.onequery.dev/app-api/briar.app.v1.AccountService/GetCurrentUser?view=full",
      { method: "POST", body: "{}" },
    );

    const normalized = normalizeWebAppApiRequest(request);

    expect(normalized.url).toBe(
      "https://briar.onequery.dev/briar.app.v1.AccountService/GetCurrentUser?view=full",
    );
    expect(normalized.method).toBe("POST");
    await expect(normalized.text()).resolves.toBe("{}");
  });

  test("leaves non-proxy routes unchanged", () => {
    const request = new Request("https://briar.onequery.dev/api/auth/get-session");

    expect(normalizeWebAppApiRequest(request)).toBe(request);
  });
});
