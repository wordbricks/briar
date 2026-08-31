import {
  htmlArtifactContentSecurityPolicy,
  isHtmlArtifactAttachment,
} from "../../src/lib/agent-reply-attachments";
import { contentDisposition } from "./attachment-storage";
import {
  type IssueAttachmentRow,
} from "./db";
import { corsHeaders } from "./http-response";

export function issueAttachmentResponse(
  attachment: Pick<
    IssueAttachmentRow,
    "filename" | "content_type" | "byte_size"
  >,
  object: R2Object,
  body: BodyInit | null,
) {
  const headers = new Headers(corsHeaders);
  headers.set("Cache-Control", "private, max-age=300");
  headers.set("Content-Disposition", contentDisposition(attachment.filename));
  headers.set("Content-Length", String(object.size));
  headers.set("Content-Type", attachment.content_type);
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  if (attachment.content_type.toLowerCase() === "image/svg+xml") {
    headers.set("Content-Security-Policy", "sandbox");
  } else if (
    isHtmlArtifactAttachment(attachment.content_type, attachment.filename)
  ) {
    headers.set(
      "Content-Security-Policy",
      `sandbox allow-scripts; ${htmlArtifactContentSecurityPolicy}`,
    );
  }
  return new Response(body, { headers });
}
