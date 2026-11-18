import { create } from "@bufbuild/protobuf";
import { QueuedAttachmentSchema } from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { describe, expect, it } from "vitest";
import { channelReplyIssueAttachmentDefaults } from "./channel-reply-issue-attachments";
import { channelAttachmentMimeTypes } from "../src/lib/channel-attachments";
import { issueAttachmentStorageMimeTypes } from "../src/lib/issue-attachments";

const attachment = (
  id: string,
  filename: string,
  contentType: string,
) =>
  create(QueuedAttachmentSchema, {
    id,
    filename,
    contentType,
    byteSize: 128,
    url: `/channel-reply-attachments/${id}`,
  });

const reply = (
  issueAttachmentIds: readonly string[] | null,
) => ({
  body: "여기 있습니다",
  document: null,
  issueProposal: issueAttachmentIds === null ? null : {
    projectId: null,
    executeAfterCreate: false,
    issue: {
      title: "정책 문서 갱신",
      description: "첨부한 문서를 기준으로 갱신합니다.",
      priority: 2,
      attachmentIds: [...issueAttachmentIds],
    },
  },
  issueBatchProposal: null,
  executionProposal: null,
  skillExecutionProposal: null,
  delegation: null,
  agentMessage: null,
});

describe("channel reply issue attachment defaults", () => {
  it("carries the trigger's files when the Agent named none", () => {
    const result = channelReplyIssueAttachmentDefaults(reply([]), [
      attachment("635FAF72-E67A-4CB7-A3ED-E5029A3C7DBC", "Terms.md", "text/markdown"),
      attachment("72ffd893-f4af-4328-b2de-2194d8c21a01", "Privacy.md", "text/markdown"),
    ]);
    expect(result.issueProposal?.issue.attachmentIds).toEqual([
      "635faf72-e67a-4cb7-a3ed-e5029a3c7dbc",
      "72ffd893-f4af-4328-b2de-2194d8c21a01",
    ]);
  });

  it("leaves an explicit choice alone", () => {
    const chosen = ["635faf72-e67a-4cb7-a3ed-e5029a3c7dbc"];
    const result = channelReplyIssueAttachmentDefaults(reply(chosen), [
      attachment("72ffd893-f4af-4328-b2de-2194d8c21a01", "Other.md", "text/markdown"),
    ]);
    expect(result.issueProposal?.issue.attachmentIds).toEqual(chosen);
  });

  it("caps the default at five files and skips unstorable types", () => {
    const ids = Array.from(
      { length: 7 },
      (_unused, index) => `635faf72-e67a-4cb7-a3ed-e5029a3c7db${index}`,
    );
    const result = channelReplyIssueAttachmentDefaults(reply([]), [
      attachment("00000000-0000-4000-8000-00000000ffff", "Sheet.numbers", "application/x-iwork"),
      ...ids.map((id, index) => attachment(id, `Doc${index}.md`, "text/markdown")),
    ]);
    expect(result.issueProposal?.issue.attachmentIds).toEqual(ids.slice(0, 5));
  });

  it("returns the reply untouched when there is no proposal or no trigger file", () => {
    const withoutProposal = reply(null);
    expect(
      channelReplyIssueAttachmentDefaults(withoutProposal, [
        attachment("635faf72-e67a-4cb7-a3ed-e5029a3c7dbc", "Terms.md", "text/markdown"),
      ]),
    ).toBe(withoutProposal);
    const withoutTriggerFiles = reply([]);
    expect(channelReplyIssueAttachmentDefaults(withoutTriggerFiles, []))
      .toBe(withoutTriggerFiles);
  });

  /*
    The default and the server copy both stop at what the issue table accepts,
    so a file a person can attach in a DM must never be one the issue cannot
    hold. Migration 0218 widened the column to make this true; this keeps it so.
  */
  it("can store every type the channel composer accepts", () => {
    expect(issueAttachmentStorageMimeTypes).toEqual(
      expect.arrayContaining([...channelAttachmentMimeTypes]),
    );
  });
});
