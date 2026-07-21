import { z } from "zod";
import briarMarkSvg from "../../src/assets/briar-mark.svg";
import briarIconSvg from "../../src-tauri/app-icon.svg";
import { createAuth, type BriarAuth } from "./auth";
import {
  createProject,
  EventKeyConflictError,
  findProjectIdByAgentTokenHash,
  getProject,
  listDashboardRuns,
  listProjects,
  recordHuntEvent,
  type HuntEventRow,
  type HuntRunRow,
  type ProjectRow,
} from "./db";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: corsHeaders });

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const stageSchema = z.enum([
  "queued",
  "analyzing",
  "implementing",
  "pr_open",
  "staging_qa",
  "production_qa",
  "completed",
  "blocked",
  "failed",
  "cancelled",
]);

const eventSchema = z.object({
  source: z.enum(["issue", "error", "feedback"]),
  sourceKey: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  stage: stageSchema,
  eventKey: z.string().trim().min(1).max(300),
  occurredAt: z.string().datetime({ offset: true }),
  actor: z.string().trim().min(1).max(128),
  repository: z.string().trim().min(1).max(500),
  detail: z.string().max(4000).nullable().optional(),
  branch: z.string().trim().min(1).max(500).nullable().optional(),
  commitSha: z.string().regex(/^[0-9a-f]{7,64}$/u).nullable().optional(),
});

const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  repositoryPath: z.string().trim().min(1).max(1000),
});

