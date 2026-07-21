import { z } from "zod";
import briarMarkSvg from "../../src/assets/briar-mark.svg";
import briarIconSvg from "../../src-tauri/app-icon.svg";
import {
  autoHuntQaEnvironments,
  autoHuntSources,
  autoHuntStages,
  progressForAutoHuntStage,
} from "../../src/lib/auto-hunt-contract";
import { createAuth, type BriarAuth } from "./auth";
import {
  assertQueuedHuntClaim,
  claimNextQueuedHuntRun,
  createProject,
  EventKeyConflictError,
  findProjectIdByAgentTokenHash,
  getNextQueuedHuntRun,
  getProject,
  getProjectSettings,
  getHuntRunForProject,
  HuntClaimError,
  HuntTransitionError,
  listDashboardRuns,
  listProjects,
  recordHuntEvent,
  recordQaResult,
  replaceProjectAgentToken,
  updateProjectSettings,
  type HuntEventRow,
  type HuntRunRow,
  type ProjectRow,
  type ProjectSettingsRow,
} from "./db";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-briar-claim-token",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
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

const stageSchema = z.enum(autoHuntStages);
const nullableTrimmed = (max: number) =>
  z.string().trim().min(1).max(max).nullable().optional();
const httpsUrl = z
  .string()
  .url()
  .max(1_000)
  .refine((value) => new URL(value).protocol === "https:", "HTTPS URL required");
const trackerSchema = z
  .object({
    provider: z.string().trim().min(1).max(50),
    issueId: nullableTrimmed(200),
    identifier: nullableTrimmed(100),
    url: httpsUrl.nullable().optional(),
    state: nullableTrimmed(100),
  })
  .strict();

const eventSchema = z
  .object({
    source: z.enum(autoHuntSources),
    sourceKey: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(300),
    stage: stageSchema,
    eventKey: z.string().trim().min(1).max(300),
    occurredAt: z.string().datetime({ offset: true }),
    actor: z.string().trim().min(1).max(128),
    repository: z.string().trim().min(1).max(500),
    detail: z.string().max(4_000).nullable().optional(),
    priority: z.number().int().min(1).max(4).nullable().optional(),
    branch: nullableTrimmed(500),
    commitSha: z.string().regex(/^[0-9a-f]{7,64}$/u).nullable().optional(),
    tracker: trackerSchema.nullable().optional(),
    issueDescription: z.string().max(100_000).nullable().optional(),
    resultSummary: z.string().max(100_000).nullable().optional(),
    pullRequestUrls: z
      .array(httpsUrl)
      .max(20)
      .default([])
      .transform((urls) => [...new Set(urls)].sort()),
    targetSha: z.string().regex(/^[0-9a-f]{7,64}$/u).nullable().optional(),
    sourceCreatedAt: z.string().datetime({ offset: true }).nullable().optional(),
    qaStatus: z.literal("pending").nullable().optional(),
    stagingQaDetail: z.string().max(100_000).nullable().optional(),
    productionQaDetail: z.string().max(100_000).nullable().optional(),
    context: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.stage === "blocked" && !input.detail?.trim()) {
      context.addIssue({
        code: "custom",
        message: "blocked progress requires an exact blocker reason",
        path: ["detail"],
      });
    }
    if (
      input.qaStatus &&
      input.stage !== "staging_qa" &&
      input.stage !== "production_qa"
    ) {
      context.addIssue({
        code: "custom",
        message: "QA status requires a QA stage",
        path: ["qaStatus"],
      });
    }
    if (
      (input.stage === "staging_qa" || input.stage === "production_qa") &&
      input.qaStatus !== "pending"
    ) {
      context.addIssue({
        code: "custom",
        message: "QA stages require a pending QA status",
        path: ["qaStatus"],
      });
    }
    if (input.tracker?.provider === "linear" && input.tracker.url) {
      if (new URL(input.tracker.url).hostname !== "linear.app") {
        context.addIssue({
          code: "custom",
          message: "Linear tracker URLs must use linear.app",
          path: ["tracker", "url"],
        });
      }
    }
  });

