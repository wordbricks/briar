import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "./index";
import { applyD1Migrations } from "./test-helpers/d1";

const organizationId = "a1000000-0000-4000-8000-000000000120";
const projectId = "a2000000-0000-4000-8000-000000000120";
const ownerId = "svg-attachment-owner";
const sessionToken = "svg-attachment-session-token";
const initialAt = "2026-08-20T11:16:44.987Z";
const svgBody =
  '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" /></svg>';

describe("SVG issue attachment lifecycle", () => {
  let miniflare: Miniflare;
  let db: D1Database;
  let attachments: R2Bucket;

  beforeAll(async () => {
    miniflare = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "briar-svg-issue-attachment-test" },
      r2Buckets: ["ATTACHMENTS"],
    });
    db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
    attachments = (await miniflare.getR2Bucket(
      "ATTACHMENTS",
    )) as unknown as R2Bucket;
    await applyD1Migrations(db, {
      through: "0119_execution_worker_update_handoffs.sql",
    });
    await applyD1Migrations(db, {
      files: ["0136_issue_difficulty.sql", "0140_issue_difficulty_optional.sql"],
    });
    await db.batch([
      db
        .prepare(
          `insert into "user" (
             id, name, email, emailVerified, createdAt, updatedAt
           ) values (?, 'SVG Owner', 'svg-owner@example.com', 1, ?, ?)`,
        )
        .bind(ownerId, initialAt, initialAt),
      db
        .prepare(
          `insert into "session" (
             id, expiresAt, token, createdAt, updatedAt, userId
           ) values ('svg-attachment-session', '2099-01-01T00:00:00.000Z',
                     ?, ?, ?, ?)`,
        )
        .bind(sessionToken, initialAt, initialAt, ownerId),
      db
        .prepare(
          `insert into briar_organizations (
             id, name, handle, created_at, updated_at
           ) values (?, 'SVG Attachments', 'svg-attachments', ?, ?)`,
        )
        .bind(organizationId, initialAt, initialAt),
    ]);
    await db.batch([
      db
        .prepare(
          `insert into briar_organization_members (
             organization_id, user_id, role, created_at, updated_at
           ) values (?, ?, 'owner', ?, ?)`,
        )
        .bind(organizationId, ownerId, initialAt, initialAt),
      db
        .prepare(
          `insert into briar_projects (
             id, owner_user_id, organization_id, name, agent_token_hash,
             created_at, updated_at
           ) values (?, ?, ?, 'SVG Attachments', ?, ?, ?)`,
        )
        .bind(
          projectId,
          ownerId,
          organizationId,
          "a".repeat(64),
          initialAt,
          initialAt,
        ),
    ]);
    await db
      .prepare(
        `insert into briar_project_settings (
           project_id, workflow_json, mandatory_checkpoints_json,
           created_at, updated_at
         ) values (?, ?, '[]', ?, ?)`,
      )
      .bind(
        projectId,
        JSON.stringify({
          version: 2,
          requirements: [],
          stages: [{ id: "implementing", label: "Implement", required: true }],
          execution: { checkpoints: [] },
          completion: { requiredStages: ["implementing"] },
        }),
        initialAt,
        initialAt,
      )
      .run();
  }, 60_000);

  afterAll(async () => {
    await miniflare.dispose();
  });

  const env = () =>
    ({
      DB: db,
      ATTACHMENTS: attachments,
      ARCHIVES: attachments,
      BETTER_AUTH_SECRET: "briar-test-secret-that-is-at-least-32-characters",
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "google-secret",
    }) as never;

  const issueRequest = (title: string, file: File) => {
    const reference = crypto.randomUUID();
    const form = new FormData();
    form.set("title", title);
    form.set(
      "description",
      `SVG regression\n\n![${file.name}](briar-attachment://${reference})`,
    );
    form.set("priority", "2");
    form.set("status", "queued");
    form.set("attachmentReferences", JSON.stringify([reference]));
    form.append("attachments", file, file.name);
    return new Request(`https://briar.example/projects/${projectId}/issues`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-length": "8192",
      },
      body: form,
    });
  };

  it(
    "captures the legacy D1 exception, then creates and downloads the same SVG after migration",
    async () => {
      const legacyPngResponse = await worker.fetch(
        issueRequest(
          "Legacy PNG preserved",
          new File(["png"], "legacy.png", { type: "image/png" }),
        ),
        env(),
      );
      expect(legacyPngResponse.status).toBe(201);
      const legacyPng = await legacyPngResponse.json<{
        difficulty: string | null;
        attachments: Array<{ url: string; contentType: string }>;
      }>();
      expect(legacyPng.difficulty).toBeNull();

      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
      const legacyResponse = await worker.fetch(
        issueRequest(
          "Legacy SVG constraint reproduction",
          new File([svgBody], "diagram.svg", { type: "image/svg+xml" }),
        ),
        env(),
      );

      expect(legacyResponse.status).toBe(500);
      expect(
        errorLog.mock.calls
          .map(([value]) => {
            try {
              return JSON.parse(String(value)) as Record<string, unknown>;
            } catch {
              return null;
            }
          })
          .find((entry) => entry?.message === "issue creation failed"),
      ).toMatchObject({
        phase: "store_attachment_metadata",
        attachmentCount: 1,
        uploadedAttachmentCount: 1,
        attachmentContentTypes: ["image/svg+xml"],
        error: expect.stringMatching(/CHECK constraint failed.*content_type/iu),
      });
      expect(
        await db
          .prepare(
            `select count(*) as count from briar_hunt_runs
           where title = 'Legacy SVG constraint reproduction'`,
          )
          .first("count"),
      ).toBe(0);
      expect((await attachments.list()).objects).toHaveLength(1);
      errorLog.mockRestore();

      await applyD1Migrations(db, { files: ["0120_svg_attachments.sql"] });
      const attachmentSchemas = await db
        .prepare(
          `select name, sql from sqlite_master
         where type = 'table' and name in (
           'briar_issue_attachments',
           'briar_channel_message_attachments',
           'briar_run_evidence_images'
         )`,
        )
        .all<{ name: string; sql: string }>();
      expect(attachmentSchemas.results).toHaveLength(3);
      expect(
        attachmentSchemas.results.every((table) =>
          table.sql.includes("'image/svg+xml'")
        ),
      ).toBe(true);
      await expect(
        db
          .prepare(
            `select count(*) as count
           from briar_run_child_storage_a_project_mismatches`,
          )
          .first("count"),
      ).resolves.toBe(0);

      const preservedPng = await worker.fetch(
        new Request(`https://briar.example${legacyPng.attachments[0]!.url}`, {
          headers: { authorization: `Bearer ${sessionToken}` },
        }),
        env(),
      );
      expect(preservedPng.status).toBe(200);
      expect(preservedPng.headers.get("Content-Type")).toBe("image/png");
      await expect(preservedPng.text()).resolves.toBe("png");

      const createdResponse = await worker.fetch(
        issueRequest(
          "Migrated SVG attachment",
          new File([svgBody], "diagram.svg", { type: "image/svg+xml" }),
        ),
        env(),
      );
      expect(createdResponse.status).toBe(201);
      const created = await createdResponse.json<{
        runId: string;
        attachments: Array<{
          id: string;
          filename: string;
          contentType: string;
          byteSize: number;
          url: string;
        }>;
      }>();
      expect(created.attachments).toEqual([
        expect.objectContaining({
          filename: "diagram.svg",
          contentType: "image/svg+xml",
          byteSize: new TextEncoder().encode(svgBody).byteLength,
        }),
      ]);

      const download = await worker.fetch(
        new Request(`https://briar.example${created.attachments[0]!.url}`, {
          headers: { authorization: `Bearer ${sessionToken}` },
        }),
        env(),
      );
      expect(download.status).toBe(200);
      expect(download.headers.get("Content-Type")).toBe("image/svg+xml");
      expect(download.headers.get("Content-Security-Policy")).toBe("sandbox");
      expect(download.headers.get("X-Content-Type-Options")).toBe("nosniff");
      await expect(download.text()).resolves.toBe(svgBody);
    },
    60_000,
  );

  it.each([
    {
      title: "Untyped SVG attachment",
      file: new File([svgBody], "boundary.SVG", { type: "" }),
      expectedType: "image/svg+xml",
    },
    {
      title: "Generic SVG attachment",
      file: new File([svgBody], "generic.svg", {
        type: "application/octet-stream",
      }),
      expectedType: "image/svg+xml",
    },
    {
      title: "PNG attachment regression",
      file: new File(["png"], "existing.png", { type: "image/png" }),
      expectedType: "image/png",
    },
  ])(
    "stores $title with canonical MIME metadata",
    async ({ title, file, expectedType }) => {
      const response = await worker.fetch(issueRequest(title, file), env());

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        attachments: [{ filename: file.name, contentType: expectedType }],
      });
    },
  );
});