async function readJson(request: Request, maxBytes = 16_384): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maxBytes) throw new HttpError(413, "Request body too large");
  if (!request.body) throw new HttpError(400, "Request body is required");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "Request body too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const svgResponse = (svg: string) =>
  new Response(svg, {
    headers: {
      "Cache-Control": "public, max-age=86400",
      "Content-Type": "image/svg+xml; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });

const devicePage = (apiOrigin: string) =>
  new Response(
    `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" type="image/svg+xml" href="/brand/briar-icon.svg"><title>Briar 로그인</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08090b;color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(390px,calc(100vw - 32px));padding:30px;border:1px solid #282a30;border-radius:14px;background:#111318;box-shadow:0 30px 100px #0008}.brand{display:flex;align-items:center;gap:10px;font-weight:750;font-size:20px}.brand img{width:26px;height:26px;display:block}.eyebrow{margin-top:32px;color:#8979cf;font:500 10px monospace;letter-spacing:1px}.code{margin:18px 0;padding:15px;border:1px solid #332e49;border-radius:8px;background:#171420;text-align:center;font:600 26px monospace;letter-spacing:4px}.copy{color:#838792;font-size:12px;line-height:1.6}.actions{display:grid;gap:8px;margin-top:22px}button{height:42px;border:1px solid #34363d;border-radius:8px;background:#f4f4f5;color:#18191d;font-weight:650;cursor:pointer}button.secondary{background:#191b20;color:#aaaeb8}.status{min-height:18px;margin-top:12px;color:#777b86;font-size:11px;text-align:center}</style></head>
<body><main class="card"><div class="brand"><img src="/brand/briar-mark.svg" alt="">briar</div><p class="eyebrow">DEVICE AUTHORIZATION</p><h1>데스크톱 연결 승인</h1><p class="copy">Google 계정으로 로그인한 뒤 Briar 데스크톱의 접근을 승인하세요.</p><div class="code" id="code">--------</div><div class="actions"><button id="google">Google로 로그인</button><button id="approve" hidden>이 기기 승인하기</button><button id="deny" class="secondary" hidden>거절</button></div><div class="status" id="status"></div></main>
<script>
const base=${JSON.stringify(apiOrigin)};const params=new URLSearchParams(location.search);const code=(params.get('user_code')||'').replace(/-/g,'').toUpperCase();document.querySelector('#code').textContent=code||'코드 없음';const status=document.querySelector('#status');const google=document.querySelector('#google');const approve=document.querySelector('#approve');const deny=document.querySelector('#deny');
async function api(path,options={}){const response=await fetch(base+'/api/auth'+path,{credentials:'include',headers:{'content-type':'application/json'},...options});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||data.error_description||'요청에 실패했습니다.');return data}
async function boot(){if(!code){status.textContent='유효한 기기 코드가 없습니다.';google.hidden=true;return}const session=await api('/get-session').catch(()=>null);if(!session?.user){status.textContent='먼저 Google 계정으로 로그인하세요.';return}google.hidden=true;await api('/device?user_code='+encodeURIComponent(code));approve.hidden=false;deny.hidden=false;status.textContent=session.user.email+' 계정으로 연결합니다.'}
google.onclick=async()=>{status.textContent='Google 로그인 페이지를 여는 중…';try{const data=await api('/sign-in/social',{method:'POST',body:JSON.stringify({provider:'google',callbackURL:base+'/device?user_code='+encodeURIComponent(code)})});location.href=data.url}catch(error){status.textContent=error.message}};
approve.onclick=async()=>{try{await api('/device/approve',{method:'POST',body:JSON.stringify({userCode:code})});approve.hidden=true;deny.hidden=true;status.textContent='승인되었습니다. Briar 앱으로 돌아가세요.'}catch(error){status.textContent=error.message}};
deny.onclick=async()=>{try{await api('/device/deny',{method:'POST',body:JSON.stringify({userCode:code})});status.textContent='요청을 거절했습니다.'}catch(error){status.textContent=error.message}};void boot();
</script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      },
    },
  );

async function requireSession(auth: BriarAuth, request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) throw new HttpError(401, "Unauthorized");
  return session;
}

function projectJson(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    repositoryPath: row.repository_path,
    createdAt: row.created_at,
  };
}

const progressForStage = (stage: string) => {
  switch (stage) {
    case "queued":
      return 10;
    case "analyzing":
      return 25;
    case "implementing":
      return 45;
    case "pr_open":
      return 65;
    case "staging_qa":
      return 80;
    case "production_qa":
      return 92;
    case "completed":
      return 100;
    case "blocked":
    case "failed":
      return 50;
    case "cancelled":
      return 0;
    default:
      return 0;
  }
};

const dashboardEventJson = (event: HuntEventRow) => ({
  id: event.id,
  stage: event.stage,
  detail: event.detail,
  actor: event.actor,
  occurredAt: event.occurred_at,
});

function dashboardRunJson(run: HuntRunRow, events: HuntEventRow[]) {
  return {
    id: run.id,
    runNumber: run.run_number,
    source: run.source,
    sourceKey: run.source_key,
    title: run.title,
    stage: run.stage,
    progress: progressForStage(run.stage),
    detail: run.detail,
    repository: run.repository,
    branch: run.branch,
    commitSha: run.commit_sha,
    startedAt: run.started_at,
    updatedAt: run.last_event_at,
    completedAt: run.completed_at,
    events: events.map(dashboardEventJson),
  };
}

async function route(
  request: Request,
  auth: BriarAuth,
  db: D1Database,
): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname.startsWith("/api/auth/")) {
    const response = await auth.handler(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(corsHeaders)) {
      headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
  }

  if (pathname === "/me" && request.method === "GET") {
    const session = await requireSession(auth, request);
    return json({ user: session.user });
  }

  if (pathname === "/projects" && request.method === "GET") {
    const session = await requireSession(auth, request);
    const projects = await listProjects(db, session.user.id);
    return json({ projects: projects.map(projectJson) });
  }

  if (pathname === "/projects" && request.method === "POST") {
    const session = await requireSession(auth, request);
    const input = projectInputSchema.parse(await readJson(request));
    const agentToken = `briar_agent_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const tokenHash = await sha256(agentToken);
    try {
      const project = await createProject(db, {
        ownerUserId: session.user.id,
        name: input.name,
        repositoryPath: input.repositoryPath,
        agentTokenHash: tokenHash,
      });
      return json({ project: projectJson(project), agentToken }, 201);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("UNIQUE constraint failed")
      ) {
        throw new HttpError(409, "Repository is already connected");
      }
      throw error;
    }
  }

  const dashboardMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/dashboard$/u,
  );
  if (dashboardMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, dashboardMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const { runs, events } = await listDashboardRuns(db, project.id);
    const eventsByRun = new Map<string, HuntEventRow[]>();
    for (const event of events) {
      const runEvents = eventsByRun.get(event.run_id) ?? [];
      runEvents.push(event);
      eventsByRun.set(event.run_id, runEvents);
    }
    return json({
      project: projectJson(project),
      runs: runs.map((run) =>
        dashboardRunJson(run, eventsByRun.get(run.id) ?? []),
      ),
      generatedAt: new Date().toISOString(),
    });
  }

  if (pathname === "/ingest/events" && request.method === "POST") {
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    if (!token.startsWith("briar_agent_")) {
      throw new HttpError(401, "Invalid agent token");
    }
    const tokenHash = await sha256(token);
    const projectId = await findProjectIdByAgentTokenHash(db, tokenHash);
    if (!projectId) throw new HttpError(401, "Invalid agent token");
    const parsed = eventSchema.parse(await readJson(request));
    const input = {
      ...parsed,
      occurredAt: new Date(parsed.occurredAt).toISOString(),
      detail: parsed.detail ?? null,
      branch: parsed.branch ?? null,
      commitSha: parsed.commitSha ?? null,
    };
    try {
      const runId = await recordHuntEvent(db, projectId, input);
      return json({ runId, stage: input.stage });
    } catch (error) {
      if (error instanceof EventKeyConflictError) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }
  }

  throw new HttpError(404, "Not found");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    if (url.pathname === "/health") {
      return json({ ok: true, service: "briar-api", database: "cloudflare-d1" });
    }
    if (url.pathname === "/brand/briar-icon.svg" && request.method === "GET") {
      return svgResponse(briarIconSvg);
    }
    if (url.pathname === "/brand/briar-mark.svg" && request.method === "GET") {
      return svgResponse(briarMarkSvg);
    }
    if (url.pathname === "/device" && request.method === "GET") {
      return devicePage(url.origin);
    }

    try {
      const auth = createAuth(env, url.origin);
      return await route(request, auth, env.DB);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ message: error.message }, error.status);
      }
      if (error instanceof z.ZodError) {
        return json({ message: "Invalid request", issues: error.issues }, 400);
      }
      console.error(
        JSON.stringify({
          message: "request failed",
          error: error instanceof Error ? error.message : String(error),
          method: request.method,
          path: url.pathname,
        }),
      );
      return json({ message: "Internal server error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
