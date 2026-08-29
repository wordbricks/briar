import briarIconPng from "../../src/assets/brand/briar-logo-dark.png";
import {
  htmlArtifactPreviewMaxBytes,
  htmlArtifactPreviewMessageType,
  htmlArtifactPreviewPath,
  htmlArtifactPreviewProtocolVersion,
} from "../../src/lib/html-artifact-preview-contract";
import { htmlArtifactContentSecurityPolicy } from "../../src/lib/agent-reply-attachments";
import { devicePage as otpDevicePage } from "./auth-device";
import { json } from "./http-response";
import { decodeMobileHealthResponse } from "./mobile-contract";
import { serveRelease } from "./releases";

const pngResponse = (png: ArrayBuffer) =>
  new Response(png, {
    headers: {
      "Cache-Control": "public, max-age=86400",
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
    },
  });

const appleAppSiteAssociation = (head: boolean) =>
  new Response(
    head
      ? null
      : JSON.stringify({
          applinks: {
            details: [{
              appIDs: ["QFJZ2V3829.app.briar.companion"],
              components: [
                {
                  "/": "/open/issues/*",
                  comment: "Opens a Briar issue in the iOS Companion app",
                },
                {
                  "/": "/open/sessions/*",
                  comment: "Opens a Briar session in the iOS Companion app",
                },
                {
                  "/": "/open/channels/*",
                  comment:
                    "Opens a Briar channel message in the iOS Companion app",
                },
              ],
            }],
          },
        }),
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Content-Type": "application/json",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );

export const htmlArtifactPreviewDocument = `<!doctype html>
<html><head><meta charset="utf-8"><title>HTML artifact preview</title></head><body>
<script>(()=>{"use strict";
const host=window.parent;
const version=${htmlArtifactPreviewProtocolVersion};
const maxBytes=${htmlArtifactPreviewMaxBytes};
const types=${JSON.stringify(htmlArtifactPreviewMessageType)};
const send=(type)=>host.postMessage({type,version},"*");
let accepted=false;
const receive=(event)=>{
  if(accepted||event.source!==host||!event.data||typeof event.data!=="object")return;
  if(event.data.version!==version)return;
  if(event.data.type===types.probe){send(types.ready);return;}
  if(event.data.type!==types.render)return;
  accepted=true;
  window.removeEventListener("message",receive);
  const html=event.data.html;
  if(typeof html!=="string"||new TextEncoder().encode(html).byteLength>maxBytes){send(types.error);return;}
  try{
    document.open();
    document.write(html);
    document.close();
    send(types.rendered);
  }catch{send(types.error);}
};
window.addEventListener("message",receive);
Object.defineProperty(globalThis,"__BRIAR_HTML_ARTIFACT_PREVIEW_READY__",{value:true});
send(types.ready);
})();</script></body></html>`;

const htmlArtifactPreviewResponse = (head: boolean) =>
  new Response(head ? null : htmlArtifactPreviewDocument, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Security-Policy":
        `sandbox allow-scripts; ${htmlArtifactContentSecurityPolicy}`,
      "Content-Type": "text/html; charset=utf-8",
      "Permissions-Policy":
        "accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });

const appLinkPage = (
  resource: "issues" | "sessions" | "channels",
  projectId: string,
  targetId: string,
  head: boolean,
  extraPath = "",
  search = "",
) => {
  const appUrl =
    `briar-companion://${resource}/${projectId}/${targetId}${extraPath}${search}`;
  const subject = resource === "issues"
    ? "이슈"
    : resource === "sessions"
      ? "세션"
      : extraPath
        ? "메시지"
        : "채널";
  const subjectWithParticle = resource === "issues"
    ? "이슈를"
    : resource === "sessions"
      ? "세션을"
      : extraPath
        ? "메시지를"
        : "채널을";
  const englishSubject = resource === "issues"
    ? "issue"
    : resource === "sessions"
      ? "session"
      : extraPath
        ? "message"
        : "channel";
  const body = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" type="image/png" href="/brand/briar-icon.png"><title>Briar에서 ${subject} 열기</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0a0d;color:#f4f1f8;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(390px,calc(100vw - 32px));padding:32px;border:1px solid #302b38;border-radius:18px;background:#151219;box-shadow:0 30px 100px #0009;text-align:center}.brand{display:flex;align-items:center;justify-content:center;gap:10px;font-size:21px;font-weight:750}.brand img{width:30px;height:30px;border-radius:7px}h1{margin:30px 0 10px;font-size:22px}.copy{margin:0;color:#aaa3b2;font-size:13px;line-height:1.65}.open{height:44px;margin-top:24px;padding:0 18px;display:inline-flex;align-items:center;justify-content:center;border-radius:10px;color:#19151f;background:#eee9f7;font-size:14px;font-weight:700;text-decoration:none}.hint{min-height:18px;margin:14px 0 0;color:#777080;font-size:11px}</style></head>
<body><main class="card"><div class="brand"><img src="/brand/briar-icon.png" alt="">briar</div><h1>Briar에서 ${subjectWithParticle} 여는 중입니다</h1><p class="copy">앱이 자동으로 열리지 않으면 아래 버튼을 눌러 주세요.<br>The ${englishSubject} will open in the Briar app.</p><a class="open" href="${appUrl}">Briar 앱 열기</a><p class="hint" id="hint"></p></main>
<script>const appUrl=${JSON.stringify(appUrl)};window.location.replace(appUrl);window.setTimeout(()=>{document.querySelector('#hint').textContent='Briar 앱이 설치되어 있어야 합니다.'},1200)</script></body></html>`;
  return new Response(head ? null : body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Security-Policy":
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
};

export async function handlePublicRoute(input: {
  request: Request;
  env: Env;
}): Promise<Response | undefined> {
  const { request, env } = input;
  const url = new URL(request.url);

  if (
    url.pathname === htmlArtifactPreviewPath &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    return htmlArtifactPreviewResponse(request.method === "HEAD");
  }

  if (
    (request.method === "GET" || request.method === "HEAD") &&
    (url.pathname === "/app" || url.pathname.startsWith("/app/"))
  ) {
    const assetUrl = new URL(request.url);
    assetUrl.pathname = url.pathname.slice("/app".length) || "/";
    return env.ASSETS.fetch(new Request(assetUrl, request));
  }

  if (url.pathname === "/health") {
    return json(decodeMobileHealthResponse({
      ok: true,
      service: "briar-api",
      database: "cloudflare-d1",
      updates: "cloudflare-r2",
    }));
  }

  if (
    url.pathname === "/.well-known/apple-app-site-association" &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    return appleAppSiteAssociation(request.method === "HEAD");
  }

  const issueLinkMatch = url.pathname.match(
    /^\/open\/issues\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/?$/iu,
  );
  if (
    issueLinkMatch &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    return appLinkPage(
      "issues",
      issueLinkMatch[1],
      issueLinkMatch[2],
      request.method === "HEAD",
    );
  }

  const sessionLinkMatch = url.pathname.match(
    /^\/open\/sessions\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/?$/iu,
  );
  if (
    sessionLinkMatch &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    return appLinkPage(
      "sessions",
      sessionLinkMatch[1],
      sessionLinkMatch[2],
      request.method === "HEAD",
    );
  }

  const channelLinkMatch = url.pathname.match(
    /^\/open\/channels\/([0-9a-f-]{36})\/([0-9a-f-]{36})(?:\/([0-9a-f-]{36}))?\/?$/iu,
  );
  if (
    channelLinkMatch &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    const root = url.searchParams.get("root")?.trim();
    const search = channelLinkMatch[3] && root && root !== channelLinkMatch[3]
      ? `?root=${encodeURIComponent(root)}`
      : "";
    return appLinkPage(
      "channels",
      channelLinkMatch[1],
      channelLinkMatch[2],
      request.method === "HEAD",
      channelLinkMatch[3] ? `/${channelLinkMatch[3]}` : "",
      search,
    );
  }

  const releaseResponse = await serveRelease(request, env.RELEASES);
  if (releaseResponse) return releaseResponse;

  if (url.pathname === "/brand/briar-icon.png" && request.method === "GET") {
    return pngResponse(briarIconPng);
  }

  if (url.pathname === "/device" && request.method === "GET") {
    const client = url.searchParams.get("client");
    const deviceClient = client === "mobile" || client === "android"
      ? "mobile"
      : client === "web"
        ? "web"
        : "desktop";
    return otpDevicePage(url.origin, deviceClient);
  }

  return undefined;
}
