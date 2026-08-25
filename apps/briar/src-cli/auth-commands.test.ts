import { describe, expect, it, vi } from "vitest";
import { HttpRequestError } from "./execution-metrics-upload";
import { whoami, type WhoamiDependencies } from "./auth-commands";

const dependencies = (
  overrides: Partial<WhoamiDependencies> = {},
): WhoamiDependencies => ({
  loadAuthentication: async () => ({
    apiUrl: "https://briar.example",
    userToken: "stored-token",
  }),
  environmentToken: () => undefined,
  fetchCurrentUser: async () => ({
    user: {
      id: "user-1",
      name: "Jay Nam",
      email: "jay@example.com",
    },
  }),
  writeLine: vi.fn(),
  ...overrides,
});

describe("whoami", () => {
  it("prints the user returned by the authenticated API", async () => {
    const fetchCurrentUser = vi.fn(async () => ({
      user: {
        id: "user-1",
        name: "Jay Nam",
        email: "jay@example.com",
      },
    }));
    const writeLine = vi.fn();

    await whoami(dependencies({ fetchCurrentUser, writeLine }));

    expect(fetchCurrentUser).toHaveBeenCalledWith(
      "https://briar.example",
      "stored-token",
    );
    expect(writeLine).toHaveBeenCalledWith(
      "Jay Nam (jay@example.com) 계정으로 로그인되어 있습니다.",
    );
  });

  it("uses an environment token when one is configured", async () => {
    const fetchCurrentUser = vi.fn(async () => ({
      user: {
        id: "user-1",
        name: "Jay Nam",
        email: "jay@example.com",
      },
    }));

    await whoami(dependencies({
      environmentToken: () => "environment-token",
      fetchCurrentUser,
    }));

    expect(fetchCurrentUser).toHaveBeenCalledWith(
      "https://briar.example",
      "environment-token",
    );
  });

  it("explains how to log in when no token is available", async () => {
    await expect(whoami(dependencies({
      loadAuthentication: async () => ({ apiUrl: "https://briar.example" }),
    }))).rejects.toThrow(
      "Briar에 로그인되어 있지 않습니다. `briar login`을 실행하세요.",
    );
  });

  it("explains how to recover from an expired login", async () => {
    await expect(whoami(dependencies({
      fetchCurrentUser: async () => {
        throw new HttpRequestError("Unauthorized", 401, null);
      },
    }))).rejects.toThrow(
      "Briar 로그인이 만료되었거나 유효하지 않습니다. `briar login`을 다시 실행하세요.",
    );
  });
});
