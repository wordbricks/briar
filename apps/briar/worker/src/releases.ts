import * as Schema from "effect/Schema";

import {
  compareStableVersions,
  parseReleasePromotionPayload,
  verifyReleasePromotion,
} from "../../src/lib/release-promotion";

const versionedReleasePath =
  /^\/releases\/v\d+\.\d+\.\d+\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const latestManifestPath = "/releases/latest.json";
const latestMacDmgPath = "/releases/latest/mac-aarch64.dmg";
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const promotionPath = "/releases/promote";
const promotionAuthorization = /^Briar-HMAC ([0-9a-f]{64})$/u;

type ReleaseBucket = Pick<R2Bucket, "get"> & Partial<Pick<R2Bucket, "put">>;

const CandidateManifest = Schema.Struct({
  channel: Schema.Literal("stable"),
  commitSha: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/u)),
  product: Schema.Literal("Briar"),
  schemaVersion: Schema.Literal(1),
  version: Schema.String.check(Schema.isPattern(versionPattern)),
});
const decodeCandidateManifest = Schema.decodeUnknownSync(CandidateManifest);

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

async function objectText(
  bucket: Pick<R2Bucket, "get">,
  key: string,
) {
  const object = await bucket.get(key);
  if (!object) return null;
  return { object, text: await new Response(object.body).text() };
}

async function promoteRelease(
  request: Request,
  bucket: ReleaseBucket,
  secret: string,
) {
  if (!bucket.put || !secret) {
    return Response.json(
      { message: "Release promotion is not configured" },
      { status: 503 },
    );
  }
  const payload = await request.text();
  if (new TextEncoder().encode(payload).byteLength > 1_024) {
    return Response.json({ message: "Invalid promotion payload" }, { status: 400 });
  }
  const signature = promotionAuthorization.exec(
    request.headers.get("Authorization") ?? "",
  )?.[1];
  if (!signature || !await verifyReleasePromotion(secret, payload, signature)) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  let promotion;
  try {
    promotion = parseReleasePromotionPayload(payload);
  } catch {
    return Response.json({ message: "Invalid promotion payload" }, { status: 400 });
  }
  const prefix = `releases/v${promotion.version}`;
  const [candidate, manifestObject] = await Promise.all([
    objectText(bucket, `${prefix}/latest.json`),
    objectText(bucket, `${prefix}/release-manifest.json`),
  ]);
  if (!candidate || !manifestObject) {
    return Response.json({ message: "Verified release artifacts are missing" }, { status: 404 });
  }

  try {
    const latest = JSON.parse(candidate.text) as { version?: unknown };
    const manifest = decodeCandidateManifest(JSON.parse(manifestObject.text));
    if (
      latest.version !== promotion.version ||
      manifest.version !== promotion.version ||
      manifest.commitSha !== promotion.commitSha
    ) {
      return Response.json(
        { message: "Release artifacts do not match the promotion request" },
        { status: 409 },
      );
    }
  } catch {
    return Response.json({ message: "Release artifacts are invalid" }, { status: 409 });
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await objectText(bucket, "releases/latest.json");
    let currentVersion: string | null = null;
    if (current) {
      try {
        const value = JSON.parse(current.text) as { version?: unknown };
        if (typeof value.version !== "string" || !versionPattern.test(value.version)) {
          throw new Error("invalid current version");
        }
        currentVersion = value.version;
      } catch {
        return Response.json(
          { message: "Current release metadata is invalid; refusing to overwrite it" },
          { status: 409 },
        );
      }
    }
    if (currentVersion) {
      const order = compareStableVersions(promotion.version, currentVersion);
      if (order < 0) {
        return Response.json(
          { currentVersion, message: "Release promotion would move latest backwards" },
          { status: 409 },
        );
      }
      if (order === 0) {
        if (current.text !== candidate.text) {
          return Response.json(
            { message: "The promoted version already points at different metadata" },
            { status: 409 },
          );
        }
        return Response.json({ currentVersion, promoted: false });
      }
    }

    const written = await bucket.put("releases/latest.json", candidate.text, {
      onlyIf: current
        ? { etagMatches: current.object.etag }
        : { etagDoesNotMatch: "*" },
      httpMetadata: {
        cacheControl: "public, max-age=60, must-revalidate",
        contentType: "application/json; charset=utf-8",
      },
      customMetadata: {
        commitSha: promotion.commitSha,
        version: promotion.version,
      },
    });
    if (written) {
      return Response.json({ currentVersion: promotion.version, promoted: true });
    }
  }
  return Response.json(
    { message: "Release promotion conflicted too many times; retry it" },
    { status: 503 },
  );
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
  bucket: ReleaseBucket,
  promotionSecret = "",
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/releases/")) return null;
  if (pathname === promotionPath) {
    if (request.method !== "POST") {
      return Response.json(
        { message: "Method not allowed" },
        { status: 405, headers: { Allow: "POST" } },
      );
    }
    return promoteRelease(request, bucket, promotionSecret);
  }
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
