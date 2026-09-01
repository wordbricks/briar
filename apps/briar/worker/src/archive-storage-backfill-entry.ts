import { backfillProjectAgentSessionArchives } from "./archive-storage-backfill";

interface BackfillEnv {
  ARCHIVES: R2Bucket;
  BRIAR_ARCHIVE_BACKFILL_TOKEN: string;
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: BackfillEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response("ok");
    }
    if (
      request.method !== "POST" ||
      url.pathname !== "/backfill" ||
      request.headers.get("authorization") !==
        `Bearer ${env.BRIAR_ARCHIVE_BACKFILL_TOKEN}`
    ) {
      return new Response("Not found", { status: 404 });
    }

    const result = await backfillProjectAgentSessionArchives(
      env.DB,
      env.ARCHIVES,
    );
    return Response.json(result);
  },
};
