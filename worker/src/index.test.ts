import { describe, expect, it } from "vitest";
import worker, {
  organizationUpdateInputSchema,
  projectAgentScheduleInputSchema,
  projectAgentScheduleRunCompletionSchema,
} from "./index";

describe("Worker HTTP contract", () => {
  it("normalizes recurring agent schedule input", () => {
    expect(
      projectAgentScheduleInputSchema.parse({
        agentId: "11111111-1111-4111-8111-111111111111",
        name: "  Weekly audit  ",
        recurrence: "weekly",
        timeOfDay: "09:30",
        dayOfWeek: 1,
        timeZone: "Asia/Seoul",
      }),
    ).toEqual({
      agentId: "11111111-1111-4111-8111-111111111111",
      name: "Weekly audit",
      recurrence: "weekly",
      timeOfDay: "09:30",
      dayOfWeek: 1,
      timeZone: "Asia/Seoul",
    });
    expect(
      projectAgentScheduleInputSchema.parse({
        agentId: "11111111-1111-4111-8111-111111111111",
        name: "Daily audit",
        recurrence: "daily",
        timeOfDay: "08:00",
        dayOfWeek: 4,
        timeZone: "Etc/UTC",
      }).dayOfWeek,
    ).toBeNull();
    expect(() =>
      projectAgentScheduleInputSchema.parse({
        agentId: "11111111-1111-4111-8111-111111111111",
        name: "Invalid zone",
        recurrence: "daily",
        timeOfDay: "08:00",
        timeZone: "Mars/Olympus",
      }),
    ).toThrow(/Invalid IANA time zone/u);
  });

  it("accepts a name-only organization update", () => {
    expect(
      organizationUpdateInputSchema.parse({ name: "  Briar Labs  " }),
    ).toEqual({
      name: "Briar Labs",
    });
  });

  it("requires a matching outcome payload for schedule-run completion", () => {
    const claimToken = `briar_schedule_claim_${"a".repeat(64)}`;
    expect(
      projectAgentScheduleRunCompletionSchema.parse({
        claimToken,
        status: "completed",
        resultSummary: "Repository audit completed.",
        error: null,
      }),
    ).toEqual({
      claimToken,
      status: "completed",
      resultSummary: "Repository audit completed.",
      error: null,
    });
    expect(() =>
      projectAgentScheduleRunCompletionSchema.parse({
        claimToken,
        status: "failed",
        resultSummary: null,
        error: null,
      }),
    ).toThrow(/failed runs require an error/u);
  });

  it("renders mobile Companion authorization and returns to the app", async () => {
    const response = await worker.fetch(
      new Request(
        "https://briar-api.example/device?user_code=F65P9NQN&client=mobile",
      ),
      {} as never,
    );
    const page = await response.text();

    expect(response.status).toBe(200);
    expect(page).toContain("Companion 로그인 승인");
    expect(page).not.toContain("<h1>데스크톱 연결 승인</h1>");
    expect(page).toContain("briar-companion://auth-complete");
    expect(page).toContain("callbackParams.set('client','mobile')");
  });

  it("keeps the desktop authorization copy for desktop clients", async () => {
    const response = await worker.fetch(
      new Request("https://briar-api.example/device?user_code=F65P9NQN"),
      {} as never,
    );
    const page = await response.text();

    expect(page).toContain("<h1>데스크톱 연결 승인</h1>");
    expect(page).not.toContain("<h1>Companion 로그인 승인</h1>");
  });

  it("allows project deletion through CORS preflight", async () => {
    const response = await worker.fetch(
      new Request(
        "https://briar-api.example/projects/00000000-0000-0000-0000-000000000000",
        {
          method: "OPTIONS",
          headers: {
            "Access-Control-Request-Headers": "authorization, content-type",
            "Access-Control-Request-Method": "DELETE",
            Origin: "tauri://localhost",
          },
        },
      ),
      {} as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "authorization",
    );
    expect(
      response.headers
        .get("Access-Control-Allow-Methods")
        ?.split(",")
        .map((method) => method.trim()),
    ).toContain("DELETE");
  });
});
