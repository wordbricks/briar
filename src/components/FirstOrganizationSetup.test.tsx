/** @vitest-environment jsdom */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FirstOrganizationSetup } from "./FirstOrganizationSetup";

describe("FirstOrganizationSetup", () => {
  it("shows organization creation before any purpose choice", () => {
    const markup = renderToStaticMarkup(
      <FirstOrganizationSetup
        onCheckHandle={async () => true}
        onCreate={async () => undefined}
        onLogout={() => undefined}
        user={{
          id: "user-1",
          name: "New User",
          email: "new@example.com",
        }}
      />,
    );

    expect(markup).toContain("조직 만들기");
    expect(markup).toContain("조직 이름");
    expect(markup).not.toContain("Briar를 어떻게 사용하고 싶으세요?");
  });
});
