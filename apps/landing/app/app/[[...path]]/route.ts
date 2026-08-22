const BRIAR_WEB_ORIGIN = "https://briar-api.wbai.workers.dev";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

async function proxyBriarWebApp(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const { path = [] } = await context.params;
  const upstreamUrl = new URL(`/${path.join("/")}`, BRIAR_WEB_ORIGIN);
  upstreamUrl.search = requestUrl.search;
  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers: {
      accept: request.headers.get("accept") ?? "*/*",
      "accept-encoding": request.headers.get("accept-encoding") ?? "identity",
    },
  });
  const headers = new Headers(upstream.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.delete("set-cookie");
  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export const GET = proxyBriarWebApp;
export const HEAD = proxyBriarWebApp;
