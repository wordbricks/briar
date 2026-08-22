const versionedReleasePath =
  /^\/releases\/v\d+\.\d+\.\d+\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const latestManifestPath = "/releases/latest.json";
const latestMacDmgPath = "/releases/latest/mac-aarch64.dmg";
const versionPattern = /^\d+\.\d+\.\d+$/u;

function contentType(pathname: string) {
  if (pathname.endsWith(".json") || pathname.endsWith(".jsonl")) {
    return "application/json; charset=utf-8";
  }
  if (pathname.endsWith(".dmg")) return "application/x-apple-diskimage";
  if (pathname.endsWith(".tar.gz")) return "application/gzip";
  if (pathname.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}

export async function readLatestVersion(
  bucket: Pick<R2Bucket, "get">,
): Promise<string | null> {
  const object = await bucket.get("releases/latest.json");
  if (!object) return null;
  try {
    const latest = JSON.parse(await new Response(object.body).text()) as {
      version?: unknown;
    };
    return typeof latest.version === "string" && versionPattern.test(latest.version)
      ? latest.version
      : null;
  } catch {
    return null;
  }
}

async function redirectToLatestMacDmg(
  request: Request,
  bucket: Pick<R2Bucket, "get">,
): Promise<Response> {
  const version = await readLatestVersion(bucket);
  if (!version) {
    return Response.json({ message: "Release not found" }, { status: 404 });
  }
  const targetPath = `/releases/v${version}/Briar_${version}_aarch64.dmg`;
  const object = await bucket.get(targetPath.slice(1));
  if (!object) {
    return Response.json({ message: "Release not found" }, { status: 404 });
  }
  const location = new URL(targetPath, request.url).toString();
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "public, max-age=60, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function serveRelease(
  request: Request,
  bucket: Pick<R2Bucket, "get">,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/releases/")) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Response.json(
      { message: "Method not allowed" },
      { status: 405, headers: { Allow: "GET, HEAD" } },
    );
  }
  if (pathname === latestMacDmgPath) {
    return redirectToLatestMacDmg(request, bucket);
  }
  if (pathname !== latestManifestPath && !versionedReleasePath.test(pathname)) {
    return Response.json({ message: "Release not found" }, { status: 404 });
  }
  const object = await bucket.get(pathname.slice(1));
  if (!object) {
    return Response.json({ message: "Release not found" }, { status: 404 });
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", headers.get("Content-Type") ?? contentType(pathname));
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set(
    "Cache-Control",
    pathname === latestManifestPath
      ? "public, max-age=60, must-revalidate"
      : "public, max-age=31536000, immutable",
  );
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}