const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const issueInputSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(100_000).nullable().optional(),
    priority: z.number().int().min(1).max(4).nullable().optional(),
  })
  .strict();

const claimInputSchema = z
  .object({
    claimedBy: z.string().trim().min(1).max(128),
  })
  .strict();

const projectSettingsSchema = z
  .object({
    velenOrg: nullableTrimmed(100),
    dataSource: nullableTrimmed(300),
    linear: z
      .object({
        enabled: z.boolean(),
        source: z.string().trim().regex(/^linear:\/\/.+/u).max(300).nullable(),
        teamKey: z.string().trim().min(1).max(100).nullable(),
      })
      .strict(),
    githubRepository: nullableTrimmed(300),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.linear.enabled && (!input.velenOrg || !input.linear.source)) {
      context.addIssue({
        code: "custom",
        message: "Linear integration requires a Velen org and Linear source",
        path: ["linear"],
      });
    }
  });

const qaResultSchema = z
  .object({
    runId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u),
    environment: z.enum(autoHuntQaEnvironments),
    result: z.enum(["passed", "skipped"]),
    actor: z.string().trim().min(1).max(128),
    observedAt: z.string().datetime({ offset: true }),
    detail: z.string().max(100_000).nullable().optional(),
  })
  .strict();

async function readJson(request: Request, maxBytes = 262_144): Promise<unknown> {
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

async function requireAgentProject(db: D1Database, request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!token.startsWith("briar_agent_")) {
    throw new HttpError(401, "Invalid agent token");
  }
  const projectId = await findProjectIdByAgentTokenHash(db, await sha256(token));
  if (!projectId) throw new HttpError(401, "Invalid agent token");
  return projectId;
}

function projectJson(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  };
}

const settingsJson = (row: ProjectSettingsRow | null) => ({
  velenOrg: row?.velen_org ?? null,
  dataSource: row?.data_source ?? null,
  linear: {
    enabled: row?.linear_enabled === 1,
    source: row?.linear_source ?? null,
    teamKey: row?.linear_team_key ?? null,
  },
  githubRepository: row?.github_repository ?? null,
});

const parseJsonArray = (value: string) => {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
};

