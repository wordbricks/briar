import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  buildWhatsAppReplyChunks,
  callWhatsAppMessagesApi,
  decodeWhatsAppWebhookMessages,
  markdownToWhatsApp,
  normalizeWhatsAppPhoneNumber,
  splitWhatsAppText,
  verifyWhatsAppSignature,
  whatsappMaximumTextLength,
} from "./whatsapp";

describe("WhatsApp Cloud API helpers", () => {
  it("normalizes phone numbers and decodes supported and unsupported deliveries", () => {
    expect(normalizeWhatsAppPhoneNumber("+82 10-1234-5678")).toBe("821012345678");
    expect(normalizeWhatsAppPhoneNumber("local-number")).toBeNull();
    expect(decodeWhatsAppWebhookMessages({
      object: "whatsapp_business_account",
      entry: [{
        changes: [{
          field: "messages",
          value: {
            metadata: { phone_number_id: "101010" },
            messages: [
              {
                from: "821012345678",
                id: "wamid.text",
                timestamp: "1788710400",
                type: "text",
                text: { body: " 안녕하세요 " },
              },
              {
                from: "821012345678",
                id: "wamid.image",
                type: "image",
              },
            ],
          },
        }],
      }],
    })).toEqual([
      {
        phoneNumberId: "101010",
        from: "821012345678",
        wamid: "wamid.text",
        type: "text",
        body: "안녕하세요",
      },
      {
        phoneNumberId: "101010",
        from: "821012345678",
        wamid: "wamid.image",
        type: "image",
        body: null,
      },
    ]);
  });

  it("verifies the raw request body with the Meta app secret", async () => {
    const body = new TextEncoder().encode('{"object":"whatsapp_business_account"}');
    const secret = "meta-app-secret";
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    await expect(verifyWhatsAppSignature(body, signature, secret)).resolves.toBe(true);
    await expect(verifyWhatsAppSignature(body, `sha256=${"0".repeat(64)}`, secret))
      .resolves.toBe(false);
  });

  it("downgrades Markdown and splits Unicode text within the 4096-character limit", () => {
    expect(markdownToWhatsApp(
      "# 제목\n**중요** [문서](https://example.com) ~~취소~~",
    )).toBe("*제목*\n*중요* 문서 (https://example.com) ~취소~");
    const chunks = splitWhatsAppText(`시작\n${"가".repeat(8_300)}😀`);
    expect(chunks.length).toBe(3);
    expect(chunks.every((chunk) =>
      Array.from(chunk).length <= whatsappMaximumTextLength
    )).toBe(true);
    expect(chunks.join("").replaceAll("\n", "")).toContain("😀");
  });

  it("adds an app-only approval summary before splitting", () => {
    const chunks = buildWhatsAppReplyChunks({
      body: "처리 계획입니다.",
      approvalSummary: "이슈 실행 제안이 도착했습니다.",
      appOrigin: "https://briar.example/",
      organizationId: "11111111-1111-4111-8111-111111111111",
      channelId: "22222222-2222-4222-8222-222222222222",
      messageId: "33333333-3333-4333-8333-333333333333",
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("검토와 승인은 보안을 위해 Briar 앱에서만");
    expect(chunks[0]).toContain(
      "https://briar.example/open/channels/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333",
    );
  });

  it("sends the documented text payload without exposing the token in failures", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
      messaging_product: "whatsapp",
      messages: [{ id: "wamid.outbound" }],
    }));
    await callWhatsAppMessagesApi({
      graphApiVersion: "v25.0",
      phoneNumberId: "101010",
      accessToken: "secret-access-token",
      recipientPhone: "821012345678",
      body: "답변",
    }, fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      "https://graph.facebook.com/v25.0/101010/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer secret-access-token",
        }),
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: "821012345678",
          type: "text",
          text: { preview_url: false, body: "답변" },
        }),
      }),
    );

    await expect(callWhatsAppMessagesApi({
      graphApiVersion: "v25.0",
      phoneNumberId: "101010",
      accessToken: "secret-access-token",
      recipientPhone: "821012345678",
      body: "답변",
    }, vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
      error: { code: 131047, message: "Window expired" },
    }, { status: 400 })))).rejects.toMatchObject({
      status: 400,
      code: 131047,
      message: "Window expired",
    });
  });
});
