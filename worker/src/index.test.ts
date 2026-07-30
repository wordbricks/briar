import { describe, expect, it } from "vitest";
import worker, {
  issueUpdateInputSchema,
  organizationLogoInputSchema,
  organizationMemberRoleInputSchema,
  organizationUpdateInputSchema,
  projectAgentScheduleInputSchema,
  projectAgentScheduleRunCompletionSchema,
  readRunEvidenceRequest,
  runEvidenceInputSchema,
  runReworkInputSchema,
} from "./index";

describe("Worker HTTP contract", () => {
  it("accepts only assignable organization member roles", () => {
    expect(organizationMemberRoleInputSchema.parse({ role: "admin" })).toEqual({
      role: "admin",
    });
    expect(() =>
      organizationMemberRoleInputSchema.parse({ role: "owner" }),
    ).toThrow();
  });

  it("accepts exact workflow evidence names containing spaces and slashes", () => {
    expect(
      runEvidenceInputSchema.parse({
        evidenceKey: "LOCAL-1:local_qa:signoff",
        stage: "local_qa",
        type: "  signoff/app worker  ",
        status: "passed",
        observedAt: "2026-07-28T00:00:00.000Z",
        actor: "briar-workflow",
      }).type,
    ).toBe("signoff/app worker");
  });

  it("parses evidence images from multipart CLI requests", async () => {
    const evidence = {
      evidenceKey: "LOCAL-1:local_qa:screenshot",
      stage: "local_qa",
      type: "ui_screenshot",
      status: "passed",
      observedAt: "2026-07-28T00:00:00.000Z",
      actor: "briar-workflow",
    };
    const form = new FormData();
    form.append("evidence", JSON.stringify(evidence));
    form.append(
      "images",
      new File([new Uint8Array([137, 80, 78, 71])], "dashboard.png", {
        type: "image/png",
      }),
    );

    const parsed = await readRunEvidenceRequest(
      new Request("https://briar-api.example/runs/run/evidence", {
        method: "POST",
        headers: { "Content-Length": "1024" },
        body: form,
      }),
    );

    expect(parsed.input).toEqual(evidence);
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.name).toBe("dashboard.png");
    expect(parsed.images[0]?.type).toBe("image/png");
  });

  it("requires an explicit earlier stage and reason for run rework", () => {
    expect(
      runReworkInputSchema.parse({
        requestId: "11111111-1111-4111-8111-111111111111",
        workflowStage: "implementing",
        reason: "Local QA found a product-code defect.",
        actor: "briar-workflow",
      }),
    ).toEqual({
      requestId: "11111111-1111-4111-8111-111111111111",
      workflowStage: "implementing",
      reason: "Local QA found a product-code defect.",
      actor: "briar-workflow",
    });
    expect(() =>
      runReworkInputSchema.parse({
        requestId: "11111111-1111-4111-8111-111111111111",
        workflowStage: "implementing",
        reason: " ",
        actor: "briar-workflow",
      }),
    ).toThrow();
  });

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
      intervalValue: 1,
      intervalUnit: "day",
      daysOfWeek: [],
      notificationLevel: "important_updates",
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

  it("normalizes custom schedule days and requires a weekly selection", () => {
    expect(
      projectAgentScheduleInputSchema.parse({
        agentId: "11111111-1111-4111-8111-111111111111",
        name: "Alternating review",
        recurrence: "custom",
        timeOfDay: "09:00",
        intervalValue: 2,
        intervalUnit: "week",
        daysOfWeek: [5, 1, 5],
        notificationLevel: "none",
        timeZone: "Asia/Seoul",
      }),
    ).toMatchObject({
      recurrence: "custom",
      intervalValue: 2,
      intervalUnit: "week",
      daysOfWeek: [1, 5],
      notificationLevel: "none",
    });
    expect(() =>
      projectAgentScheduleInputSchema.parse({
        agentId: "11111111-1111-4111-8111-111111111111",
        name: "Missing weekdays",
        recurrence: "custom",
        timeOfDay: "09:00",
        intervalUnit: "week",
        daysOfWeek: [],
        timeZone: "Asia/Seoul",
      }),
    ).toThrow(/Choose at least one weekday/u);
  });

  it("accepts a name-only organization update", () => {
    expect(
      organizationUpdateInputSchema.parse({ name: "  Briar Labs  " }),
    ).toEqual({
      name: "Briar Labs",
    });
  });

  it("accepts bounded browser-supported organization logos or removal", () => {
    expect(
      organizationLogoInputSchema.parse({
        logo: "data:image/webp;base64,bG9nbw==",
      }),
    ).toEqual({ logo: "data:image/webp;base64,bG9nbw==" });
    expect(
      organizationLogoInputSchema.parse({
        logo: "data:image/png;base64,bG9nbw==",
      }),
    ).toEqual({ logo: "data:image/png;base64,bG9nbw==" });
    expect(
      organizationLogoInputSchema.parse({
        logo: "data:image/jpeg;base64,bG9nbw==",
      }),
    ).toEqual({ logo: "data:image/jpeg;base64,bG9nbw==" });
    expect(organizationLogoInputSchema.parse({ logo: null })).toEqual({
      logo: null,
    });
    expect(() =>
      organizationLogoInputSchema.parse({
        logo: "data:image/gif;base64,bG9nbw==",
      }),
    ).toThrow();
  });

  it("validates editable issue fields", () => {
    expect(
      issueUpdateInputSchema.parse({
        title: "  Updated issue  ",
        description: null,
        priority: 1,
      }),
    ).toEqual({
      title: "Updated issue",
      description: null,
      priority: 1,
    });
    expect(() =>
      issueUpdateInputSchema.parse({
        title: "",
        description: null,
        priority: 5,
      }),
    ).toThrow();
  });

  it("requires a matching outcome payload for schedule-run completion", () => {
    const claimToken = `briar_schedule_claim_${"a".repeat(64)}`;
    expect(
      projectAgentScheduleRunCompletionSchema.parse({
        claimToken,
        status: "completed",
        resultSummary: "Repository audit completed.",
        structuredResult: {
          summary: "Repository audit completed.",
          outcome: "completed",
          importance: "routine",
          urgency: "normal",
          impact: "issue",
          humanActionRequired: false,
          nextAction: null,
          dueAt: null,
        },
        error: null,
      }),
    ).toEqual({
      claimToken,
      status: "completed",
      resultSummary: "Repository audit completed.",
      structuredResult: {
        summary: "Repository audit completed.",
        outcome: "completed",
        importance: "routine",
        urgency: "normal",
        impact: "issue",
        humanActionRequired: false,
        nextAction: null,
        dueAt: null,
      },
      error: null,
    });
    expect(() =>
      projectAgentScheduleRunCompletionSchema.parse({
        claimToken,
        status: "failed",
        resultSummary: null,
        structuredResult: {
          summary: "Runner stopped.",
          outcome: "failed",
          importance: "important",
          urgency: "time_sensitive",
          impact: "issue",
          humanActionRequired: true,
          nextAction: "Inspect the runner.",
          dueAt: null,
        },
        error: null,
      }),
    ).toThrow(/failed runs require an error/u);
    expect(() =>
      projectAgentScheduleRunCompletionSchema.parse({
        claimToken,
        status: "completed",
        resultSummary: "A legacy summary.",
        structuredResult: {
          summary: "A structured summary.",
          outcome: "completed",
          importance: "routine",
          urgency: "normal",
          impact: "issue",
          humanActionRequired: false,
          nextAction: null,
          dueAt: null,
        },
        error: null,
      }),
    ).toThrow(/resultSummary must match structuredResult.summary/u);
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
    expect(page).toContain("/brand/briar-icon.png");
    expect(page).not.toContain("briar-mark.svg");
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

  it("allows worker concurrency updates through CORS preflight", async () => {
    const response = await worker.fetch(
      new Request(
        "https://briar-api.example/organizations/00000000-0000-0000-0000-000000000000/workers/device-id",
        {
          method: "OPTIONS",
          headers: {
            "Access-Control-Request-Headers": "authorization, content-type",
            "Access-Control-Request-Method": "PATCH",
            Origin: "tauri://localhost",
          },
        },
      ),
      {} as never,
    );

    expect(response.status).toBe(200);
    expect(
      response.headers
        .get("Access-Control-Allow-Methods")
        ?.split(",")
        .map((method) => method.trim()),
    ).toContain("PATCH");
  });
});
