import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLinearIssuesForTeams } from "./linear";

describe("Linear issue relationship import", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("paginates issues and both relationship directions", async () => {
    const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      calls.push(body);

      if (body.query.includes("query BriarLinearIssues")) {
        const secondPage = body.variables.after === "issue-page-2";
        return Response.json({
          data: {
            issues: {
              nodes: [secondPage ? issueNode("linear-2", "LIN-2", null) : issueNode(
                "linear-1",
                "LIN-1",
                "linear-parent",
              )],
              pageInfo: secondPage
                ? { hasNextPage: false, endCursor: null }
                : { hasNextPage: true, endCursor: "issue-page-2" },
            },
          },
        });
      }

      const issueID = String(body.variables.id);
      const after = body.variables.after;
      if (body.query.includes("inverseRelations")) {
        return Response.json({ data: { issue: {
          inverseRelations: {
            nodes: issueID === "linear-2"
              ? [{ type: "blocks", issue: { id: "linear-3" } }]
              : [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        } } });
      }

      const firstRelationPage = issueID === "linear-1" && after == null;
      return Response.json({ data: { issue: {
        relations: {
          nodes: issueID === "linear-1"
            ? [{
                type: firstRelationPage ? "related" : "blocks",
                relatedIssue: { id: firstRelationPage ? "linear-2" : "linear-3" },
              }]
            : [],
          pageInfo: firstRelationPage
            ? { hasNextPage: true, endCursor: "relation-page-2" }
            : { hasNextPage: false, endCursor: null },
        },
      } } });
    }));

    const result = await fetchLinearIssuesForTeams("linear-key", ["team-1"]);

    expect(result.truncated).toBe(false);
    expect(result.issues.map((issue) => issue.id)).toEqual(["linear-1", "linear-2"]);
    expect(result.issues[0]?.parentId).toBe("linear-parent");
    expect(result.issues[0]?.relations).toEqual([
      { sourceIssueId: "linear-1", targetIssueId: "linear-2", type: "related" },
      { sourceIssueId: "linear-1", targetIssueId: "linear-3", type: "blocks" },
    ]);
    expect(result.issues[1]?.relations).toEqual([
      { sourceIssueId: "linear-3", targetIssueId: "linear-2", type: "blocks" },
    ]);
    expect(calls.some((call) => call.variables.after === "issue-page-2")).toBe(true);
    expect(calls.some((call) => call.variables.after === "relation-page-2")).toBe(true);
  });
});

function issueNode(id: string, identifier: string, parentID: string | null) {
  return {
    id,
    identifier,
    title: `Issue ${identifier}`,
    description: null,
    url: `https://linear.app/issue/${identifier}`,
    priority: 2,
    createdAt: "2026-09-01T00:00:00.000Z",
    state: { id: "state-1", name: "Todo", type: "unstarted" },
    team: { id: "team-1", key: "LIN", name: "Linear" },
    parent: parentID ? { id: parentID } : null,
  };
}
