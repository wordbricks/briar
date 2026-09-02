import { describe, expect, it } from "vitest";
import {
  createDeviceAuthorizationClient,
  createDeviceVerificationUrl,
  type DeviceAuthorizationFetch,
} from "./device-authorization-client";

const jsonResponse = (body: unknown, status = 200) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: { "content-type": "application/json" },
  },
);

describe("Better Auth device authorization boundary", () => {
  it("preserves the user code when adding the selected method and locale", () => {
    expect(createDeviceVerificationUrl(
      "https://briar.wordbricks.ai/device?user_code=ABCD-1234",
      "briar-desktop",
      { method: "email", locale: "ko" },
    )).toBe(
      "https://briar.wordbricks.ai/device?user_code=ABCD-1234&method=email&locale=ko",
    );
  });

  it("uses the generated device code route and rejects a malformed success", async () => {
    let requestedUrl = "";
    let requestedBody: unknown;
    const fetch: DeviceAuthorizationFetch = async (input, init) => {
      requestedUrl = String(input);
      requestedBody = JSON.parse(String(init?.body));
      return jsonResponse({
        device_code: "device-code",
        user_code: "ABCD-1234",
        verification_uri: "https://briar.example/device",
        verification_uri_complete:
          "https://briar.example/device?user_code=ABCD-1234",
        expires_in: 300,
      });
    };
    const client = createDeviceAuthorizationClient(
      "https://briar.example",
      { fetch },
    );

    await expect(client.requestCode({
      clientId: "briar-cli",
      scope: "openid profile email",
    })).rejects.toThrow();
    expect(requestedUrl).toBe(
      "https://briar.example/api/auth/device/code",
    );
    expect(requestedBody).toEqual({
      client_id: "briar-cli",
      scope: "openid profile email",
    });
  });

  it("classifies RFC polling errors from structured bodies", async () => {
    const responses = [
      jsonResponse({
        error: "authorization_pending",
        error_description: "awaiting an explicit approval",
      }, 400),
      jsonResponse({
        error: "slow_down",
        error_description: "polling interval exceeded",
      }, 400),
      jsonResponse({
        error: "access_denied",
        error_description: "the user denied this request",
      }, 400),
      jsonResponse({
        error: "expired_token",
        error_description: "the code reached its deadline",
      }, 400),
      jsonResponse({
        access_token: "session-token",
        token_type: "Bearer",
        expires_in: 3_600,
        scope: "openid profile email",
      }),
    ];
    const requestedBodies: unknown[] = [];
    const fetch: DeviceAuthorizationFetch = async (_input, init) => {
      requestedBodies.push(JSON.parse(String(init?.body)));
      const response = responses.shift();
      if (!response) throw new Error("Unexpected device token poll");
      return response;
    };
    const client = createDeviceAuthorizationClient(
      "https://briar.example",
      { fetch },
    );
    const poll = () => client.pollToken({
      clientId: "briar-desktop",
      deviceCode: "device-code",
    });

    await expect(poll()).resolves.toMatchObject({
      status: "authorization_pending",
    });
    await expect(poll()).resolves.toMatchObject({ status: "slow_down" });
    await expect(poll()).resolves.toMatchObject({ status: "access_denied" });
    await expect(poll()).resolves.toMatchObject({ status: "expired_token" });
    await expect(poll()).resolves.toMatchObject({
      status: "authorized",
      accessToken: "session-token",
    });
    expect(requestedBodies[0]).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: "device-code",
      client_id: "briar-desktop",
    });
  });
});
