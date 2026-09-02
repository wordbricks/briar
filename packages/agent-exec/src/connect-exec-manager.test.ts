import { describe, expect, it } from "vitest";
import {
  BOX_EXEC_DISPLAY_HEADER,
  BOX_EXEC_OWNER_HEADER,
  BoxExecConnectionError,
  boxExecHeaders,
  loopbackBoxExecConnection,
} from "./connect-exec-manager";

describe("box exec connection", () => {
  it("uses the Grok primary and fork endpoint semantics", () => {
    expect(loopbackBoxExecConnection({ authToken: "token" })).toEqual({
      baseUrl: "http://127.0.0.1:1337",
      authToken: "token",
      displayIndex: undefined,
      ownerToken: undefined,
    });
    const fork = loopbackBoxExecConnection({
      authToken: "token",
      displayIndex: 2,
      ownerToken: "owner-token",
    });
    expect(fork.baseUrl).toBe("http://127.0.0.1:1339");
    expect(boxExecHeaders(fork)).toEqual({
      Authorization: "Bearer token",
      [BOX_EXEC_DISPLAY_HEADER]: "2",
      [BOX_EXEC_OWNER_HEADER]: "owner-token",
    });
  });

  it("rejects incomplete or malformed fork ownership", () => {
    expect(() => boxExecHeaders({
      baseUrl: "http://127.0.0.1:1339",
      authToken: "token",
      displayIndex: 2,
    })).toThrow(BoxExecConnectionError);
    expect(() => boxExecHeaders({
      baseUrl: "http://127.0.0.1:1339",
      authToken: "token",
      displayIndex: 2,
      ownerToken: "bad token",
    })).toThrow(BoxExecConnectionError);
  });
});
