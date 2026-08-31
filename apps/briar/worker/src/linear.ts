/** Minimal Linear GraphQL client for one-time issue import. */

const LINEAR_API_URL = "https://api.linear.app/graphql";
const PAGE_SIZE = 50;
export const LINEAR_IMPORT_ISSUE_LIMIT = 2_000;

export type LinearViewer = {
  name: string;
  email: string | null;
  organizationName: string;
};

export type LinearTeam = {
  id: string;
  name: string;
  key: string;
};

export type LinearWorkflowState = {
  id: string;
  name: string;
  type: string;
  color: string;
  position: number;
  teamId: string;
  teamKey: string;
  teamName: string;
};

export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  priority: number;
  createdAt: string;
  state: {
    id: string;
    name: string;
    type: string;
  } | null;
  team: {
    id: string;
    key: string;
    name: string;
  } | null;
  parentId: string | null;
  relations: LinearIssueRelation[];
};

export type LinearIssueRelation = {
  sourceIssueId: string;
  targetIssueId: string;
  type: string;
};

type GraphQlError = { message?: string };
type GraphQlResponse<T> = {
  data?: T;
  errors?: GraphQlError[];
};

export class LinearApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LinearApiError";
  }
}

async function linearGraphql<T>(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (response.status === 401 || response.status === 403) {
    throw new LinearApiError("Linear API key is invalid or unauthorized", response.status);
  }
  if (!response.ok) {
    throw new LinearApiError(
      `Linear API request failed (${response.status})`,
      response.status,
    );
  }

  const payload = (await response.json()) as GraphQlResponse<T>;
  if (payload.errors?.length) {
    const message = payload.errors
      .map((error) => error.message)
      .filter(Boolean)
      .join("; ");
    throw new LinearApiError(message || "Linear GraphQL request failed");
  }
  if (!payload.data) {
    throw new LinearApiError("Linear GraphQL response was empty");
  }
  return payload.data;
}

