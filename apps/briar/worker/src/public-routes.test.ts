import { describe, expect, it } from "vitest";
import { handlePublicRoute } from "./public-routes";

const projectId = "11111111-1111-4111-8111-111111111111";
const targetId = "22222222-2222-4222-8222-222222222222";

const requestOpenPage = (resource: "issues" | "sessions", method = "GET") =>
  handlePublicRoute({
    request: new Request(
      `https://api.example.com/open/${resource}/${projectId}/${targetId}`,
      { method },
    ),
    env: {} as Env,
  });

describe("public app-link pages", () => {
  it("offers the shared issue in both the app and the web app", async () => {
    const response = await requestOpenPage("issues");
    const body = await response!.text();

    expect(body).toContain(
      `href="briar-companion://issues/${projectId}/${targetId}"`,
    );
    expect(body).toContain(
      `href="/app/open/issues/${projectId}/${targetId}"`,
    );
    expect(body).toContain("Briar 앱 열기");
    expect(body).toContain("웹에서 보기");
  });

  it("keeps the web option scoped to issue links", async () => {
    const response = await requestOpenPage("sessions");
    const body = await response!.text();

    expect(body).toContain("Briar 앱 열기");
    expect(body).not.toContain("웹에서 보기");
    expect(body).not.toContain("/app/open/issues/");
    expect(body).toContain("앱이 자동으로 열리지 않으면 아래 버튼을 눌러 주세요.");
    expect(body).not.toContain("아래에서 열 방법을 선택해 주세요.");
  });

  it("returns the same headers without a body for HEAD", async () => {
    const response = await requestOpenPage("issues", "HEAD");

    expect(await response!.text()).toBe("");
    expect(response!.headers.get("Content-Type")).toBe(
      "text/html; charset=utf-8",
    );
  });
});
