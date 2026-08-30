import { create, toBinary } from "@bufbuild/protobuf";
import {
  CreateIssueResponseSchema,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestProtobuf } from "./request";

describe("protobuf HTTP response transport", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requests and decodes the generated response contract", async () => {
    const encoded = toBinary(
      CreateIssueResponseSchema,
      create(CreateIssueResponseSchema, {
        runId: "run-1",
        sourceKey: "briar-issue:run-1",
        stage: "queued",
        createdByUserId: "user-1",
      }),
    );
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_input, init) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("Accept")).toBe("application/protobuf");
        expect(headers.get("Authorization")).toBe("Bearer token");
        expect(init?.body).toBeInstanceOf(FormData);
        return new Response(encoded, {
          headers: { "Content-Type": "application/protobuf" },
        });
      },
    );

    const response = await requestProtobuf(
      "/projects/project-1/issues",
      "token",
      CreateIssueResponseSchema,
      { method: "POST", body: new FormData() },
    );

    expect(fetch).toHaveBeenCalledOnce();
    expect(response).toMatchObject({
      runId: "run-1",
      sourceKey: "briar-issue:run-1",
      stage: "queued",
      createdByUserId: "user-1",
    });
  });
});
