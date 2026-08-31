import { createClient, createRouterTransport } from "@connectrpc/connect";
import {
  IssueService,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIssue } from "./issue";

const observed = {
  preparationRequestId: "",
  preparedClientIssueId: "",
  finalClientIssueId: "",
  finalDescription: "",
  finalUploadIds: [] as string[],
  digest: [] as number[],
};

const client = createClient(IssueService, createRouterTransport((router) => {
  router.service(IssueService, {
    prepareCreateIssueAttachments(request) {
      observed.preparationRequestId = request.preparationRequestId;
      observed.preparedClientIssueId = request.clientIssueId;
      observed.digest = [...(request.attachments[0]?.sha256 ?? [])];
      return {
        uploads: [{
          clientId: request.attachments[0]?.clientId,
          reference: { uploadId: "upload-screen" },
          uploadUrl: "https://api.briar.test/uploads/upload-screen",
          uploadCapability: "capability-screen",
        }],
      };
    },
    createIssue(request) {
      observed.finalClientIssueId = request.clientIssueId;
      observed.finalDescription = request.description ?? "";
      observed.finalUploadIds = request.attachments.map(({ uploadId }) =>
        uploadId
      );
      return {
        runId: request.clientIssueId,
        sourceKey: `briar-issue:${request.clientIssueId}`,
        status: request.status,
        stage: "queued",
        createdByUserId: "user-1",
      };
    },
  });
}));

describe("Issue prepared upload boundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("binds one stable ID across prepare, raw PUT, and final Connect mutation", async () => {
    const file = new File(["screen"], "screen.png", { type: "image/png" });
    const upload = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    const result = await createIssue(
      "session-token",
      "project-1",
      {
        title: "Upload screenshot",
        description: "![screen](briar-attachment://local-screen)",
        priority: null,
        difficulty: null,
        status: "backlog",
        attachments: [file],
        attachmentReferences: ["local-screen"],
      },
      {
        client,
        apiUrl: "https://api.briar.test",
        fetch: upload,
        randomUUID: () => crypto.randomUUID(),
        callOptions: () => ({}),
      },
    );

    expect(observed.preparationRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(observed.preparedClientIssueId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(observed.finalClientIssueId).toBe(observed.preparedClientIssueId);
    expect(result.runId).toBe(observed.preparedClientIssueId);
    expect(observed.digest).toHaveLength(32);
    expect(observed.finalDescription).toBe(
      "![screen](briar-attachment://upload-screen)",
    );
    expect(observed.finalUploadIds).toEqual(["upload-screen"]);
    expect(upload).toHaveBeenCalledOnce();
    const [url, init] = upload.mock.calls[0]!;
    expect(String(url)).toBe("https://api.briar.test/uploads/upload-screen");
    expect(init).toMatchObject({ method: "PUT", body: file });
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer capability-screen",
    );
    expect(new Headers(init?.headers).get("content-type")).toBe("image/png");
  });
});
