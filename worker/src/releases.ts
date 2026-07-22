const releasePath = /^\/releases\/(?:latest\.json|v\d+\.\d+\.\d+\/[A-Za-z0-9][A-Za-z0-9._-]{0,199})$/u;

function contentType(pathname: string) {
  if (pathname.endsWith(".json") || pathname.endsWith(".jsonl")) {
    return "application/json; charset=utf-8";
  }
  if (pathname.endsWith(".dmg")) return "application/x-apple-diskimage";
  if (pathname.endsWith(".tar.gz")) return "application/gzip";
  if (pathname.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
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
  if (!releasePath.test(pathname)) {
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
    pathname.endsWith("/latest.json")
      ? "public, max-age=60, must-revalidate"
      : "public, max-age=31536000, immutable",
  );
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}
