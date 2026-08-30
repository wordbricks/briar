import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  CreateIssueRequestSchema,
  CreateIssueResponseSchema,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requestProtobuf,
  setMultipartProtobufRequest,
} from "./request";

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

  it("writes the generated request as the sole typed metadata part", async () => {
    const form = new FormData();
    setMultipartProtobufRequest(
      form,
      CreateIssueRequestSchema,
      create(CreateIssueRequestSchema, {
        projectId: "11111111-1111-4111-8111-111111111111",
        title: "Generated metadata",
      }),
    );

    const part = form.get("request");
    expect(part).toBeInstanceOf(File);
    expect((part as File).name).toBe("request.pb");
    expect((part as File).type).toBe("application/protobuf");
    expect(fromBinary(
      CreateIssueRequestSchema,
      new Uint8Array(await (part as File).arrayBuffer()),
    )).toMatchObject({
      projectId: "11111111-1111-4111-8111-111111111111",
      title: "Generated metadata",
    });
  });
});
