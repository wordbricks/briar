import * as Schema from "effect/Schema";
import type { BriarAuth } from "./auth";
import { projectGithubGraphql } from "./github-app-api";
import { HttpError, privateNoStoreJson } from "./http-response";
import {
  githubAppApiOperation,
  projectGithubIdentity,
  requireProjectGithubAccess,
} from "./project-github-application";
import { readJson } from "./request-readers";
import { decodeRequestSync } from "./request-schema";
import { strictSchema } from "./schema-codecs";

const GraphqlRequest = strictSchema(Schema.Struct({
  query: Schema.String.check(Schema.isLengthBetween(1, 50_000)),
  variables: Schema.Record(
    Schema.String,
    Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]),
  ),
}));

const decodeGraphqlRequest = decodeRequestSync(GraphqlRequest);

export async function handleProjectGithubRoute(input: {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  env: Env;
}): Promise<Response | undefined> {
  const { request, url, auth, db, env } = input;
  const match = url.pathname.match(
    /^\/projects\/([0-9a-f-]+)\/github\/graphql$/u,
  );
  if (!match) return undefined;
  const project = await requireProjectGithubAccess({
    auth,
    db,
    request,
    projectId: match[1],
  });
  const identity = await projectGithubIdentity(db, project);
  if (request.method !== "POST") {
    throw new HttpError(405, "Method not allowed");
  }
  return privateNoStoreJson(await githubAppApiOperation(async () =>
    projectGithubGraphql(
      env,
      identity,
      decodeGraphqlRequest(await readJson(request)),
    )
  ));
}