export async function fetchLinearViewerAndTeams(apiKey: string): Promise<{
  viewer: LinearViewer;
  teams: LinearTeam[];
}> {
  type Page = {
    viewer: {
      name: string;
      displayName?: string | null;
      email?: string | null;
      organization: { name: string };
    };
    teams: {
      nodes: Array<{ id: string; name: string; key: string }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };

  const teams: LinearTeam[] = [];
  let after: string | null = null;
  let viewer: LinearViewer | null = null;

  for (;;) {
    const page: Page = await linearGraphql<Page>(
      apiKey,
      `query BriarLinearConnect($first: Int!, $after: String) {
        viewer {
          name
          displayName
          email
          organization { name }
        }
        teams(first: $first, after: $after) {
          nodes { id name key }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { first: PAGE_SIZE, after },
    );

    if (!viewer) {
      viewer = {
        name: page.viewer.displayName?.trim() || page.viewer.name,
        email: page.viewer.email ?? null,
        organizationName: page.viewer.organization.name,
      };
    }
    teams.push(
      ...page.teams.nodes.map((team: { id: string; name: string; key: string }) => ({
        id: team.id,
        name: team.name,
        key: team.key,
      })),
    );
    if (!page.teams.pageInfo.hasNextPage || !page.teams.pageInfo.endCursor) {
      break;
    }
    after = page.teams.pageInfo.endCursor;
  }

  return {
    viewer: viewer!,
    teams: teams.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function fetchLinearWorkflowStates(
  apiKey: string,
  teamIds: string[],
): Promise<LinearWorkflowState[]> {
  if (teamIds.length === 0) return [];

  type TeamNode = {
    id: string;
    name: string;
    key: string;
    states: {
      nodes: Array<{
        id: string;
        name: string;
        type: string;
        color: string;
        position: number;
      }>;
    };
  };

  const states: LinearWorkflowState[] = [];
  // Linear does not support bulk team-by-ids with nested states reliably;
  // fetch each team. Keep concurrency modest.
  const concurrency = 4;
  for (let index = 0; index < teamIds.length; index += concurrency) {
    const chunk = teamIds.slice(index, index + concurrency);
    const pages = await Promise.all(
      chunk.map((teamId) =>
        linearGraphql<{ team: TeamNode | null }>(
          apiKey,
          `query BriarLinearTeamStates($id: String!) {
            team(id: $id) {
              id
              name
              key
              states {
                nodes { id name type color position }
              }
            }
          }`,
          { id: teamId },
        ),
      ),
    );
    for (const page of pages) {
      const team = page.team;
      if (!team) continue;
      for (const state of team.states.nodes) {
        states.push({
          id: state.id,
          name: state.name,
          type: state.type,
          color: state.color,
          position: state.position,
          teamId: team.id,
          teamKey: team.key,
          teamName: team.name,
        });
      }
    }
  }

  return states.sort((a, b) => {
    const team = a.teamKey.localeCompare(b.teamKey);
    if (team !== 0) return team;
    return a.position - b.position;
  });
}

export async function fetchLinearIssuesForTeams(
  apiKey: string,
  teamIds: string[],
  limit = LINEAR_IMPORT_ISSUE_LIMIT,
): Promise<{ issues: LinearIssue[]; truncated: boolean }> {
  if (teamIds.length === 0) return { issues: [], truncated: false };

  type IssueNode = {
    id: string;
    identifier: string;
    title: string;
    description?: string | null;
    url: string;
    priority: number;
    createdAt: string;
    state?: { id: string; name: string; type: string } | null;
    team?: { id: string; key: string; name: string } | null;
    parent?: { id: string } | null;
  };
  type IssuesPage = {
    issues: {
      nodes: IssueNode[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };

  const issues: LinearIssue[] = [];
  let after: string | null = null;
  let truncated = false;

  for (;;) {
    const remaining = limit - issues.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const first = Math.min(PAGE_SIZE, remaining);
    const page: IssuesPage = await linearGraphql<IssuesPage>(
      apiKey,
      `query BriarLinearIssues(
        $first: Int!,
        $after: String,
        $filter: IssueFilter
      ) {
        issues(
          first: $first,
          after: $after,
          filter: $filter,
          orderBy: updatedAt
        ) {
          nodes {
            id
            identifier
            title
            description
            url
            priority
            createdAt
            state { id name type }
            team { id key name }
            parent { id }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      {
        first,
        after,
        filter: {
          team: { id: { in: teamIds } },
        },
      },
    );

    for (const node of page.issues.nodes) {
      issues.push({
        id: node.id,
        identifier: node.identifier,
        title: node.title,
        description: node.description ?? null,
        url: node.url,
        priority: node.priority,
        createdAt: node.createdAt,
        state: node.state
          ? {
              id: node.state.id,
              name: node.state.name,
              type: node.state.type,
            }
          : null,
        team: node.team
          ? {
              id: node.team.id,
              key: node.team.key,
              name: node.team.name,
            }
          : null,
        parentId: node.parent?.id ?? null,
        relations: [],
      });
    }

    if (!page.issues.pageInfo.hasNextPage || !page.issues.pageInfo.endCursor) {
      break;
    }
    if (issues.length >= limit) {
      truncated = true;
      break;
    }
    after = page.issues.pageInfo.endCursor;
  }

  const concurrency = 6;
  for (let index = 0; index < issues.length; index += concurrency) {
    const chunk = issues.slice(index, index + concurrency);
    const relationLists = await Promise.all(
      chunk.map((issue) => fetchLinearIssueRelations(apiKey, issue.id)),
    );
    relationLists.forEach((relations, offset) => {
      chunk[offset]!.relations = relations;
    });
  }

  return { issues, truncated };
}

async function fetchLinearIssueRelations(
  apiKey: string,
  issueId: string,
): Promise<LinearIssueRelation[]> {
  const relations: LinearIssueRelation[] = [];

  type RelationPage = {
    issue: {
      relations?: {
        nodes: Array<{ type: string; relatedIssue: { id: string } }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
      inverseRelations?: {
        nodes: Array<{ type: string; issue: { id: string } }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } | null;
  };

  const loadDirection = async (direction: "relations" | "inverseRelations") => {
    let after: string | null = null;
    for (;;) {
      const connection = direction === "relations"
        ? `relations(first: $first, after: $after) {
             nodes { type relatedIssue { id } }
             pageInfo { hasNextPage endCursor }
           }`
        : `inverseRelations(first: $first, after: $after) {
             nodes { type issue { id } }
             pageInfo { hasNextPage endCursor }
           }`;
      const page: RelationPage = await linearGraphql<RelationPage>(
        apiKey,
        `query BriarLinearIssueRelations(
          $id: String!, $first: Int!, $after: String
        ) {
          issue(id: $id) { ${connection} }
        }`,
        { id: issueId, first: PAGE_SIZE, after },
      );
      const issue = page.issue;
      if (!issue) break;
      if (direction === "relations") {
        const result = issue.relations!;
        relations.push(...result.nodes.map((relation) => ({
          sourceIssueId: issueId,
          targetIssueId: relation.relatedIssue.id,
          type: relation.type,
        })));
        if (!result.pageInfo.hasNextPage || !result.pageInfo.endCursor) break;
        after = result.pageInfo.endCursor;
      } else {
        const result = issue.inverseRelations!;
        relations.push(...result.nodes.map((relation) => ({
          sourceIssueId: relation.issue.id,
          targetIssueId: issueId,
          type: relation.type,
        })));
        if (!result.pageInfo.hasNextPage || !result.pageInfo.endCursor) break;
        after = result.pageInfo.endCursor;
      }
    }
  };

  await Promise.all([
    loadDirection("relations"),
    loadDirection("inverseRelations"),
  ]);
  return [
    ...new Map(
      relations.map((relation) => [
        `${relation.sourceIssueId}\0${relation.type}\0${relation.targetIssueId}`,
        relation,
      ]),
    ).values(),
  ];
}