const parseJsonObject = (value: string | null) => {
  if (!value) return null;
  const parsed: unknown = JSON.parse(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed
    : null;
};

const dashboardEventJson = (event: HuntEventRow) => ({
  id: event.id,
  stage: event.stage,
  detail: event.detail,
  actor: event.actor,
  qaStatus: event.qa_status,
  trackerState: event.tracker_issue_state,
  pullRequestUrls: parseJsonArray(event.pull_request_urls),
  targetSha: event.target_sha,
  occurredAt: event.occurred_at,
  recordedAt: event.recorded_at,
});

function dashboardRunJson(run: HuntRunRow, events: HuntEventRow[]) {
  return {
    id: run.id,
    runNumber: run.run_number,
    source: run.source,
    sourceKey: run.source_key,
    title: run.title,
    stage: run.stage,
    progress: progressForAutoHuntStage[run.stage],
    detail: run.detail,
    priority: run.priority,
    repository: run.repository,
    branch: run.branch,
    commitSha: run.commit_sha,
    tracker: run.tracker_provider
      ? {
          provider: run.tracker_provider,
          issueId: run.tracker_issue_id,
          identifier: run.tracker_issue_identifier,
          url: run.tracker_issue_url,
          state: run.tracker_issue_state,
        }
      : null,
    issueDescription: run.issue_description,
    resultSummary: run.result_summary,
    pullRequestUrls: parseJsonArray(run.pull_request_urls),
    targetSha: run.target_sha,
    sourceCreatedAt: run.source_created_at,
    stagingQaStatus: run.staging_qa_status,
    productionQaStatus: run.production_qa_status,
    stagingQaDetail: run.staging_qa_detail,
    productionQaDetail: run.production_qa_detail,
    context: parseJsonObject(run.context_json),
    claimedBy: run.claimed_by,
    claimedAt: run.claimed_at,
    leaseExpiresAt: run.lease_expires_at,
    claimAttempts: run.claim_attempts,
    startedAt: run.started_at,
    updatedAt: run.last_event_at,
    completedAt: run.completed_at,
    eventCount: run.event_count,
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
    const project = await createProject(db, {
      ownerUserId: session.user.id,
      name: input.name,
      agentTokenHash: tokenHash,
    });
    return json({ project: projectJson(project), agentToken }, 201);
  }

  const settingsMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/settings$/u,
  );
  if (settingsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, settingsMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    return json({
      settings: settingsJson(await getProjectSettings(db, project.id)),
    });
  }
  if (settingsMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, settingsMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const input = projectSettingsSchema.parse(await readJson(request));
    const settings = await updateProjectSettings(db, project.id, {
      velenOrg: input.velenOrg ?? null,
      dataSource: input.dataSource ?? null,
      linear: input.linear,
      githubRepository: input.githubRepository ?? null,
    });
    return json({ settings: settingsJson(settings) });
  }

  const agentTokenMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-token$/u,
  );
  if (agentTokenMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const agentToken = `briar_agent_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const replaced = await replaceProjectAgentToken(
      db,
      agentTokenMatch[1],
      session.user.id,
      await sha256(agentToken),
    );
    if (!replaced) throw new HttpError(404, "Project not found");
    return json({ agentToken });
  }

  const dashboardMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/dashboard$/u,
  );
  if (dashboardMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, dashboardMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const [{ runs, events }, settings] = await Promise.all([
      listDashboardRuns(db, project.id),
      getProjectSettings(db, project.id),
    ]);
    const eventsByRun = new Map<string, HuntEventRow[]>();
    for (const event of events) {
      const runEvents = eventsByRun.get(event.run_id) ?? [];
      runEvents.push(event);
      eventsByRun.set(event.run_id, runEvents);
    }
    return json({
      project: projectJson(project),
      settings: settingsJson(settings),
      runs: runs.map((run) =>
        dashboardRunJson(run, eventsByRun.get(run.id) ?? []),
      ),
      generatedAt: new Date().toISOString(),
    });
  }

  const issuesMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/issues$/u,
  );
  if (issuesMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const project = await getProject(db, issuesMatch[1], session.user.id);
    if (!project) throw new HttpError(404, "Project not found");
    const [input, settings] = await Promise.all([
      readJson(request).then((body) => issueInputSchema.parse(body)),
      getProjectSettings(db, project.id),
    ]);
    const issueId = crypto.randomUUID();
    const sourceKey = `briar-issue:${issueId}`;
    const occurredAt = new Date().toISOString();
    const runId = await recordHuntEvent(db, project.id, {
      source: "issue",
      sourceKey,
      title: input.title,
      stage: "queued",
      eventKey: `${sourceKey}:queued:intake`,
      occurredAt,
      actor: "briar-app",
      repository: settings?.github_repository ?? project.name,
      detail: "Briar 앱에서 생성된 이슈가 Auto Hunt 처리를 기다리고 있습니다.",
      priority: input.priority ?? null,
      branch: null,
      commitSha: null,
      tracker: null,
      issueDescription: input.description || null,
      resultSummary: null,
      pullRequestUrls: [],
      targetSha: null,
      sourceCreatedAt: occurredAt,
      qaStatus: null,
      stagingQaDetail: null,
      productionQaDetail: null,
      context: { origin: "briar-app", issueId },
    });
    return json({ runId, sourceKey, stage: "queued" }, 201);
  }

  if (pathname === "/ingest/queue/next" && request.method === "GET") {
    const projectId = await requireAgentProject(db, request);
    const run = await getNextQueuedHuntRun(db, projectId);
    return json({
      issue: run
        ? {
            runId: run.id,
            runNumber: run.run_number,
            source: run.source,
            sourceKey: run.source_key,
            title: run.title,
            description: run.issue_description,
            priority: run.priority,
            repository: run.repository,
            sourceCreatedAt: run.source_created_at,
            context: parseJsonObject(run.context_json),
          }
        : null,
    });
  }

  if (pathname === "/ingest/queue/claim" && request.method === "POST") {
    const projectId = await requireAgentProject(db, request);
    const input = claimInputSchema.parse(await readJson(request));
    const claimedAt = new Date().toISOString();
    const leaseExpiresAt = new Date(
      Date.parse(claimedAt) + 15 * 60_000,
    ).toISOString();
    const claimToken = `briar_claim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const run = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: await sha256(claimToken),
      claimedBy: input.claimedBy,
      claimedAt,
      leaseExpiresAt,
    });
    return json({
      issue: run
        ? {
            runId: run.id,
            runNumber: run.run_number,
            source: run.source,
            sourceKey: run.source_key,
            title: run.title,
            description: run.issue_description,
            priority: run.priority,
            repository: run.repository,
            sourceCreatedAt: run.source_created_at,
            context: parseJsonObject(run.context_json),
            claimToken,
            claimedBy: run.claimed_by,
            claimedAt: run.claimed_at,
            leaseExpiresAt: run.lease_expires_at,
            claimAttempts: run.claim_attempts,
          }
        : null,
    });
  }

  if (pathname === "/ingest/events" && request.method === "POST") {
    const projectId = await requireAgentProject(db, request);
    const parsed = eventSchema.parse(await readJson(request));
    const input = {
      ...parsed,
      occurredAt: new Date(parsed.occurredAt).toISOString(),
      detail: parsed.detail ?? null,
      priority: parsed.priority ?? null,
      branch: parsed.branch ?? null,
      commitSha: parsed.commitSha ?? null,
      tracker: parsed.tracker
        ? {
            provider: parsed.tracker.provider,
            issueId: parsed.tracker.issueId ?? null,
            identifier: parsed.tracker.identifier ?? null,
            url: parsed.tracker.url ?? null,
            state: parsed.tracker.state ?? null,
          }
        : null,
      issueDescription: parsed.issueDescription ?? null,
      resultSummary: parsed.resultSummary ?? null,
      targetSha: parsed.targetSha ?? null,
      sourceCreatedAt: parsed.sourceCreatedAt
        ? new Date(parsed.sourceCreatedAt).toISOString()
        : null,
      qaStatus: parsed.qaStatus ?? null,
      stagingQaDetail: parsed.stagingQaDetail ?? null,
      productionQaDetail: parsed.productionQaDetail ?? null,
      context: parsed.context ?? null,
    };
    try {
      const claimToken = request.headers.get("x-briar-claim-token");
      await assertQueuedHuntClaim(
        db,
        projectId,
        input,
        claimToken?.startsWith("briar_claim_")
          ? await sha256(claimToken)
          : null,
        new Date().toISOString(),
      );
      const runId = await recordHuntEvent(db, projectId, input);
      return json({ runId, stage: input.stage });
    } catch (error) {
      if (error instanceof EventKeyConflictError) {
        throw new HttpError(409, error.message);
      }
      if (error instanceof HuntTransitionError) {
        throw new HttpError(409, error.message);
      }
      if (error instanceof HuntClaimError) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }
  }

  if (pathname === "/ingest/qa-results" && request.method === "POST") {
    const projectId = await requireAgentProject(db, request);
    const input = qaResultSchema.parse(await readJson(request));
    const outcome = await recordQaResult(db, projectId, {
      ...input,
      detail: input.detail ?? null,
      observedAt: new Date(input.observedAt).toISOString(),
    });
    if (outcome === "not_found") throw new HttpError(404, "Run not found");
    if (outcome === "ineligible") {
      throw new HttpError(409, "QA result is ineligible");
    }
    const run = await getHuntRunForProject(db, projectId, input.runId);
    return json({
      runId: input.runId,
      outcome,
      issueIdentifier: run?.tracker_issue_identifier ?? null,
      issueUrl: run?.tracker_issue_url ?? null,
      pullRequestUrls: run ? parseJsonArray(run.pull_request_urls) : [],
      targetSha: run?.target_sha ?? null,
    });
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
